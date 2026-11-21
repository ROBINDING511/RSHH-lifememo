// pages/ocean/ocean.js — 人生海洋主界面
// 渲染：2D 可拖世界（滚地球）+ 水彩插画 + CSS 动画；布局纯逻辑在 utils/sea.js。
// 交互：微信式按住说话（松手发送/上滑取消）+ 流式转写；冰山可拖拽换海；复核卡可续录。
// 适老：大触控/高对比/失败必落草稿/原生 text 随微信字体放大。
const { createRecorder, concatWavs } = require('../../utils/recorder')
const api = require('../../utils/api')
const draft = require('../../utils/draft')
const life = require('../../utils/life')
const sea = require('../../utils/sea')
const ui = require('../../utils/ui')

Page({
  data: {
    capsuleBottom: 88,
    // 场景
    worldWidth: 0, worldHeight: 0, movX: 0, movY: 0, seaScale: 1,
    boatPaused: false,
    movableDisabled: false,
    birthYear: null,
    // 录音
    recording: false, recordMode: '', cancelArmed: false,
    transcript: '', asrHint: '', elapsed: 0, countdown: 0,
    // 复核 / 发布
    preview: null, previewVoicePlaying: false, publishing: false,
    drafts: [], icebergCount: 0,
    // 提示脚手架 / 那年今日 / 家人 / 声音克隆 / 环境音
    familyOwner: null, familyReactCount: 0,
    voiceReview: null, voiceState: 'collecting',
    sheetDy: 0, sheetSettle: true,
    // v2.0 C 门控 / D 字幕 / A9 状态 / A8 情绪
    locked: false, lockArmed: false,
    liveTail: '',
    previewStatus: '', previewEmotion: false,
    // 生日引导：鲸鱼气泡+回答建议（称呼在杭航菜单设置）
    bbLeft: 24, bbTop: 200, bbTail: 180, boatLeft: 160, boatTop: 420,
    bubbleShow: false, bubbleText: '', stageLabels: [], topHint: '',
    birthYears: (() => { const a = []; for (let y = 2010; y >= 1920; y--) a.push(y + '年'); return a })()
  },

  onLoad (query) {
    this.asr = null
    this.previewAudio = null
    this.recorder = createRecorder()
    // 视角缩放=用户自己的，会话内持久（仅重启重置）
    this.setData({
      firstLaunch: getApp().globalData.firstLaunch,
      capsuleBottom: this.safeTop(),
      familyOwner: wx.getStorageSync('familyOwner') || null,
    })
    if (query && query.edit) this.loadForEdit(query.edit)
    if (query && query.draft) this.loadDraft(query.draft)
    const th = getApp().globalData.topHint
    if (th) { getApp().globalData.topHint = ''; this.showTopHint(th) }
    this.scheduleBubble(20000)
  },

  onShow () {
    if (this.data.firstLaunch) {
      this.setData({ firstLaunch: false })
      getApp().globalData.firstLaunch = false
      this.firstLaunchFlow()   // 首屏：隐私指引 → 麦克风确认 → 正式操作
      return
    }
    this.boot()
  },
  // 首启两步授权：先隐私指引弹窗，同意后系统麦克风确认，再进正式界面
  firstLaunchFlow () {
    // 第一屏先出自家隐私说明卡（不依赖后台声明是否已配），同意后再系统麦克风确认
    this.setData({ showPrivacy: true })
  },
  onPrivacyAgree () {
    if (this._privacyDone) return
    this._privacyDone = true
    try { wx.setStorageSync('privacyAgreed', Date.now()) } catch (e) {}
    this.setData({ showPrivacy: false })
    wx.authorize({ scope: 'scope.record' }).catch(() => {}).then(() => this.boot())
  },
  onPrivacyRefuse () {
    this.setData({ showPrivacy: false })
    this.boot()
    ui.toast('未同意隐私指引；按住说话时可再次同意', 2600)
  },
  boot () {
    // 视角(pan+zoom)=用户自己的：返回时不碰 movable-view 内部状态，仅重建数据；
    // 只有首次/重启才设定视角（onLoad 从 globalData 恢复）。
    if (!this._worldInited) {
      this.setupWorld(false)
      this._worldInited = true
    } else {
    }
    this.setData({ birthYear: life.getBirthYear(), drafts: draft.list(), boatPaused: false })
    this.refreshData()
    this.refreshToday()
    this.refreshReactions()
    this.refreshVoice()
    setTimeout(() => this.preheatAsr(), 600)   // 延后预热，首屏更快
  },

  // 提示脚手架：一次一个问题（家人投喂的优先）

  // 家人反应回流计数（长辈侧）
  async refreshReactions () {
    if (this.data.familyOwner) return
    try {
      const r = (await wx.cloud.callFunction({ name: 'family', data: { action: 'myReactions' } })).result || {}
      this.setData({ familyReactCount: r.count || 0 })
    } catch (e) { /* 未部署静默 */ }
  },

  // ==================== 妈妈声音克隆 ====================
  async refreshVoice () {
    if (this.data.familyOwner) return
    try {
      const r = (await wx.cloud.callFunction({ name: 'voiceclone', data: { action: 'status' } })).result || {}
      this.setData({
        voiceState: r.state || 'collecting',
        voiceReview: r.state === 'review' ? { sampleUrl: r.sampleUrl } : null
      })
    } catch (e) { /* 未部署静默 */ }
  },
  playVoiceSample () {
    const v = this.data.voiceReview
    if (!v || !v.sampleUrl) return
    if (this._voiceAudio) { this._voiceAudio.stop(); this._voiceAudio.destroy(); this._voiceAudio = null; return }
    this._voiceAudio = wx.createInnerAudioContext()
    this._voiceAudio.obeyMuteSwitch = false
    this._voiceAudio.src = String(v.sampleUrl).replace(/^http:/, 'https:')
    this._voiceAudio.volume = 1
    this._voiceAudio.onEnded(() => { this._voiceAudio.destroy(); this._voiceAudio = null })
    this._voiceAudio.play()
  },
  async voiceLike () {
    try {
      await wx.cloud.callFunction({ name: 'voiceclone', data: { action: 'confirm', like: true } })
      this.setData({ voiceReview: null, voiceState: 'frozen' })
      ui.toast('声音固化好了，不再自动克隆', 2400)
    } catch (e) { ui.toast('没存上，再试试') }
  },
  async voiceUnlike () {
    try {
      await wx.cloud.callFunction({ name: 'voiceclone', data: { action: 'confirm', like: false } })
      this.setData({ voiceReview: null, voiceState: 'collecting' })
      ui.toast('好，下次接着克隆', 2200)
    } catch (e) { ui.toast('没存上，再试试') }
  },
  // 发布后把这段原声喂给克隆（固化后服务端自动跳过）
  feedVoiceSample (fileID) {
    // 声纹=敏感个人信息：须单独同意（杭航·声音菜单开关）才收集克隆样本
    if (!fileID || this.data.familyOwner || wx.getStorageSync('cloneConsent') !== '1') return
    wx.cloud.callFunction({ name: 'voiceclone', data: { action: 'addSample', fileID, durationMs: this._lastDuration || 0 } })
      .then((r) => {
        const s = (r && r.result) || {}
        if (s.state === 'review') this.setData({ voiceReview: { sampleUrl: s.sampleUrl }, voiceState: 'review' })
        else this.setData({ voiceState: s.state || this.data.voiceState })
      }).catch(() => {})
  },

  // 那年今日：托起一座旧冰山
  refreshToday () {
    const now = new Date()
    const md = (now.getMonth() + 1) + '-' + now.getDate()
    const hit = (this._icebergs || []).find((b) => {
      if (!b.createdAt) return false
      const d = new Date(b.createdAt)
      return (d.getMonth() + 1) + '-' + d.getDate() === md && d.getFullYear() < now.getFullYear()
    })
    this.setData({
      todayMemory: hit ? { id: hit._id, title: hit.title || '一段回忆', yearsAgo: now.getFullYear() - new Date(hit.createdAt).getFullYear() } : null
    })
  },
  openToday () {
    if (this.data.todayMemory) wx.navigateTo({ url: `/pages/iceberg/iceberg?id=${this.data.todayMemory.id}` })
  },

  onHide () {
    if (this._bbTimer) clearTimeout(this._bbTimer)
    if (this._bbLit) clearTimeout(this._bbLit)
    if (this.data.recording) this.saveDraftAndStop()   // 切后台/来电先落草稿
    this.stopPreviewVoice()
    this.releaseAsr()
  },

  onUnload () {
    this.clearTick(); if (this._native) { try { this._native.stop() } catch (e) {} }
    if (this._bbTimer) clearTimeout(this._bbTimer)
    if (this._bbLit) clearTimeout(this._bbLit)
    this.releaseAsr()
    this.stopPreviewVoice()
  },

  safeTop () {
    try {
      const r = wx.getMenuButtonBoundingClientRect()
      if (r && r.bottom) return r.bottom
    } catch (e) { /* 兜底 */ }
    return (sea.windowSize().H ? 20 : 20) + 44
  },

  // ==================== 世界 / 布局 ====================
  // keepPosition=true 时保留上次游到的位置（从详情返回不回到中央）
  setupWorld (keepPosition) {
    // 水平滚轴世界：宽随回忆数增长，高=视口；左=年轻 右=久远
    const info = sea.windowSize()
    const lay = this._lay || { worldWidth: info.W, boatX: Math.round(info.W * 0.4), boatBottom: Math.round(info.H * 0.15) }
    const W = Math.max(info.W, lay.worldWidth)
    const H = info.H
    this._world = { worldWidth: W, worldHeight: H }
    this._regions = []
    let mx = 0
    if (keepPosition) {
      const px = this._movX != null ? this._movX : this.data.movX
      mx = Math.max(-(W - info.W), Math.min(0, px))
    } else {
      mx = Math.max(-(W - info.W), Math.min(0, -(lay.boatX - info.W / 2)))   // 首屏对准最新山+船
    }
    this.setData({
      worldWidth: W, worldHeight: H, movX: mx, movY: 0, boatBottom: lay.boatBottom
    })
    this.updateBubble()
  },

  async refreshData () {
    let icebergs = []
    try {
      if (this.data.familyOwner) {
        const r = (await wx.cloud.callFunction({ name: 'family', data: { action: 'list', owner: this.data.familyOwner } })).result || {}
        icebergs = r.data || []
      } else icebergs = await api.listIcebergs()
    } catch (e) { console.warn('数据加载失败（可能未创建集合）', e) }
    this._icebergs = icebergs
    const info0 = sea.windowSize()
    const lay = sea.layoutMountains(icebergs, info0.H, info0.W, this.data.birthYear)
    this._mountains = lay.mountains
    this._lay = lay
    const mountains = lay.mountains
    this.setData({
      icebergCount: icebergs.length, mountains, stageLabels: lay.labels || [],
    })
    this.setupWorld(true)
    this.updateBubble()
  },

  clearNewBerg (pid) {
    const i = (this.data.mountains || []).findIndex((m) => m.id === pid)
    if (i >= 0) this.setData({ [`mountains[${i}].flag`]: false })
  },

  // 从详情"继续说/补录"进入：编辑模式打开复核卡
  async loadForEdit (id) {
    try {
      const b = (await wx.cloud.database().collection('icebergs').doc(id).get()).data
      let wav = ''
      if (b.audioFileID) {
        try { wav = (await wx.cloud.downloadFile({ fileID: b.audioFileID })).tempFilePath } catch (e) {}
      }
      this.openPreview(wav, b.text || '', { editId: id })
    } catch (e) { ui.toast('没打开这段回忆') }
  },

  loadDraft (at) {
    const d = draft.list().find((x) => String(x.at) === String(at))
    if (!d) return
    draft.remove(d.at)
    this.openPreview(d.wavPath || '', d.text || '')
  },
  // ==================== 实时识别 ====================
  async preheatAsr () {
    if (this.asr && (this.asr.isReady || this.asr.state === 'connecting')) return
    const app = getApp()
    if (!app.globalData.asrConfig) await app.silentLogin().catch(() => {})
    const cfg = api.getAsrConfig()
    if (!cfg || !cfg.key) { this.setData({ asrHint: 'offline' }); return }
    if (this.asr) { try { this.asr.close() } catch (e) {} }
    const { AsrStream } = require('../../utils/asr')
    this.asr = new AsrStream(cfg)
    this.bindAsr(this.asr)
    this.setData({ asrHint: 'connecting' })
    try {
      const ok = await this.asr.connect()
      if (ok) { this.asr.startKeepAlive(); this.setData({ asrHint: '' }) }
      else this.setData({ asrHint: 'offline' })
    } catch (e) { this.setData({ asrHint: 'offline' }) }
  },

  bindAsr (asr) {
    asr.on('partial', (t) => this.flushTranscript(t))
    asr.on('sentence', (t) => this.flushTranscript(t, true))
    asr.on('ready', () => this.flushFrameBuf())
    asr.on('error', (e) => {
      if (this.data.recording) { this.setData({ asrHint: 'offline' }); this.retryAsrDuringRecording() }
      console.warn('[asr] error:', e && e.message)
    })
  },

  flushTranscript (text, force) {
    this._pendingText = text
    if (force) return this.applyTranscript()
    const now = Date.now()
    if (now - (this._lastTranscriptAt || 0) >= 100) this.applyTranscript()
    else if (!this._transcriptTimer) {
      this._transcriptTimer = setTimeout(() => { this._transcriptTimer = null; this.applyTranscript() }, 100)
    }
  },

  applyTranscript () {
    this._lastTranscriptAt = Date.now()
    if (this._pendingText == null) return
    const t = this._appendBase != null ? this._appendBase + this._pendingText : this._pendingText
    // D 字幕纪律：默认最近 2 行
    const seg = t.split(/(?<=[。！？!?；;])/).filter(Boolean)
    this.setData({ transcript: t, liveTail: seg.slice(-2).join('') })
  },
  // D 字幕：上滑读历史停跟随 / 回到最新 / 大字 / 看全部

  // A3 留白：这段不想说 → 记 blanks，AI 禁提，温和安抚
  markBlank (topic) {
    const p = this.data.preview
    const t = topic || (p && p.text || '').slice(0, 12) || '这段'
    const blanks = (p && p.blanks) || []
    blanks.push({ topic: t, reason: '本人跳过', at: Date.now() })
    try {
      const idx = wx.getStorageSync('blanksIndex') || []
      if (!idx.includes(t)) idx.push(t)
      wx.setStorageSync('blanksIndex', idx.slice(-20))
    } catch (e) {}
    if (p) this.setData({ 'preview.blanks': blanks })
    ui.toast('好，这段咱们就放在这儿，不碰它。', 2600)
  },

  // A8 情绪保护：先歇一歇（收起复核卡，草稿已落）
  restNow () {
    const p = this.data.preview
    if (p) {
      draft.save({ wavPath: p.wavPath, text: p.text, reason: '情绪保护' })
      this.markBlank((p.text || '').slice(0, 12))
    }
    this.stopPreviewVoice()
    this.setData({ preview: null, drafts: draft.list(), previewEmotion: false })
    this.hideBubble(); this.scheduleBubble(20000)
    ui.toast('歇一歇，话已经帮您存好了', 2600)
  },

  releaseAsr () {
    if (this._transcriptTimer) { clearTimeout(this._transcriptTimer); this._transcriptTimer = null }
    if (this._pendingText != null) this.setData({ transcript: this._pendingText })
    if (this.asr) { try { this.asr.close() } catch (e) {} this.asr = null }
  },

  ensureAsr () {
    const cfg = api.getAsrConfig()
    if (this.asr && (this.asr.isReady || this.asr.state === 'connecting')) {
      if (this.asr.isReady) { this.asr.reset(); this.asr.stopKeepAlive() }
      this.setData({ asrHint: this.asr.isReady ? '' : 'connecting' })
      return
    }
    if (cfg && cfg.key) {
      this.releaseAsr()
      const { AsrStream } = require('../../utils/asr')
      this.asr = new AsrStream(cfg)
      this.bindAsr(this.asr)
      this.setData({ asrHint: 'connecting' })
      this.asr.connect().then((ok) => {
        if (this.data.recording) this.setData({ asrHint: ok ? '' : 'offline' })
        if (ok) this.flushFrameBuf()
      }).catch(() => { if (this.data.recording) this.setData({ asrHint: 'offline' }) })
    } else {
      this.asr = null
      this.setData({ asrHint: 'connecting' })
      getApp().silentLogin().then(() => {
        if (!this.data.recording) return
        const c = api.getAsrConfig()
        if (c && c.key) this.ensureAsr()
        else this.setData({ asrHint: 'offline' })
      }).catch(() => { if (this.data.recording) this.setData({ asrHint: 'offline' }) })
    }
  },

  retryAsrDuringRecording () {
    if (!this.data.recording || this._asrRetried) return
    this._asrRetried = true
    setTimeout(() => { this._asrRetried = false; if (this.data.recording) this.ensureAsr() }, 600)
  },
  flushFrameBuf () {
    const buf = this._frameBuf || []
    this._frameBuf = []
    for (const f of buf) { if (this.asr) this.asr.sendFrame(f) }
  },

  // ==================== 录音（按住说话） ====================
  onHoldStart (e) {
    // 免按住(锁定)中：点一下=结束
    if (this.data.locked) {
      this._lockTap = true
      this.setData({ locked: false })
      this.finishRecording()
      return
    }
    // 编辑卡还开着时再按住=重新开始录音：旧卡静默落草稿，不带出上一次的历史
    if (this.data.preview) this.saveDraftNow(true)
    this._holdSource = 'button'
    this._holdY = e.touches && e.touches[0] ? e.touches[0].clientY : 0
    this._holdX = e.touches && e.touches[0] ? e.touches[0].clientX : 0
    this.startRecording('hold')
  },

  // 微信式手势：上滑=取消，右滑=锁定免按住
  onHoldMove (e) {
    if (!this.data.recording || this._holdSource !== 'button' || this.data.locked) return
    const t = e.touches && e.touches[0] ? e.touches[0] : {}
    const up = (this._holdY - (t.clientY || 0)) > 80
    const right = ((t.clientX || 0) - this._holdX) > 80 && !up
    if (up !== this.data.cancelArmed || right !== this.data.lockArmed) {
      this.setData({ cancelArmed: up, lockArmed: right })
    }
  },
  onHoldEnd () {
    if (this._lockTap) { this._lockTap = false; return }   // 锁定态的"点一下结束"已在 touchstart 处理
    if (!this.data.recording) { if (this._recActive) this.finishRecording(); return }   // 兜底：状态漏收也停
    const cancel = this.data.cancelArmed, lock = this.data.lockArmed
    if (cancel) { this.saveDraftAndStop(); return }
    if (lock) { this.setData({ locked: true, cancelArmed: false, lockArmed: false }); return }   // 右滑固定：换色+松手继续录
    // 松手=立刻退出语音识别卡片，再邀请编辑（onStop 开复核卡）
    this.setData({ recording: false, cancelArmed: false, lockArmed: false })
    this.finishRecording()
  },
  onBoatLongPress () {
    if (this.data.recording || this.data.preview) return
    this._holdSource = 'whale'
    this.startRecording('hold')
  },
  onContinueStart () {
    const p = this.data.preview
    if (p) { this.tapHaptic(); this.startRecording('hold', p.text || '') }
  },
  onContinueEnd () { if (this.data.recording) this.finishRecording() },

  async startRecording (mode, appendBase, fmt) {
    if (this.data.recording) return
    if (this.data.preview && appendBase == null) return   // 复核卡开着只允许续录
    this._appendBase = appendBase != null ? appendBase : null
    this._recFallback = fmt === 'mp3'
    this.setData({ recording: true, recordMode: mode, transcript: this._appendBase || '', liveTail: '', elapsed: 0, countdown: 0, cancelArmed: false, asrHint: '' })
    if (this.asr) this.asr.reset()   // 清空上一段残留字：新录音只含本次内容
    this._recActive = true   // 同步置位：快速点按的 touchend 也能停住（recorder.recording 是异步 onStart 才真）
    this._pendingText = null
    this._frameBuf = []
    if (wx.vibrateShort) wx.vibrateShort({ type: 'medium' })
    const plugin = this.nativePlugin()
    if (plugin) {
      // 微信原生同声传译：免费、不受自有域名白名单限制；录音+识别一体
      const mgr = plugin.getRecordRecognitionManager()
      this._native = mgr
      mgr.onRecognize = (res) => { if (res && res.result) this.setData({ transcript: res.result, liveTail: res.result.slice(-40) }) }
      mgr.onStop = (res) => { this.clearTick(); this.handleRecordStop((res && res.tempFilePath) || '', (res && res.duration) || this._elapsedMs || 0, null) }
      mgr.onError = (e) => { this.clearTick(); this.handleRecordStop('', 0, e) }
      mgr.start({ lang: 'zh_CN', duration: 60000 })
      this.startTick()
    } else {
      this.ensureAsr()
      this.recorder.start({
        onFrame: (buf) => { if (this._recFallback) return; if (this.asr) this.asr.sendFrame(buf); else this._frameBuf.push(buf) },
        onTick: (s) => this.setData({ elapsed: s }),
        onCountdown: (left) => {
          this.setData({ countdown: left })
          if (left <= 3 && wx.vibrateShort) wx.vibrateShort({ type: 'light' })
        },
        onStop: (w, d, e) => this.handleRecordStop(w, d, e)
      }, fmt)
    }
  },
  nativePlugin () { try { return requirePlugin('WechatSI') } catch (e) { return null } },
  startTick () {
    this._elapsedMs = 0
    this.clearTick()
    this._tick = setInterval(() => {
      this._elapsedMs += 1000
      const sec = Math.floor(this._elapsedMs / 1000)
      const left = 60 - sec
      this.setData({ elapsed: sec, countdown: left <= 10 && left > 0 ? left : 0 })
      if (left <= 3 && left > 0 && wx.vibrateShort) wx.vibrateShort({ type: 'light' })
      if (left <= 0) this.finishRecording()
    }, 1000)
  },
  clearTick () { if (this._tick) { clearInterval(this._tick); this._tick = null } },
  async handleRecordStop (wavPath, durationMs, err) {

      this._recActive = false
      this._lastDuration = durationMs
      this.setData({ recording: false, countdown: 0, elapsed: 0, recordMode: '', boatPaused: false, cancelArmed: false })
      this.applyTranscript()
      if (this.cancelRequested) {
        // 上滑取消=完全收回：不落草稿、不留任何条/卡，界面干净
        this.cancelRequested = false
        this.setData({ transcript: '', liveTail: '' })
        return
      }
      if (err) {
        const em = (err && (err.errMsg || err.message)) || ''
        console.error('[rec]', em)
        if (/privacy/i.test(em)) { this.setData({ recording: false }); return ui.toast('需先同意隐私指引，同意后重新按住', 2600) }
        if (/auth|deny|authorize/i.test(em)) return this.guideOpenSetting()
        if (/is recording|busy/i.test(em) && !this._recRetry) { this._recRetry = true; this.recorder.stop(); setTimeout(() => { this._recRetry = false; this.startRecording('hold') }, 300); return }
        if (!wavPath && !this._recFallback) { this._recFallback = true; this.setData({ asrHint: 'offline', recording: false }); setTimeout(() => this.startRecording('hold', this._appendBase, 'mp3'), 300); return }
        if (wavPath && durationMs >= 800) {
          const full = this.data.transcript || ''
          this.setData({ transcript: '' })
          this.openPreview(wavPath, full)
          ui.toast('录音中断了，已打开接着说', 2600)
        } else ui.toast('录音中断：' + (em || '未知').slice(0, 40), 3000)
        return
      }
      if (durationMs < 800) { this.setData({ transcript: '', liveTail: '' }); return ui.toast('太短了，多说几句') }
      const full = (this.data.transcript || '').trim()

      if (this._appendBase != null) { this._appendBase = null; this.appendToPreview(wavPath, full) }
      else this.openPreview(wavPath, full)

  },

  finishRecording () { if (!this._recActive) return; if (this._native) this._native.stop(); else this.recorder.stop() },

  saveDraftAndStop () {
    if (!this._recActive) return
    this.cancelRequested = true
    // 立刻取消所有已说内容+收回面板，回到初始干净界面（不等 onStop 异步）
    this.setData({ recording: false, cancelArmed: false, lockArmed: false, locked: false, transcript: '', liveTail: '' })
    if (this.asr) this.asr.reset()
    if (this._native) this._native.stop(); else this.recorder.stop()
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
  },

  async guideOpenSetting () {
    const r = await ui.confirm({
      title: '需要麦克风权限',
      content: '说话要用到麦克风。点"去设置"，把「人生海海」的麦克风打开，回来就能说了。',
      confirmText: '去设置', cancelText: '先不了'
    })
    if (r === 'confirm') wx.openSetting()
  },

  async fallbackTranscribe (wavPath) {
    let fileID = ''
    const cleanup = () => { if (fileID) wx.cloud.deleteFile({ fileList: [fileID] }).catch(() => {}) }
    try {
      fileID = (await wx.cloud.uploadFile({ cloudPath: `tmp_asr/${Date.now()}.wav`, filePath: wavPath })).fileID
      const r = (await wx.cloud.callFunction({ name: 'transcribe', data: { fileID } })).result || {}
      cleanup()
      if (r.ok && r.text) return r.text
      console.warn('兜底转写失败:', r.error)
      return ''
    } catch (e) { console.error('兜底转写异常:', e); cleanup(); return '' }
  },

  // ==================== 场景触摸 ====================
  onSceneTouchStart () { this._seaTouching = true; if (!this.data.boatPaused) this.setData({ boatPaused: true }) },
  onSceneTouchEnd () {
    this._seaTouching = false
    // 页面级兜底：无论按钮自身 touchend 是否漏发，松手必停
    if (this.data.recording && !this.data.locked && (this._holdSource === 'whale' || this._holdSource === 'button')) return this.finishRecording()
    if (!this.data.recording && this.data.boatPaused) this.setData({ boatPaused: false })
  },
  onBoatTap () {
    wx.navigateTo({ url: '/pages/stages/stages' })
  },
  // A2 年份双说：定A/定B/两个都留
  pickYearChoice (e) {
    const v = e.currentTarget.dataset.v
    const stages = life.getStages()
    const by = this.data.birthYear
    const upd = { 'preview.yearResolved': true }
    if (v === 'both') {
      const ys = this.data.preview.yearChoices
      upd['preview._bothYears'] = ys.join('/')
      upd['preview.timeLabel'] = ys.join('/') + '年'
      if (by) upd['preview.zoneIndex'] = stages.findIndex((x) => x.key === life.stageOfYear(ys[0], by).key)
    } else {
      const y = Number(v)
      upd['preview._autoYear'] = y
      upd['preview._bothYears'] = null
      upd['preview.timeLabel'] = y + '年' + (by ? ' · ' + (y - by) + '岁' : '')
      if (by) upd['preview.zoneIndex'] = stages.findIndex((x) => x.key === life.stageOfYear(y, by).key)
    }
    this.setData(upd)
  },
  // 生日引导：点建议年份 / 滚轮选 / 跳过
  onBergTap (e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/iceberg/iceberg?id=${id}` })
  },
  onSeaChange (e) { this._movX = e.detail.x; this._movY = e.detail.y; this.updateBubble() },
  // ---- 提示词飘出节奏：说完话20秒后飘出→亮20秒→无人点静默60秒→换下一条 ----
  scheduleBubble (delay) {
    if (this._bbTimer) clearTimeout(this._bbTimer)
    this._bbTimer = setTimeout(() => this.showBubble(), delay)
  },
  showBubble () {
    const P = [
      '今天想聊哪一段？按住下面慢慢说。',
      '小时候最记得的一件事是什么？',
      '那年您几岁？在做什么？',
      '有什么话想留给家里人？',
      '最近有什么开心的小事？'
    ]
    this._bbIdx = ((this._bbIdx == null ? -1 : this._bbIdx) + 1) % P.length
    this.setData({ bubbleShow: true, bubbleText: P[this._bbIdx] })
    this.updateBubble()
    if (this._bbLit) clearTimeout(this._bbLit)
    this._bbLit = setTimeout(() => { this.hideBubble(); this.scheduleBubble(60000) }, 20000)
  },
  hideBubble () {
    if (this._bbLit) clearTimeout(this._bbLit)
    this.setData({ bubbleShow: false })
  },
  onBubbleTap () { this.hideBubble(); this.scheduleBubble(60000) },
  // 顶端略小提示（删除回执等），4秒自动消
  showTopHint (t) {
    if (this._thTimer) clearTimeout(this._thTimer)
    this.setData({ topHint: t })
    this._thTimer = setTimeout(() => this.setData({ topHint: '' }), 4000)
  },
  // 船+气泡固定视口并夹在画面内（不撞边），气泡尾指船
  updateBubble () {
    const info = sea.windowSize()
    const W = info.W, H = info.H
    const lay = this._lay || {}
    const movX = this.data.movX || 0
    const center = (lay.newestLeft || 0) + movX + (lay.newestWidth || 0) / 2
    const boatW = 75, boatH = 112
    const boatLeft = Math.max(12, Math.min(W - boatW - 12, center - boatW / 2))
    const baseY = lay.minBottom != null ? H - lay.minBottom : H * 0.62
    const boatTop = Math.max(H * 0.40, Math.min(H - boatH - 90, baseY + 6))
    const bw = 150, bh = 64
    const bx = boatLeft + boatW / 2
    const left = Math.max(8, Math.min(W - bw - 8, bx - bw / 2))
    const top = Math.max((this.data.capsuleBottom || 88) + 8, boatTop - bh - 8)
    const tail = Math.max(10, Math.min(bw - 20, bx - left - 5))
    this.setData({
      boatLeft: Math.round(boatLeft), boatTop: Math.round(boatTop),
      bbLeft: Math.round(left), bbTop: Math.round(top), bbTail: Math.round(tail)
    })
  },
  // 双指捏合缩放（聚拢缩小 / 打开放大）


  // ==================== 草稿 / 复核 / 发布 ====================

  openPreview (wavPath, text, opts) {
    const hasText = text && text.replace(/\s/g, '').length >= 2
    const stages = life.getStages()
    this.setData({
      preview: {
        wavPath, text: text || '', rawText: text || '', audioOnly: !hasText && !!wavPath,
        zoneOptions: stages.map((s) => s.key), zoneIndex: Math.floor((stages.length - 1) / 2),
        timeLabel: '', _autoYear: null, showTitle: false, _aiTitle: '', _four: '',
        editId: (opts && opts.editId) || null, extraWavs: [],
        photos: [], previewVoicePlaying: false
      }
    })
    // 岁数/年份→海 同步算（不等异步 refine），发布时归属即正确
    this.setData(this.computeTimeZone(text || ''))
    // A8 情绪保护：命中敏感词不整理不追问，温和话术+可歇一歇
    const emo = this.isSensitive(text || '')
    this.setData({ previewStatus: 'pending', previewEmotion: emo, 'preview.blanks': [] })
    if (emo) { this.markBlank((text || '').slice(0, 12)); return }
    if (!hasText && wavPath) ui.toast('没听清，可以先存声音，或直接打字', 3000)
    this.refinePreview(wavPath, text || '')
  },
  isSensitive (t) {
    return /不想活|轻生|自杀|过世|去世|走了的人|重病|癌/.test(t || '')
  },
  // 岁数优先归海（8岁→童年，不依赖生日）；文本"出生是1987年"是生日非事件年
  computeTimeZone (text) {
    const stages = life.getStages()
    const age = life.parseAge(text)
    const birthM = text.match(/(?:出生|生于)[^0-9]{0,6}((?:19|20)\d{2})/) || text.match(/((?:19|20)\d{2})\s*年(?:生|出生)/)
    const by = this.data.birthYear || (birthM ? Number(birthM[1]) : null)
    const ym = text.match(/((?:19|20)\d{2})\s*年/)
    const eventYear = (ym && Number(ym[1]) !== by) ? Number(ym[1]) : null
    const out = {}
    // A2 年份双说：给出 定A/定B/两个都留
    const ys = [...new Set((text.match(/(?:19|20)\d{2}(?=\s*年)/g) || []).map(Number).filter((y) => y !== by))]
    if (ys.length >= 2) { out['preview.yearChoices'] = ys.slice(0, 2); out['preview.yearResolved'] = false }
    if (age != null) {
      out['preview.zoneIndex'] = stages.findIndex((x) => x.key === life.stageOfAge(age).key)
      if (by) {
        const yr = life.eventYear(by, age)
        out['preview.timeLabel'] = `${yr}年 · ${age}岁`
        out['preview._autoYear'] = yr
      } else out['preview.timeLabel'] = `${age}岁`
    } else if (eventYear && by) {
      const a = eventYear - by
      out['preview.timeLabel'] = `${eventYear}年 · ${a}岁`
      out['preview.zoneIndex'] = stages.findIndex((x) => x.key === life.stageOfAge(a).key)
      out['preview._autoYear'] = eventYear
    } else out['preview.timeLabel'] = ''
    return out
  },

  // 用户口述请求开新海：按提到的年份换算岁数→加节点开海→整段文字归入该海
  applyNewSea (ns) {
    const by = life.getBirthYear()
    const name = String(ns.name || '').trim().slice(0, 8)
    if (!name) return null
    const year = parseInt(ns.year, 10)
    if (!isFinite(year)) { this.showTopHint('没说清哪一年，先记在原海'); return null }
    const age = by != null ? year - by : null
    if (age != null && (age < 0 || age > 120)) return null
    life.addMilestone(name, age, year)
    this.showTopHint('听懂了：新开「' + name + '」之海，这段记在里面')
    return name
  },
  async refinePreview (wavPath, text) {
    let finalText = (text || '').trim()
    if (this.asr) {
      const live = this.asr.isReady
      const t = await this.asr.finish(1200).catch(() => '')
      if (t && t.trim().length > finalText.length) finalText = t.trim()
      if (live) this.asr.startKeepAlive()
      else { this.releaseAsr(); this.preheatAsr() }
    }
    if (!finalText && wavPath) finalText = (await this.fallbackTranscribe(wavPath).catch(() => '')) || ''
    let p = this.data.preview
    if (!p || p.wavPath !== wavPath) return
    let r = null
    if (finalText.replace(/\s/g, '').length >= 2) {
      try { r = await api.analyzeMemory(finalText, (p.blanks || []).map((b) => b.topic), life.getKnownPeople()) }
      catch (e) { console.warn(e); this.setData({ previewStatus: 'failed' }) }
    }
    p = this.data.preview
    if (!p || p.wavPath !== wavPath) return
    // 听懂"把这段变成一片新的海"→自动开海，并把整段记进这片海
    let newSeaName = null
    if (r && r.newSea && r.newSea.name) newSeaName = this.applyNewSea(r.newSea)
    const stages = life.getStages()
    // 默认保留讲述者原话（逐字）；AI 小标题可选、可一键还原
    const upd = { 'preview.rawText': finalText, 'preview.audioOnly': !finalText && !!wavPath, 'preview.zoneOptions': stages.map((s) => s.key), 'preview._aiTitle': (r && r.title) || '', 'preview._four': (r && r.four) || '', 'preview.showTitle': false }
    // AI 标题直接加在文字上方（不可关，但可在框内直接点改）；四字名字另存 _four
    if (finalText) upd['preview.text'] = (r && r.title) ? `${r.title}\n${finalText}` : finalText
    Object.assign(upd, this.computeTimeZone(finalText))
    if (newSeaName) {
      const idx = stages.findIndex((s) => s.name === newSeaName || s.key === newSeaName)
      if (idx >= 0) { upd['preview.zoneIndex'] = idx; upd['preview.zoneName'] = stages[idx].name }
      if (r.newSea.year) upd['preview._autoYear'] = parseInt(r.newSea.year, 10)
    }
    this.setData(upd)
    if (this.data.previewStatus !== 'failed') this.setData({ previewStatus: 'done' })
  },

  appendToPreview (wavPath, fullText) {
    const p = this.data.preview
    if (!p) return
    this.setData({
      recording: false, recordMode: '',
      'preview.text': fullText, 'preview.rawText': fullText, 'preview.audioOnly': false,
      'preview.extraWavs': (p.extraWavs || []).concat(wavPath ? [wavPath] : [])
    })
    ui.toast('接上了，可继续说或变成冰山')
  },

  onPreviewInput (e) {
    const v = e.detail.value
    const p = this.data.preview
    this.setData({ 'preview.text': v, 'preview.audioOnly': !v.trim() && !!(p && p.wavPath) })
  },


  pickZoneSheet () {
    const p = this.data.preview
    if (!p) return
    wx.showActionSheet({
      itemList: (p.zoneOptions || []).slice(0, 6),
      success: (r) => this.setData({ 'preview.zoneIndex': r.tapIndex })
    })
  },

  stopPreviewVoice () {
    if (this.previewAudio) { this.previewAudio.stop(); this.previewAudio.destroy(); this.previewAudio = null }
    if (this.data.previewVoicePlaying) this.setData({ previewVoicePlaying: false })
  },

  playPreviewVoice () {
    const p = this.data.preview
    if (!p || !p.wavPath) return
    if (this.data.previewVoicePlaying) return this.stopPreviewVoice()
    this.previewAudio = wx.createInnerAudioContext()
    this.previewAudio.obeyMuteSwitch = false
    this.previewAudio.onEnded(() => this.setData({ previewVoicePlaying: false }))
    this.previewAudio.onError(() => { this.setData({ previewVoicePlaying: false }); ui.toast('声音放不出来') })
    this.previewAudio.src = p.wavPath
    this.previewAudio.play()
    this.setData({ previewVoicePlaying: true })
  },

  addPhoto () {
    wx.chooseMedia({
      count: 9 - this.data.preview.photos.length, mediaType: ['image'], sizeType: ['compressed'],
      success: (r) => this.setData({ 'preview.photos': this.data.preview.photos.concat(r.tempFiles.map((f) => f.tempFilePath)) })
    })
  },
  previewDraftPhoto (e) {
    const i = Number(e.currentTarget.dataset.i)
    wx.previewImage({ current: this.data.preview.photos[i], urls: this.data.preview.photos })
  },
  async removePhoto (e) {
    const i = Number(e.currentTarget.dataset.i)
    const r = await ui.confirm({ title: '删掉这张照片吗？', content: '删了就不能找回来了。', confirmText: '删掉', cancelText: '留着', danger: true })
    if (r !== 'confirm') return
    const photos = this.data.preview.photos.slice()
    photos.splice(i, 1)
    this.setData({ 'preview.photos': photos })
  },

  // B1/B2：发布后后台跑证据链 refine，落 sentences/doubts/versions/blanks；失败不阻塞
  runRefine (id, rawText, blanks, people) {
    let lines = (this.asr && this.asr.getLines) ? this.asr.getLines() : []
    if (!lines.length) {
      const segs = String(rawText || '').split(/(?<=[。！？!?；;])/).filter(Boolean)
      const dur = (this._lastDuration || 10000) / 1000
      lines = segs.map((t, i) => ({ n: i, t: +((i / Math.max(1, segs.length)) * dur).toFixed(2), seg: '初录', text: t, estimated: true }))
    }
    const knownTitles = (this._icebergs || []).map((b) => b.title).filter(Boolean)
    wx.cloud.callFunction({
      name: 'refine',
      data: { lines, birthYear: this.data.birthYear, stageKeys: life.getStages().map((s) => s.key), knownTitles, blanks: (blanks || []).map((b) => b.topic), style: wx.getStorageSync('polishStyle') || 'light', people: people || life.getKnownPeople() }
    }).then((r) => {
      const res = (r && r.result) || {}
      return wx.cloud.database().collection('icebergs').doc(id).update({
        data: {
          rawText, lines,
          sentences: res.sentences || [], doubts: res.doubts || [],
          corrections: [], blanks: blanks || [],
          versions: [{ at: Date.now(), text: rawText, note: '逐字稿' }],
          refineState: res.refineState || 'failed'
        }
      })
    }).catch(() => {
      wx.cloud.database().collection('icebergs').doc(id).update({ data: { refineState: 'failed' } }).catch(() => {})
    })
  },

  async publish () {
    if (this.data.publishing) return
    const p = this.data.preview
    const text = (p.text || '').trim()
    if (!text && !p.audioOnly) return ui.toast('先说一句话，或打几个字')
    const body = text || '（这段只留了声音，以后可以补字）'
    this.setData({ publishing: true })
    wx.showLoading({ title: '冰山生成中…', mask: true })
    try {
      const wavs = [p.wavPath].concat(p.extraWavs || []).filter(Boolean)
      const audioPath = wavs.length > 1 ? concatWavs(wavs) : wavs[0]
      const timeValue = p._autoYear ? String(p._autoYear) : (p.zoneOptions[p.zoneIndex] || '说不清了')
      const zoneName = p.zoneIndex >= 0 ? p.zoneOptions[p.zoneIndex] : '晚年'
      let created
      if (p.editId) {
        let audioFileID = ''
        if (audioPath) audioFileID = (await wx.cloud.uploadFile({ cloudPath: `voices/${Date.now()}_edit.wav`, filePath: audioPath })).fileID
        await api.updateIceberg(p.editId, { text: body, audioFileID, zoneName, memoryTime: timeValue, deleted: false })   // 编辑后重新成为活冰山
        created = { _id: p.editId, audioFileID }
      } else {
        // 先落文字记录（秒回），音频/照片后台上传再挂上 → 不再久等"冰山生成中"
        created = await api.createIceberg({
          text: body, audioPath: null, photos: [], timeValue, zoneName,
          title: p._four || ((p.rawText && body.startsWith(p.rawText)) ? '' : body.split('\n')[0].slice(0, 12))
        })
      }
      this.lastPublishedId = created && created._id
      this.stopPreviewVoice()
      wavs.forEach((w) => draft.forgetPath(w))
      this.setData({ preview: null, publishing: false, drafts: draft.list() })
    this.hideBubble(); this.scheduleBubble(20000)
      wx.hideLoading()
      ui.toast(p.editId ? '补好了，冰山更新了' : '一座新的冰山入海了', 2400)
      await this.refreshData()
      // 滚到新回忆的山
      const m = (this._mountains || []).find((x) => x.id === this.lastPublishedId)
      if (m) {
        const info = sea.windowSize()
        const mx = Math.max(-(this.data.worldWidth - info.W), Math.min(0, -(m.left - info.W / 2)))
        this._movX = mx
        this.setData({ movX: mx })
      }
      if (this.lastPublishedId) {
        const pid = this.lastPublishedId
        setTimeout(() => this.clearNewBerg(pid), 1100)
        setTimeout(() => this.refreshData(), 5 * 60 * 1000)   // 新冰山红旗 5 分钟后消失
      }
      // 媒体后台上传，完成后喂给声音克隆（固化后服务端自动跳过）
      if (p.editId) this.feedVoiceSample(created.audioFileID)
      else api.attachMedia(created._id, { audioPath, photos: p.photos })
        .then((r) => this.feedVoiceSample(r.audioFileID)).catch(() => {})
      // B2 证据链后台跑，不阻塞发布；失败=逐字照常用
      this.runRefine(created._id, p.rawText || body, p.blanks)
      if (!wx.getStorageSync('L4_pub')) wx.setStorageSync('L4_pub', Date.now())   // A12 首座冰山
    } catch (e) {
      wx.hideLoading()
      this.setData({ publishing: false })
      console.error(e)
      draft.save({ wavPath: p.wavPath, text: body, reason: '发布失败' })
      this.setData({ drafts: draft.list() })
      await ui.confirm({ title: '没存上去', content: '可能是网络不太好。您说的这段已经帮您存下来了，等网络好了点"找回来"就能接着存。', confirmText: '知道了', cancelText: '知道了' })
    }
  },

  // 阻尼抽屉：下拉关闭（高阻尼橡皮筋 + 速度吸附，无超调）；关闭自动存草稿不丢话
  onSheetStart (e) {
    this._sheetY0 = e.touches[0].clientY
    this._sheetSamples = [{ t: Date.now(), y: e.touches[0].clientY }]
    this.setData({ sheetSettle: false, sheetDy: 0 })
    // 量一次卡高，用于"拖过 1/3 即提交"阈值
    wx.createSelectorQuery().select('.preview-card').boundingClientRect((r) => {
      if (r) this._sheetH = r.height
    }).exec()
  },
  onSheetMove (e) {
    const y = e.touches[0].clientY
    const dy = y - this._sheetY0
    // 滑动窗口采样（~100ms），供松手时算窗口速度
    const now = Date.now()
    this._sheetSamples.push({ t: now, y })
    while (this._sheetSamples.length > 2 && now - this._sheetSamples[0].t > 100) this._sheetSamples.shift()
    this.setData({ sheetDy: dy >= 0 ? dy : dy * 0.25 })   // 上拉橡皮筋阻尼
  },
  onSheetEnd () {
    const dy = this.data.sheetDy
    // 窗口速度（末 ~100ms），不用整段平均（会把 flick 平均掉）
    const s = this._sheetSamples || []
    let v = 0
    if (s.length >= 2) {
      const a = s[0], b = s[s.length - 1]
      const dt = Math.max(1, b.t - a.t)
      v = (b.y - a.y) / dt
    }
    const far = dy > (this._sheetH || 400) / 3
    const fast = v > 0.55
    this.setData({ sheetSettle: true })
    if (far || fast) this.dismissSheet()   // 双条件 OR：拖够 或 甩够
    else this.setData({ sheetDy: 0 })      // 否则回弹到 resting，不停在半路
  },
  dismissSheet () {
    const p = this.data.preview
    if (!p) return
    this.stopPreviewVoice()
    draft.save({ wavPath: p.wavPath, text: p.text, reason: '暂未发布' })
    this.setData({ preview: null, drafts: draft.list(), sheetDy: 0 })
    this.hideBubble(); this.scheduleBubble(20000)
    ui.toast('存好了，随时能找回来', 2200)
  },
  // 按压轻震（无超调回弹）
  tapHaptic () { if (wx.vibrateShort) wx.vibrateShort({ type: 'light' }) },

  // 存草稿：点了就存，不弹窗
  saveDraftNow (silent) {
    const p = this.data.preview
    if (!p) return
    this.stopPreviewVoice()
    draft.save({ wavPath: p.wavPath, text: p.text, reason: '存草稿' })
    this.setData({ preview: null, drafts: draft.list() })
    this.hideBubble(); this.scheduleBubble(20000)
    if (!silent) ui.toast('存草稿了，随时能找回来', 2200)
  },
  // ❌ 删除：进"删除的记忆"，5天内可找回
  // ❌ 关闭未发布文字=直接进垃圾桶，无二次确认；界面立刻收回，云端后台落删除
  discardToCloud () {
    const p = this.data.preview
    if (!p) return
    this.stopPreviewVoice()
    const text = (p.text || '').trim() || '（这段只留了声音）'
    const payload = {
      text, audioPath: p.wavPath, photos: p.photos,
      timeValue: p._bothYears || (p._autoYear ? String(p._autoYear) : (p.zoneOptions[p.zoneIndex] || '说不清了')),
      zoneName: p.zoneOptions[p.zoneIndex] || '晚年',
      title: p._four || text.slice(0, 4)
    }
    draft.forgetPath(p.wavPath)
    this.setData({ preview: null, drafts: draft.list() })
    this.hideBubble(); this.scheduleBubble(20000)
    this.showTopHint('删除了，在"删除的记忆"里5天可以找回')
    api.createIceberg(payload)
      .then((created) => api.removeIceberg(created._id))   // deleted=true → 删除的记忆
      .then(() => this.refreshData())
      .catch(() => {
        draft.save({ wavPath: p.wavPath, text: p.text, reason: '删除失败' })
        this.setData({ drafts: draft.list() })
        this.showTopHint('没删成，先存草稿了')
      })
  },
})