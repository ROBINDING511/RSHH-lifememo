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
    ambientOn: true
  },

  onLoad (query) {
    this.asr = null
    this.previewAudio = null
    this.recorder = createRecorder()
    this.setData({
      firstLaunch: getApp().globalData.firstLaunch,
      capsuleBottom: this.safeTop(),
      familyOwner: wx.getStorageSync('familyOwner') || null
    })
    if (query && query.edit) this.loadForEdit(query.edit)
  },

  onShow () {
    if (this.data.firstLaunch) {
      this.setData({ firstLaunch: false })
      wx.navigateTo({ url: '/packageGuide/pages/guide/guide' })
      return
    }
    this.setupWorld(this._worldInited)   // 首次居中；之后保留上次游到的位置
    this._worldInited = true
    this.setData({ birthYear: life.getBirthYear(), drafts: draft.list(), whalePaused: false, ambientOn: wx.getStorageSync('ambientOn') !== '0' })
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
      movX: mx, movY: my, tintGradient: w.tint, stages: w.regions
    })
    this.setData({ milestones: sea.layoutMilestones(w.regions) })
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
    this.setData({ transcript: t })
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
    this._holdSource = 'button'
    this._holdY = e.touches && e.touches[0] ? e.touches[0].clientY : 0
    this.startRecording('hold')
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
    if (p) this.startRecording('hold', p.text || '')
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
  onSceneTouchStart () { if (!this.data.whalePaused) this.setData({ whalePaused: true }) },
  onSceneTouchEnd () {
    if (this.data.recording && this._holdSource === 'whale') return this.finishRecording()
    if (!this.data.recording && this.data.whalePaused) this.setData({ whalePaused: false })
  },
  onWhaleTap () { wx.navigateTo({ url: '/pages/stages/stages' }) },
  onBergTap (e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/iceberg/iceberg?id=${id}` })
  },
  onSeaChange (e) { this._movX = e.detail.x; this._movY = e.detail.y },
  // 双指捏合缩放（聚拢缩小 / 打开放大）
  onSeaScale (e) { this._scale = e.detail.scale; this.setData({ seaScale: e.detail.scale }) },

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
        timeLabel: '', _autoYear: null, showTitle: false, _aiTitle: '',
        editId: (opts && opts.editId) || null, extraWavs: [],
        photos: [], previewVoicePlaying: false
      }
    })
    if (!hasText && wavPath) ui.toast('没听清，可以先存声音，或直接打字', 3000)
    this.refinePreview(wavPath, text || '')
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
      try { r = await api.analyzeMemory(finalText) } catch (e) { console.warn(e) }
    }
    p = this.data.preview
    if (!p || p.wavPath !== wavPath) return
    const stages = life.getStages()
    // 默认保留讲述者原话（逐字）；AI 小标题可选、可一键还原
    const upd = { 'preview.rawText': finalText, 'preview.audioOnly': !finalText && !!wavPath, 'preview.zoneOptions': stages.map((s) => s.key), 'preview._aiTitle': (r && r.title) || '', 'preview.showTitle': false }
    if (finalText) upd['preview.text'] = finalText
    // 年份("2017年")或岁数("14岁") → 换算年龄 → 自动归海；不再瞎归晚年
    const ym = finalText.match(/((?:19|20)\d{2})\s*年/)
    const age = life.parseAge(finalText)
    if (ym && this.data.birthYear) {
      const yr = Number(ym[1])
      const a = yr - this.data.birthYear
      upd['preview.timeLabel'] = `${yr}年 · ${a}岁`
      upd['preview.zoneIndex'] = stages.findIndex((x) => x.key === life.stageOfAge(a).key)
      upd['preview._autoYear'] = yr
    } else if (age != null && this.data.birthYear) {
      const yr = life.eventYear(this.data.birthYear, age)
      upd['preview.timeLabel'] = `${yr}年 · ${age}岁`
      upd['preview.zoneIndex'] = stages.findIndex((x) => x.key === life.stageOfAge(age).key)
      upd['preview._autoYear'] = yr
    } else upd['preview.timeLabel'] = ''
    this.setData(upd)
  },

  appendToPreview (wavPath, fullText) {
    const p = this.data.preview
    if (!p) return
    this.setData({
      recording: false, recordMode: '',
      'preview.text': fullText, 'preview.audioOnly': false,
      'preview.extraWavs': (p.extraWavs || []).concat(wavPath ? [wavPath] : [])
    })
    ui.toast('接上了，可继续说或变成冰山')
  },

  onPreviewInput (e) {
    const v = e.detail.value
    const p = this.data.preview
    this.setData({ 'preview.text': v, 'preview.audioOnly': !v.trim() && !!(p && p.wavPath) })
  },

  // AI 小标题开关 / 一键还原逐字（保住妈妈的原话）
  toggleTitle () {
    const p = this.data.preview
    if (!p) return
    const on = !p.showTitle
    this.setData({ 'preview.showTitle': on, 'preview.text': on && p._aiTitle ? `${p._aiTitle}\n${p.rawText}` : p.rawText })
  },
  revertRaw () {
    const p = this.data.preview
    if (!p) return
    this.setData({ 'preview.showTitle': false, 'preview.text': p.rawText })
    ui.toast('已还原逐字')
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
          title: (p.rawText && body.startsWith(p.rawText)) ? '' : body.split('\n')[0].slice(0, 12)
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
    } catch (e) {
      wx.hideLoading()
      this.setData({ publishing: false })
      console.error(e)
      draft.save({ wavPath: p.wavPath, text: body, reason: '发布失败' })
      this.setData({ drafts: draft.list() })
      await ui.confirm({ title: '没存上去', content: '可能是网络不太好。您说的这段已经帮您存下来了，等网络好了点"找回来"就能接着存。', confirmText: '知道了', cancelText: '知道了' })
    }
  },

  async discardPreview () {
    const p = this.data.preview
    if (!p) return
    this.stopPreviewVoice()
    const r = await ui.confirm({
      title: '这段回忆就不要了吗？',
      content: '点"存起来"会放进草稿，回头还能找回来；点"丢掉"才真的不要了。',
      confirmText: '存起来', cancelText: '丢掉'
    })
    if (r === 'confirm') {
      draft.save({ wavPath: p.wavPath, text: p.text, reason: '暂未发布' })
      this.setData({ preview: null, drafts: draft.list() })
      ui.toast('存好了，随时能找回来', 2400)
    } else {
      draft.forgetPath(p.wavPath)
      this.setData({ preview: null })
      ui.toast('丢掉了')
    }
  }
})