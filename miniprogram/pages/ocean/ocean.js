// pages/ocean/ocean.js — 人生海洋主界面（鸟瞰矢量海面 P0）
// 渲染：独立 SVG 资源 + <image> + WXSS 关键帧 + z-index 深度分层（零 Canvas）。
//
// 适老化要点（沿用定稿）：
//  1) 录音主入口 = 底部大按钮「点一下开始 / 说完了再点」；长按鲸鱼 = 副入口。
//  2) 手指一落下，杭航立刻定住（animation-play-state:paused），目标不跑。
//  3) 冰山/鲸鱼热区由 WXML 元素承载，不小于 112rpx。
//  4) 任何异常路径（断网/来电/切后台/识别失败）都先落地本地草稿，绝不白说。
//  5) 顶部元素按微信胶囊位置下移。
// 业务逻辑（录音/ASR/复核/发布/草稿/导航）与 Canvas 版逐字一致，仅渲染层替换。
const { createRecorder, MAX_SECONDS } = require('../../utils/recorder')
const api = require('../../utils/api')
const draft = require('../../utils/draft')

// 海面冰山布点（左%、顶%、宽 px、所在深度层）——确定性布局，新回忆循环落位
// 空灵俯视：冰山小而分散（远小淡、近大），2-3 段回忆时大片留白，多了也不挤
const BERG_SLOTS = [
  { l: 12, t: 11, w: 26, layer: 'far' },
  { l: 70, t: 8, w: 22, layer: 'far' },
  { l: 45, t: 19, w: 24, layer: 'far' },
  { l: 24, t: 15, w: 20, layer: 'far' },
  { l: 84, t: 20, w: 28, layer: 'far' },
  { l: 7, t: 37, w: 40, layer: 'mid' },
  { l: 79, t: 32, w: 34, layer: 'mid' },
  { l: 30, t: 44, w: 38, layer: 'mid' },
  { l: 55, t: 38, w: 30, layer: 'mid' },
  { l: 16, t: 52, w: 44, layer: 'mid' },
  { l: 68, t: 50, w: 36, layer: 'mid' },
  { l: 29, t: 60, w: 52, layer: 'near' },
  { l: 63, t: 63, w: 46, layer: 'near' },
  { l: 14, t: 70, w: 50, layer: 'near' },
  { l: 80, t: 68, w: 44, layer: 'near' },
  { l: 46, t: 72, w: 48, layer: 'near' }
]
const SIZE_SCALE = { small: 0.8, medium: 1, large: 1.15 }
const BERG_DROP = 'bergdrop 0.95s cubic-bezier(0.22,1.2,0.36,1) both'

