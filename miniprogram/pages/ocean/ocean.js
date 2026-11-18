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
const prompts = require('../../utils/prompts')

Page({
  data: {
    capsuleBottom: 88,
    // 场景
    bgLoaded: false,
    bergs: [],
    milestones: [],
    stages: [],
    worldWidth: 0, worldHeight: 0, movX: 0, movY: 0, seaScale: 1,
    tintGradient: '',
    whalePaused: false,
    movableDisabled: false,
    birthYear: null,
    // 录音
    recording: false, recordMode: '', cancelArmed: false,
    transcript: '', asrHint: '', elapsed: 0, countdown: 0,
    // 复核 / 发布
    preview: null, previewVoicePlaying: false, publishing: false,
    drafts: [], icebergCount: 0,
    // 提示脚手架 / 那年今日 / 家人 / 声音克隆 / 环境音
    prompt: '', todayMemory: null,
    familyOwner: null, familyReactCount: 0,
    voiceReview: null, voiceState: 'collecting',
    ambientOn: true,
    sheetDy: 0, sheetSettle: true,
    seaTile: 240, seaPosX: 0, seaPosY: 0, seaGradH: 0,
    // v2.0 C 门控 / D 字幕 / A9 状态 / A8 情绪
    recConsent: false,
    liveBig: false, liveExpanded: false, liveFollow: true, liveTail: '',
    previewStatus: '', previewEmotion: false
  },

  onLoad (query) {
    this.asr = null
    this.previewAudio = null
    this.recorder = createRecorder()
    // 视角缩放=用户自己的，会话内持久（仅重启重置）
    this._scale = getApp().globalData.seaScale || 1
    this.setData({
      firstLaunch: getApp().globalData.firstLaunch,
      capsuleBottom: this.safeTop(),
      familyOwner: wx.getStorageSync('familyOwner') || null,
      seaScale: this._scale
    })
    if (query && query.edit) this.loadForEdit(query.edit)
  },

  onShow () {
    if (this.data.firstLaunch) {
      this.setData({ firstLaunch: false })
      getApp().globalData.firstLaunch = false   // 清全局，避免编辑模式新开 ocean 再弹引导
      wx.navigateTo({ url: '/packageGuide/pages/guide/guide' })
      return
    }
    // 视角(pan+zoom)=用户自己的：返回时不碰 movable-view 内部状态，仅重建数据；
    // 只有首次/重启才设定视角（onLoad 从 globalData 恢复）。
    if (!this._worldInited) {
      this.setupWorld(false)
      this._worldInited = true
    } else {
      this.setData({ milestones: sea.layoutMilestones(this._regions || life.getStages()) })
      this.updateSeaBg()
    }
    this.setData({ birthYear: life.getBirthYear(), drafts: draft.list(), whalePaused: false, ambientOn: wx.getStorageSync('ambientOn') !== '0', recConsent: wx.getStorageSync('recConsent') === '1' })
    if (!this.data.recConsent) this.askConsent()   // C 门控放在进页时，按住说话手势不被弹窗打断
    this.refreshData()
    this.refreshPrompt()
    this.refreshToday()
    this.refreshReactions()
    this.refreshVoice()
    this.startAmbient()
    this.preheatAsr()                                   // 预热连接：开口即出字
    wx.authorize({ scope: 'scope.record' }).catch(() => {})  // 预热授权：0 延迟开口
  },

  // 提示脚手架：一次一个问题（家人投喂的优先）
  async refreshPrompt () {
    let fed = null
    if (!this.data.familyOwner) {
      try {
        const r = (await wx.cloud.callFunction({ name: 'family', data: { action: 'questions' } })).result || {}
        if (r.data && r.data.length) {
          fed = r.data[0].text
          wx.cloud.callFunction({ name: 'family', data: { action: 'useQuestion', id: r.data[0]._id } }).catch(() => {})
        }
      } catch (e) { /* 未部署 family 时静默 */ }
    }
    this.setData({ prompt: fed || prompts.pick(null, this.data.prompt) })
  },
  nextPrompt () { this.setData({ prompt: prompts.pick(null, this.data.prompt) }) },

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
    this._voiceAudio.src = v.sampleUrl
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
    if (!fileID || this.data.familyOwner) return
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
    if (this.data.recording) this.saveDraftAndStop()   // 切后台/来电先落草稿
    this.stopPreviewVoice()
    this.stopAmbient()
    this.releaseAsr()
  },

  onUnload () {
    this.releaseAsr()
    this.stopPreviewVoice()
    this.stopAmbient()
  },

  // 环境音（05 岩岸碎浪）：低音量循环，可在杭航关闭
  startAmbient () {
    if (wx.getStorageSync('ambientOn') === '0' || this._ambient) return
    const a = wx.createInnerAudioContext()
    a.src = '/audio/ambient-05.mp3'
    a.loop = true
    a.volume = 0.22
    a.obeyMuteSwitch = true
    a.play()
    this._ambient = a
  },
  stopAmbient () {
    if (this._ambient) { this._ambient.stop(); this._ambient.destroy(); this._ambient = null }
  },
  // 右上角声音开关
  toggleAmbient () {
    const on = !this.data.ambientOn
    wx.setStorageSync('ambientOn', on ? '1' : '0')
    this.setData({ ambientOn: on })
    if (on && !this.data.recording) this.startAmbient()
    else this.stopAmbient()
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
    this._suppressScale = true
    setTimeout(() => { this._suppressScale = false }, 400)
    const w = sea.buildWorld(life.getStages())
    this._world = w
    this._regions = w.regions
    let mx = w.movX, my = w.movY
    if (keepPosition) {
      const info = sea.windowSize()
      const px = this._movX != null ? this._movX : this.data.movX
      const py = this._movY != null ? this._movY : this.data.movY
      const s = this._scale || 1
      mx = Math.max(-(s * w.worldWidth - info.W), Math.min(0, px))
      my = Math.max(-(s * w.worldHeight - info.H), Math.min(0, py))
    }
    this.setData({
      worldWidth: w.worldWidth, worldHeight: w.worldHeight,
      movX: mx, movY: my, tintGradient: w.tint, stages: w.regions,
      seaScale: this._scale || 1   // 重应用用户视角，绝不自动重置
    })
    this.setData({ milestones: sea.layoutMilestones(w.regions) })
    this.updateSeaBg()
  },

  // ==================== 矢量活海：背景尺寸/位置随 pan/zoom 更新（矢量不糊）====================
  updateSeaBg () {
    const s = this._scale || 1
    const mx = this._movX != null ? this._movX : this.data.movX
    const my = this._movY != null ? this._movY : this.data.movY
    this.setData({
      seaTile: 240 * s,
      seaPosX: mx, seaPosY: my,
      seaGradH: (this.data.worldHeight || 2000) * s
    })
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
    this.setData({
      icebergCount: icebergs.length,
      bergs: sea.layoutBergs(icebergs, this._regions, this.data.birthYear, this.lastPublishedId)
    })
  },

  clearNewBerg (pid) {
    const i = (this.data.bergs || []).findIndex((b) => b.id === pid)
    if (i >= 0) this.setData({ [`bergs[${i}].anim`]: this.data.bergs[i].swayAnim })
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
      if (this.data.recording) this.setData({ asrHint: 'offline' })
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
  onLiveScrollTop () { if (this.data.liveFollow) this.setData({ liveFollow: false }) },
  backLatest () { this.setData({ liveFollow: true }) },
  toggleLiveBig () { this.setData({ liveBig: !this.data.liveBig }) },
  toggleLiveExpanded () { this.setData({ liveExpanded: !this.data.liveExpanded, liveFollow: true }) },

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

  flushFrameBuf () {
    const buf = this._frameBuf || []
    this._frameBuf = []
    for (const f of buf) { if (this.asr) this.asr.sendFrame(f) }
  },

  // ==================== 录音（按住说话） ====================
  onHoldStart (e) {
    if (!this.data.recConsent) { ui.toast('先同意录音说明才能说', 2000); return }   // 按住说话不被打断
    this._holdSource = 'button'
    this._holdY = e.touches && e.touches[0] ? e.touches[0].clientY : 0
    this.startRecording('hold')
  },
  // C 录音同意门控
  askConsent () {
    wx.showModal({
      title: '录音前跟您说清楚',
      content: '录音只用来把您的话变成文字和冰山，存在您自己的云空间里，随时可删；不分享就没人听得到。',
      confirmText: '同意', cancelText: '先不用',
      success: (r) => {
        if (r.confirm) {
          wx.setStorageSync('recConsent', '1')
          this.setData({ recConsent: true })
          ui.toast('好了，按住就能说')
        } else {
          this.setData({ whalePaused: true })
          ui.toast('没关系，想说了再同意', 2400)
        }
      }
    })
  },
  onHoldMove (e) {
    if (!this.data.recording || this._holdSource !== 'button') return
    const y = e.touches && e.touches[0] ? e.touches[0].clientY : 0
    const armed = (this._holdY - y) > 80
    if (armed !== this.data.cancelArmed) this.setData({ cancelArmed: armed })
  },
  onHoldEnd () {
    if (!this.data.recording) return
    const cancel = this.data.cancelArmed
    this.setData({ cancelArmed: false })
    if (cancel) this.saveDraftAndStop()
    else this.finishRecording()
  },
  onWhaleLongPress () {
    if (this.data.recording || this.data.preview) return
    this._holdSource = 'whale'
    this.startRecording('hold')
  },
  onContinueStart () {
    const p = this.data.preview
    if (p) { this.tapHaptic(); this.startRecording('hold', p.text || '') }
  },
  onContinueEnd () { if (this.data.recording) this.finishRecording() },

  async startRecording (mode, appendBase) {
    if (this.data.recording) return
    if (this.data.preview && appendBase == null) return   // 复核卡开着只允许续录
    this._appendBase = appendBase != null ? appendBase : null
    this.setData({ recording: true, recordMode: mode, transcript: this._appendBase || '', elapsed: 0, countdown: 0, cancelArmed: false, asrHint: '' })
    this.stopAmbient()   // 录音时关闭环境音，避免干扰识别
    this._pendingText = null
    this._frameBuf = []
    if (wx.vibrateShort) wx.vibrateShort({ type: 'medium' })
    this.ensureAsr()
    this.recorder.start({
      onFrame: (buf) => { if (this.asr) this.asr.sendFrame(buf); else this._frameBuf.push(buf) },
      onTick: (s) => this.setData({ elapsed: s }),
      onCountdown: (left) => {
        this.setData({ countdown: left })
        if (left <= 3 && wx.vibrateShort) wx.vibrateShort({ type: 'light' })
      },
      onStop: async (wavPath, durationMs, err) => {
        this._lastDuration = durationMs
        this.setData({ recording: false, countdown: 0, elapsed: 0, recordMode: '', whalePaused: false, cancelArmed: false })
        this.startAmbient()   // 录完恢复环境音（若开关为开）
        this.applyTranscript()
        if (this.cancelRequested) {
          this.cancelRequested = false
          if (wavPath || (this.data.transcript || '').trim()) {
            draft.save({ wavPath: wavPath || '', text: this.data.transcript, reason: '未说完' })
            this.setData({ drafts: draft.list(), transcript: '' })
          }
          return
        }
        if (err) {
          const em = (err && (err.errMsg || err.message)) || ''
          if (/auth|permission|deny|authorize/i.test(em)) return this.guideOpenSetting()
          if (wavPath && durationMs >= 800) {
            draft.save({ wavPath, text: this.data.transcript, reason: '录音中断' })
            this.setData({ drafts: draft.list(), transcript: '' })
            ui.toast('录音中断了，已经帮您存下来', 2600)
          } else ui.toast('录音中断了，再说一次')
          return
        }
        if (durationMs < 800) return ui.toast('太短了，多说几句')
        const full = (this.data.transcript || '').trim()
        if (this._appendBase != null) { this._appendBase = null; this.appendToPreview(wavPath, full) }
        else this.openPreview(wavPath, full)
      }
    })
  },

  finishRecording () { if (this.recorder.recording) this.recorder.stop() },

  saveDraftAndStop () {
    if (!this.recorder.recording) return
    this.cancelRequested = true
    this.recorder.stop()
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
  onBgLoad () { if (!this.data.bgLoaded) this.setData({ bgLoaded: true }) },
  onSceneTouchStart () { this._seaTouching = true; if (!this.data.whalePaused) this.setData({ whalePaused: true }) },
  onSceneTouchEnd () {
    this._seaTouching = false
    if (this.data.recording && this._holdSource === 'whale') return this.finishRecording()
    if (!this.data.recording && this.data.whalePaused) this.setData({ whalePaused: false })
  },
  onWhaleTap () { wx.navigateTo({ url: '/pages/stages/stages' }) },
  onBergTap (e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/iceberg/iceberg?id=${id}` })
  },
  onSeaChange (e) { this._movX = e.detail.x; this._movY = e.detail.y; this.updateSeaBg() },
  // 双指捏合缩放（聚拢缩小 / 打开放大）
  onSeaScale (e) {
    // 只认用户双指捏合（有触摸）；页面重排的伪 scale 事件一律忽略
    if (this._suppressScale || !this._seaTouching) return
    this._scale = e.detail.scale
    getApp().globalData.seaScale = e.detail.scale   // 会话内记住用户视角
    this.setData({ seaScale: e.detail.scale })
    this.updateSeaBg()
  },

  onBergDragStart (e) {
    this._dragId = e.currentTarget.dataset.id
    this._dragIdx = Number(e.currentTarget.dataset.i)
    this.setData({ movableDisabled: true })
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
    ui.toast('拖到别的海，松手放下', 1600)
  },
  onBergDragMove (e) {
    if (!this._dragId || e.currentTarget.dataset.id !== this._dragId) return
    const b = this.data.bergs[this._dragIdx]
    if (!b) return
    const p = this._worldPoint(e.touches[0])
    this.setData({ [`bergs[${this._dragIdx}].left`]: p.x - b.width / 2, [`bergs[${this._dragIdx}].top`]: p.y - b.width / 2 })
  },
  async onBergDragEnd (e) {
    if (!this._dragId) return
    const id = this._dragId, i = this._dragIdx
    this._dragId = null
    this.setData({ movableDisabled: false })
    const b = this.data.bergs[i]
    if (!b) return
    const t = (e.changedTouches && e.changedTouches[0]) || {}
    const p = t.clientX != null ? this._worldPoint(t) : { x: b.left + b.width / 2, y: b.top + b.width / 2 }
    const g = sea.regionAt(this._regions, p.x, p.y)
    if (!g) return this.refreshData()
    const r = g.r || 120
    const offX = Math.max(-0.85, Math.min(0.85, (p.x - g.cx) / r))
    const offY = Math.max(-0.85, Math.min(0.85, (p.y - g.cy) / r))
    try {
      await api.updateIceberg(id, { zoneName: g.key, offX, offY })
      ui.toast('移到' + g.key + '之海', 1800)
    } catch (err) { ui.toast('没移过去，再试试') }
    this.refreshData()
  },
  _worldPoint (touch) {
    const mx = this._movX != null ? this._movX : this.data.movX
    const my = this._movY != null ? this._movY : this.data.movY
    const s = this._scale || 1
    return { x: (touch.clientX - mx) / s, y: (touch.clientY - my) / s }
  },

  // ==================== 草稿 / 复核 / 发布 ====================
  recoverDraft () {
    const list = draft.list()
    if (!list.length) return this.setData({ drafts: [] })
    const d = list[0]
    draft.remove(d.at)
    this.setData({ drafts: draft.list() })
    this.openPreview(d.wavPath || '', d.text || '')
  },

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
      try { r = await api.analyzeMemory(finalText, (p.blanks || []).map((b) => b.topic)) }
      catch (e) { console.warn(e); this.setData({ previewStatus: 'failed' }) }
    }
    p = this.data.preview
    if (!p || p.wavPath !== wavPath) return
    const stages = life.getStages()
    // 默认保留讲述者原话（逐字）；AI 小标题可选、可一键还原
    const upd = { 'preview.rawText': finalText, 'preview.audioOnly': !finalText && !!wavPath, 'preview.zoneOptions': stages.map((s) => s.key), 'preview._aiTitle': (r && r.title) || '', 'preview._four': (r && r.four) || '', 'preview.showTitle': false }
    // AI 标题直接加在文字上方（不可关，但可在框内直接点改）；四字名字另存 _four
    if (finalText) upd['preview.text'] = (r && r.title) ? `${r.title}\n${finalText}` : finalText
    Object.assign(upd, this.computeTimeZone(finalText))
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
  runRefine (id, rawText, blanks) {
    let lines = (this.asr && this.asr.getLines) ? this.asr.getLines() : []
    if (!lines.length) {
      const segs = String(rawText || '').split(/(?<=[。！？!?；;])/).filter(Boolean)
      const dur = (this._lastDuration || 10000) / 1000
      lines = segs.map((t, i) => ({ n: i, t: +((i / Math.max(1, segs.length)) * dur).toFixed(2), seg: '初录', text: t, estimated: true }))
    }
    const knownTitles = (this._icebergs || []).map((b) => b.title).filter(Boolean)
    wx.cloud.callFunction({
      name: 'refine',
      data: { lines, birthYear: this.data.birthYear, stageKeys: life.getStages().map((s) => s.key), knownTitles, blanks: (blanks || []).map((b) => b.topic), style: wx.getStorageSync('polishStyle') || 'light' }
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
        await api.updateIceberg(p.editId, { text: body, audioFileID, zoneName, memoryTime: timeValue })
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
      wx.hideLoading()
      ui.toast(p.editId ? '补好了，冰山更新了' : '一座新的冰山入海了', 2400)
      await this.refreshData()
      const g = (this._regions || []).find((x) => x.key === zoneName)
      if (g) {
        const c = sea.centerOn(g, this._world, this._scale)
        this._movX = c.movX; this._movY = c.movY
        this.setData(c)
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
    ui.toast('存好了，随时能找回来', 2200)
  },
  // 按压轻震（无超调回弹）
  tapHaptic () { if (wx.vibrateShort) wx.vibrateShort({ type: 'light' }) },

  // 存草稿：点了就存，不弹窗
  saveDraftNow () {
    const p = this.data.preview
    if (!p) return
    this.stopPreviewVoice()
    draft.save({ wavPath: p.wavPath, text: p.text, reason: '存草稿' })
    this.setData({ preview: null, drafts: draft.list() })
    ui.toast('存草稿了，随时能找回来', 2200)
  },
  // ❌ 化成云：有必要再找回（云朵落回海面），没必要就删除
  async discardToCloud () {
    const p = this.data.preview
    if (!p) return
    this.stopPreviewVoice()
    const text = (p.text || '').trim() || '（这段只留了声音）'
    try {
      const created = await api.createIceberg({
        text, audioPath: p.wavPath, photos: p.photos,
        timeValue: p._autoYear ? String(p._autoYear) : (p.zoneOptions[p.zoneIndex] || '说不清了'),
        zoneName: p.zoneOptions[p.zoneIndex] || '晚年',
        title: p._four || text.slice(0, 4)
      })
      await api.removeIceberg(created._id)   // deleted=true → 进云朵
      draft.forgetPath(p.wavPath)
      this.setData({ preview: null, drafts: draft.list() })
      ui.toast('化成云了，在云朵里能找回', 2400)
      this.refreshData()
    } catch (e) {
      draft.save({ wavPath: p.wavPath, text: p.text, reason: '化云失败' })
      this.setData({ preview: null, drafts: draft.list() })
      ui.toast('没化成，先存草稿了', 2400)
    }
  }
})