Page({
  data: {
    capsuleBottom: 88,   // 微信胶囊下沿，顶部元素据此避让
    // 插画场景
    bgLoaded: false,
    farBergs: [],
    midBergs: [],
    nearBergs: [],
    whalePaused: false,
    // 录音（微信式按住说话 + 流式转写）
    recording: false,
    recordMode: '',      // 'hold' 按住（大按钮 / 鲸鱼）
    cancelArmed: false,  // 上滑进入取消态
    transcript: '',
    asrHint: '',         // ''=实时识别正常 | 'connecting'=连接中 | 'offline'=没连上
    elapsed: 0,
    countdown: 0,
    maxSeconds: MAX_SECONDS,
    // 发布卡片
    preview: null,
    previewVoicePlaying: false,
    analyzing: false,
    publishing: false,
    drafts: [],
    icebergCount: 0
  },

  onLoad () {
    this.asr = null
    this.previewAudio = null
    this.recorder = createRecorder()
    this.setData({
      firstLaunch: getApp().globalData.firstLaunch,
      capsuleBottom: this.safeTop()
    })
  },

  // 胶囊下沿：顶部元素从这条线以下开始排，避开状态栏和胶囊
  safeTop () {
    try {
      const r = wx.getMenuButtonBoundingClientRect()
      if (r && r.bottom) return r.bottom
    } catch (e) { /* 部分环境无此 API，走兜底 */ }
    const info = wx.getWindowInfo ? wx.getWindowInfo() : {}
    return (info.statusBarHeight || 20) + 44
  },

  onShow () {
    if (this.data.firstLaunch) {
      this.setData({ firstLaunch: false })
      wx.navigateTo({ url: '/packageGuide/pages/guide/guide' })
      return
    }
    this.refreshData()
    this.setData({ drafts: draft.list(), whalePaused: false })
    // 预热实时识别连接：妈妈点录音时不用再等建连，开口即出字
    this.preheatAsr()
    // 预热麦克风授权：按住说话时 0 延迟开口，不再等授权弹窗
    wx.authorize({ scope: 'scope.record' }).catch(() => {})
  },

  onHide () {
    // 切后台/来电：正在录音就先落地成草稿，回来能找回
    if (this.data.recording) this.saveDraftAndStop()
    if (this._dbgTimer) { clearInterval(this._dbgTimer); this._dbgTimer = null }
    this.stopPreviewVoice()
    // 后台会杀 socket，回前台 onShow 会重新预热，这里主动释放避免僵尸连接
    this.releaseAsr()
  },

  onUnload () {
    if (this._dbgTimer) { clearInterval(this._dbgTimer); this._dbgTimer = null }
    this.releaseAsr()
    this.stopPreviewVoice()
  },

  // ==================== 实时识别：预热与复用 ====================
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
    } catch (e) {
      console.warn('[ocean] 预热连接失败，点录音时会重试:', e)
      this.setData({ asrHint: 'offline' })
    }
  },

  bindAsr (asr) {
    asr.on('partial', (text) => this.flushTranscript(text))
    asr.on('sentence', (text) => this.flushTranscript(text, true))
    asr.on('ready', () => this.flushFrameBuf())
    asr.on('error', (e) => {
      if (this.data.recording) this.setData({ asrHint: 'offline' })
      console.warn('[asr] error:', e && e.message)
    })
  },

  flushTranscript (text, force) {
    this._pendingText = text
    if (force) { this.applyTranscript(); return }
    const now = Date.now()
    if (now - (this._lastTranscriptAt || 0) >= 100) {
      this.applyTranscript()
    } else if (!this._transcriptTimer) {
      this._transcriptTimer = setTimeout(() => {
        this._transcriptTimer = null
        this.applyTranscript()
      }, 100)
    }
  },

  applyTranscript () {
    this._lastTranscriptAt = Date.now()
    if (this._pendingText != null) this.setData({ transcript: this._pendingText })
  },

  releaseAsr () {
    if (this._transcriptTimer) { clearTimeout(this._transcriptTimer); this._transcriptTimer = null }
    if (this._pendingText != null) { this.setData({ transcript: this._pendingText }) }
    if (this.asr) { try { this.asr.close() } catch (e) {} this.asr = null }
  },

  // ==================== 数据 ====================
  async refreshData () {
    try {
      const icebergs = await api.listIcebergs()
      this._icebergs = icebergs
      this.setData({ icebergCount: icebergs.length })
      this.layoutBergs(icebergs)
    } catch (e) {
      console.warn('数据加载失败（可能未创建集合）', e)
      this._icebergs = []
      this.layoutBergs([])
    }
  },

  // 布局：真实回忆 → 鸟瞰海面冰山。支持不限数量追加：按 id 哈希散点 + 深度分层，
  // 新增回忆持续落海（isNew 播落下动画），不做数量截断。
  layoutBergs (icebergs) {
    const far = [], mid = [], near = []
    ;(icebergs || []).forEach((b) => {
      const seed = hash(b._id)
      const layer = b.size === 'large' ? 'near' : b.size === 'small' ? 'far' : 'mid'
      // 深度带：远小淡 / 中 / 近大；带宽与基准尺寸放大，冰山更醒目
      const band = layer === 'far' ? { y0: 8, span: 16, w: 36 }
        : layer === 'mid' ? { y0: 32, span: 24, w: 58 }
          : { y0: 60, span: 16, w: 80 }
      const left = 3 + (seed % 86)
      const top = band.y0 + ((seed >> 4) % band.span)
      const width = Math.round(band.w * (SIZE_SCALE[b.size] || 1))
      const swayDur = (8 + (seed % 40) / 10).toFixed(1)
      const swayDelay = (-(seed % 80) / 10).toFixed(1)
      const swayAnim = `sway ${swayDur}s ease-in-out ${swayDelay}s infinite`
      const isNew = b._id === this.lastPublishedId
      const berg = {
        id: b._id, left, top, width,
        opacity: layer === 'far' ? 0.85 : 1,
        swayAnim,
        anim: isNew ? BERG_DROP : swayAnim
      }
      if (layer === 'far') far.push(berg)
      else if (layer === 'mid') mid.push(berg)
      else near.push(berg)
    })
    this.setData({ farBergs: far, midBergs: mid, nearBergs: near })
  },

  // 新冰山落下动画结束后，切回常态摇曳
  clearNewBerg (pid) {
    ['farBergs', 'midBergs', 'nearBergs'].forEach((k) => {
      const arr = this.data[k] || []
      const i = arr.findIndex((b) => b.id === pid)
      if (i >= 0) this.setData({ [`${k}[${i}].anim`]: arr[i].swayAnim })
    })
  },

  // ==================== 触摸交互（WXML 事件） ====================
  // 插画背景加载完成 → 淡入（弱网时渐变兜底已先显示，不白屏）
  onBgLoad () {
    if (!this.data.bgLoaded) this.setData({ bgLoaded: true })
  },

  // 手指一落下就定住杭航：移动目标变静止目标，好按多了
  onSceneTouchStart () {
    if (!this.data.whalePaused) this.setData({ whalePaused: true })
  },

  onSceneTouchEnd () {
    // 长按鲸鱼说话：松手即结束（和微信语音一致）
    if (this.data.recording && this.data.recordMode === 'hold') { this.finishRecording(); return }
    if (!this.data.recording && this.data.whalePaused) this.setData({ whalePaused: false })
  },

  // 副入口：长按杭航 = 按住说话
  onWhaleLongPress () {
    if (this.data.recording || this.data.analyzing || this.data.preview) return
    this._holdSource = 'whale'
    this.startRecording('hold')
  },

  // 点冰山 = 进详情
  onBergTap (e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/iceberg/iceberg?id=${id}` })
  },

  // ==================== 录音（微信式按住说话 + 流式转写）====================
  // 主入口：按住大按钮说话，松手发送、上滑取消（参考微信语音输入习惯）
  onHoldStart (e) {
    this._holdSource = 'button'
    this._holdY = (e.touches && e.touches[0]) ? e.touches[0].clientY : 0
    this.startRecording('hold')
  },
  onHoldMove (e) {
    if (!this.data.recording || this._holdSource !== 'button') return
    const y = (e.touches && e.touches[0]) ? e.touches[0].clientY : 0
    const armed = (this._holdY - y) > 80   // 上滑超 80px 进入取消态
    if (armed !== this.data.cancelArmed) this.setData({ cancelArmed: armed })
  },
  onHoldEnd () {
    if (!this.data.recording) return
    const cancel = this.data.cancelArmed
    this.setData({ cancelArmed: false })
    if (cancel) this.saveDraftAndStop()   // 上滑松手 = 取消（落草稿，不丢）
    else this.finishRecording()           // 松手 = 发送（进复核）
  },

  // 确保有一条实时识别连接：复用预热 / 立即建连 / 缺配置则后台登录补，均不阻塞开口
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
      // 配置还没到（登录未回）：后台登录，到了再建连；期间麦克风帧先存页面缓存
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

  // 把建连前攒下的麦克风帧补发给识别服务
  flushFrameBuf () {
    const b = this._frameBuf || []
    this._frameBuf = []
    for (const f of b) { if (this.asr) this.asr.sendFrame(f) }
  },

  async startRecording (mode) {
    if (this.data.recording || this.data.analyzing || this.data.preview) return
    // 0 延迟：手指一按立刻弹出实时转写面板（微信式），授权/建连在后台进行
    this.setData({ recording: true, recordMode: mode, transcript: '', elapsed: 0, countdown: 0, cancelArmed: false, asrHint: '' })
    this._pendingText = null
    this._recFrames = 0
    this._frameBuf = []
    if (wx.vibrateShort) wx.vibrateShort({ type: 'medium' })
    // 建连/登录后台进行；麦克风立即开录（授权已在 onShow 预热），一帧都不丢
    this.ensureAsr()
    this.recorder.start({
      onFrame: (buf) => { this._recFrames = (this._recFrames || 0) + 1; if (this.asr) this.asr.sendFrame(buf); else this._frameBuf.push(buf) },
      onTick: (s) => this.setData({ elapsed: s }),
      onCountdown: (left) => {
        this.setData({ countdown: left })
        if (left <= 3 && wx.vibrateShort) wx.vibrateShort({ type: 'light' })
      },
      onStop: async (wavPath, durationMs, err) => {
        if (this._dbgTimer) { clearInterval(this._dbgTimer); this._dbgTimer = null }
        this.setData({ recording: false, countdown: 0, elapsed: 0, recordMode: '', whalePaused: false, cancelArmed: false })
        // 松手瞬间先把界面上已有的字定住（节流可能还压着最后一小段）
        this.applyTranscript()

        // 用户主动中止 / 切后台：仍然把已录到的音频+文字落地成草稿
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
          if (/auth|permission|deny|authorize/i.test(em)) { this.guideOpenSetting(); return }
          if (wavPath && durationMs >= 800) {
            draft.save({ wavPath, text: this.data.transcript, reason: '录音中断' })
            this.setData({ drafts: draft.list(), transcript: '' })
            wx.showToast({ title: '录音中断了，已经帮您存下来', icon: 'none', duration: 2600 })
          } else {
            wx.showToast({ title: '录音中断了，再说一次', icon: 'none' })
          }
          return
        }
        if (durationMs < 800) {
          wx.showToast({ title: '太短了，多说几句', icon: 'none' })
          return
        }

        // 0 等待：松手立即进复核卡；流式收尾 / AI 建议 / 兜底转写全部后台补
        this.openPreview(wavPath, (this.data.transcript || '').trim())
      }
    })
  },

  // 兜底转写：WAV 上传云存储 → transcribe 云函数
  async fallbackTranscribe (wavPath) {
    // 后台兜底，不弹 loading 遮罩（复核卡已先展示，不打断用户）
    let fileID = ''
    const cleanup = () => { if (fileID) wx.cloud.deleteFile({ fileList: [fileID] }).catch(() => {}) }
    try {
      const up = await wx.cloud.uploadFile({ cloudPath: `tmp_asr/${Date.now()}.wav`, filePath: wavPath })
      fileID = up.fileID
      const res = await wx.cloud.callFunction({ name: 'transcribe', data: { fileID } })
      const r = res.result || {}
      if (r.ok && r.text) { cleanup(); return r.text }
      console.warn('兜底转写失败:', r.error)
      cleanup()
      return ''
    } catch (e) {
      console.error('兜底转写异常:', e)
      cleanup()
      return ''
    }
  },

  finishRecording () {
    if (!this.recorder.recording) return
    this.recorder.stop()
  },

  // 不录了：明确二次确认，避免误触丢掉一整段话
  cancelRecording () {
    wx.showModal({
      title: '这段就不要了吗？',
      content: '点"先存下来"，刚才说的话会放进草稿，回头还能找回来；点"继续说"就接着录。',
      confirmText: '先存下来',
      cancelText: '继续说',
      confirmColor: '#24648F',
      cancelColor: '#C0392B',
      success: (r) => {
        if (r.confirm) this.saveDraftAndStop()
      }
    })
  },

  // 中止录音并落地草稿
  saveDraftAndStop () {
    if (!this.recorder.recording) return
    this.cancelRequested = true
    this.recorder.stop()
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
  },

  guideOpenSetting () {
    wx.showModal({
      title: '需要麦克风权限',
      content: '说话要用到麦克风。点"去设置"，把「人生海海」的麦克风打开，回来就能说了。',
      confirmText: '去设置',
      cancelText: '先不了',
      confirmColor: '#24648F',
      success: (r) => { if (r.confirm) wx.openSetting() }
    })
  },

  // ==================== 草稿找回 ====================
  recoverDraft () {
    const list = draft.list()
    if (!list.length) { this.setData({ drafts: [] }); return }
    const d = list[0]
    draft.remove(d.at)
    this.setData({ drafts: draft.list() })
    if (d.wavPath) this.openPreview(d.wavPath, d.text || '')
    else this.openPreview('', d.text || '')
  },

  // ==================== 发布卡片 ====================
  async openPreview (wavPath, text) {
    const hasText = text && text.replace(/\s/g, '').length >= 2
    // 0 等待：复核卡立即弹出（先给默认选项），AI 建议/流式收尾后台补
    this.setData({
      preview: {
        wavPath, text: text || '', rawText: text || '', audioOnly: !hasText && !!wavPath,
        timeOptions: ['说不清了'], timeIndex: 0,
        zoneOptions: ['新的开始'], zoneIndex: 0,
        photos: [], previewVoicePlaying: false
      }
    })
    if (!hasText && wavPath) wx.showToast({ title: '没听清，可以先存声音，或直接打字', icon: 'none', duration: 3000 })
    this.refinePreview(wavPath, text || '')
  },

  // 后台补全复核卡：流式收尾定稿 → 无字则兜底转写 → AI 时间/海域/标题建议（不阻塞用户）
  async refinePreview (wavPath, text) {
    let finalText = (text || '').trim()
    if (this.asr) {
      const live = this.asr.isReady
      const t = await this.asr.finish(1200).catch(() => '')
      if (t && t.trim().length > finalText.length) finalText = t.trim()
      if (live) this.asr.startKeepAlive()
      else { this.releaseAsr(); this.preheatAsr() }
    }
    if (!finalText && wavPath) {
      finalText = (await this.fallbackTranscribe(wavPath).catch(() => '')) || ''
    }
    let p = this.data.preview
    if (!p || p.wavPath !== wavPath) return   // 用户已关闭/换了一段
    let r = null
    if (finalText.replace(/\s/g, '').length >= 2) {
      try { r = await api.analyzeMemory(finalText) } catch (e) { console.warn(e) }
    }
    p = this.data.preview
    if (!p || p.wavPath !== wavPath) return
    const upd = { 'preview.rawText': finalText, 'preview.audioOnly': !finalText && !!wavPath }
    if (finalText) upd['preview.text'] = (r && r.title) ? `${r.title}\n${finalText}` : finalText
    if (r && r.timeOptions && r.timeOptions.length) { upd['preview.timeOptions'] = r.timeOptions; upd['preview.timeIndex'] = 0 }
    if (r && r.zoneOptions && r.zoneOptions.length) { upd['preview.zoneOptions'] = r.zoneOptions; upd['preview.zoneIndex'] = 0 }
    this.setData(upd)
  },

  onPreviewInput (e) {
    const v = e.detail.value
    const p = this.data.preview
    this.setData({
      'preview.text': v,
      'preview.audioOnly': !v.trim() && !!(p && p.wavPath)
    })
  },

  pickTime (e) { this.setData({ 'preview.timeIndex': Number(e.currentTarget.dataset.i) }) },
  pickZone (e) { this.setData({ 'preview.zoneIndex': Number(e.currentTarget.dataset.i) }) },

  stopPreviewVoice () {
    if (this.previewAudio) {
      this.previewAudio.stop()
      this.previewAudio.destroy()
      this.previewAudio = null
    }
    if (this.data.previewVoicePlaying) this.setData({ previewVoicePlaying: false })
  },

  playPreviewVoice () {
    const p = this.data.preview
    if (!p || !p.wavPath) return
    if (this.data.previewVoicePlaying) { this.stopPreviewVoice(); return }
    this.previewAudio = wx.createInnerAudioContext()
    this.previewAudio.obeyMuteSwitch = false   // iOS 静音键下也出声
    this.previewAudio.onEnded(() => this.setData({ previewVoicePlaying: false }))
    this.previewAudio.onError(() => {
      this.setData({ previewVoicePlaying: false })
      wx.showToast({ title: '声音放不出来', icon: 'none' })
    })
    this.previewAudio.src = p.wavPath
    this.previewAudio.play()
    this.setData({ previewVoicePlaying: true })
  },

  addPhoto () {
    wx.chooseMedia({
      count: 9 - this.data.preview.photos.length,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (r) => {
        const photos = this.data.preview.photos.concat(r.tempFiles.map((f) => f.tempFilePath))
        this.setData({ 'preview.photos': photos })
      }
    })
  },

  previewDraftPhoto (e) {
    const i = Number(e.currentTarget.dataset.i)
    wx.previewImage({ current: this.data.preview.photos[i], urls: this.data.preview.photos })
  },

  removePhoto (e) {
    const i = Number(e.currentTarget.dataset.i)
    wx.showModal({
      title: '删掉这张照片吗？',
      content: '删了就不能找回来了。',
      confirmText: '删掉',
      cancelText: '留着',
      confirmColor: '#C0392B',
      cancelColor: '#24648F',
      success: (r) => {
        if (!r.confirm) return
        const photos = this.data.preview.photos.slice()
        photos.splice(i, 1)
        this.setData({ 'preview.photos': photos })
      }
    })
  },

  async publish () {
    if (this.data.publishing) return
    const p = this.data.preview
    const text = (p.text || '').trim()
    if (!text && !p.audioOnly) {
      wx.showToast({ title: '先说一句话，或打几个字', icon: 'none' })
      return
    }
    const body = text || '（这段只留了声音，以后可以补字）'
    this.setData({ publishing: true })
    wx.showLoading({ title: '冰山生成中…', mask: true })
    try {
      const created = await api.createIceberg({
        text: body,
        audioPath: p.wavPath,
        photos: p.photos,
        timeValue: p.timeIndex >= 0 ? p.timeOptions[p.timeIndex] : '说不清了',
        zoneName: p.zoneIndex >= 0 ? p.zoneOptions[p.zoneIndex] : '新的开始',
        title: (p.rawText && body.startsWith(p.rawText)) ? '' : body.split('\n')[0].slice(0, 12)
      })
      this.lastPublishedId = created && created._id
      this.stopPreviewVoice()
      draft.forgetPath(p.wavPath)
      this.setData({ preview: null, publishing: false, drafts: draft.list() })
      wx.hideLoading()
      wx.showToast({ title: '一座新的冰山入海了', icon: 'none', duration: 2400 })
      await this.refreshData()
      // 新冰山播完落下动画后切回常态摇曳
      if (this.lastPublishedId) {
        const pid = this.lastPublishedId
        setTimeout(() => this.clearNewBerg(pid), 1100)
      }
    } catch (e) {
      wx.hideLoading()
      this.setData({ publishing: false })
      console.error(e)
      draft.save({ wavPath: p.wavPath, text: body, reason: '发布失败' })
      this.setData({ drafts: draft.list() })
      wx.showModal({
        title: '没存上去',
        content: '可能是网络不太好。您说的这段已经帮您存下来了，等网络好了点"找回来"就能接着存。',
        showCancel: false,
        confirmText: '知道了',
        confirmColor: '#24648F'
      })
    }
  },

  // 不要了：二次确认 + 给"存下来"的台阶
  discardPreview () {
    const p = this.data.preview
    if (!p) return
    this.stopPreviewVoice()
    wx.showModal({
      title: '这段回忆就不要了吗？',
      content: '点"存起来"会放进草稿，回头还能找回来；点"丢掉"才真的不要了。',
      confirmText: '存起来',
      cancelText: '再想想',
      confirmColor: '#24648F',
      cancelColor: '#445A6A',
      success: (r) => {
        if (!r.confirm) return
        draft.save({ wavPath: p.wavPath, text: p.text, reason: '暂未发布' })
        this.setData({ preview: null, drafts: draft.list() })
        wx.showToast({ title: '存好了，随时能找回来', icon: 'none', duration: 2400 })
      }
    })
  },

  // ==================== 导航 ====================
  goTimeline () { wx.navigateTo({ url: '/pages/timeline/timeline' }) },
  goRecycle () { wx.navigateTo({ url: '/pages/recycle/recycle' }) }
})

function hash (s) { let h = 0; for (let i = 0; i < (s || '').length; i++) { h = (h * 31 + s.charCodeAt(i)) % 1e9 } return h }