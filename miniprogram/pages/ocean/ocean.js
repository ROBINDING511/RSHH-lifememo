// pages/ocean/ocean.js — 人生海洋主界面
// 渲染：Canvas 2D（杭航慢游、冰山摇曳、波浪、缩放）
//
// 适老化改造要点：
//  1) 录音主入口改为底部大按钮「点一下开始 / 说完了再点一下」——不再要求老人
//     追着游动的鲸鱼按住 60 秒（手抖、反应慢时几乎做不到）。
//     长按鲸鱼保留为副入口（按住说话，和微信语音一致）。
//  2) 手指一落下，杭航立刻定住不动，目标不会跑。
//  3) 触控热区放大：鲸鱼命中区、冰山命中区都以中心外扩，不小于 112rpx。
//  4) 抖动容忍从 10px 放宽到 20px，避免老人手抖把长按打断。
//  5) 任何异常路径（断网/来电/切后台/识别失败）都先把录音落地为本地草稿，
//     回来提示"找回来"，妈妈说的话绝不白说。
//  6) 顶部元素按微信胶囊位置下移，不再被状态栏压住、不再和胶囊打架。
const { createRecorder, MAX_SECONDS } = require('../../utils/recorder')
const api = require('../../utils/api')
const assets = require('../../utils/assets')
const draft = require('../../utils/draft')

const HOLD_MS = 300      // 长按判定
const JITTER_PX = 20     // 长按期间的抖动容忍（原 10px 对手抖老人太苛刻）
const MIN_HIT = 56       // 热区最小边长（px），= 112rpx
const WHALE_W = 84       // 杭航绘制宽度（原 60，偏小难点中）

Page({
  data: {
    viewLevel: 'global', // global | zone
    currentZone: null,
    capsuleBottom: 88,   // 微信胶囊下沿，顶部元素据此避让
    // 录音
    recording: false,
    recordMode: '',      // 'tap' 点按 | 'hold' 长按鲸鱼
    transcript: '',
    asrHint: '',         // ''=实时识别正常 | 'connecting'=连接中 | 'offline'=没连上（松手后自动整理）
    elapsed: 0,
    countdown: 0,
    // 发布卡片
    preview: null, // { wavPath, text, audioOnly, previewVoicePlaying, ... }
    previewVoicePlaying: false,
    analyzing: false,
    publishing: false,
    drafts: [],
    icebergCount: 0
  },

  onLoad () {
    this.camera = { x: 0, scale: 1, tx: 0, tscale: 1 }
    this.whale = { x: 100, y: 100, tx: 200, ty: 300, frame: 0, frameAt: 0, flip: false }
    this.icebergs = []
    this.zoneRects = []
    this.loaded = {}
    this.holdTimer = null
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
    this.initCanvas()
    this.refreshData()
    this.setData({ drafts: draft.list() })
    // 预热实时识别连接：妈妈点录音时不用再等建连，开口即出字
    this.preheatAsr()
  },

  onHide () {
    // 切后台/来电：正在录音就先落地成草稿，回来能找回
    if (this.data.recording) this.saveDraftAndStop()
    this.stopRender()
    this.stopPreviewVoice()
    // 后台会杀 socket，回前台 onShow 会重新预热，这里主动释放避免僵尸连接
    this.releaseAsr()
  },

  onUnload () {
    this.stopRender()
    this.releaseAsr()
    this.stopPreviewVoice()
  },

  // ==================== 实时识别：预热与复用 ====================
  // 预热一条 ASR 连接放着。真机上 socket 会被系统回收，所以预热失败不报错、
  // 只标记 asrHint='connecting'，等真正点录音时再确保连上。
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

  // 统一绑定 ASR 事件：partial/sentence 走节流上屏，error 让界面可见
  bindAsr (asr) {
    asr.on('partial', (text) => this.flushTranscript(text))
    asr.on('sentence', (text) => this.flushTranscript(text, true))
    asr.on('error', (e) => {
      // 录音中报错才提示，且不打断录音（松手后走兜底）
      if (this.data.recording) this.setData({ asrHint: 'offline' })
      console.warn('[asr] error:', e && e.message)
    })
  },

  // setData 节流：识别每 100ms 内最多刷一次屏，force=true 立即刷（定稿用）
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
    // 把还没刷到界面上的最后一点文字先落地，草稿才不会少字
    if (this._pendingText != null) { this.setData({ transcript: this._pendingText }) }
    if (this.asr) { try { this.asr.close() } catch (e) {} this.asr = null }
  },


  // ==================== 数据 ====================
  async refreshData () {
    try {
      const [zones, icebergs] = await Promise.all([api.listZones(), api.listIcebergs()])
      this.zones = zones
      this.setData({ icebergCount: icebergs.length })
      this.layout(zones, icebergs)
      assets.prefetch(zones)
    } catch (e) {
      console.warn('数据加载失败（可能未创建集合）', e)
      this.zones = []
      this.layout([], [])
    }
  },

  // 布局：海域从左到右按时间排布，冰山落在各自海域内
  layout (zones, icebergs) {
    const W = this.W || 375
    const H = this.H || (wx.getWindowInfo ? wx.getWindowInfo().windowHeight : 667)
    const zoneW = Math.max(W * 0.72, 220)
    const startX = 24
    this.zoneRects = zones.map((z, i) => ({ zone: z, x: startX + i * zoneW, w: zoneW }))
    const worldW = startX + zones.length * zoneW + 40
    this.worldW = worldW

    this.icebergs = icebergs.map((b, idx) => {
      const zr = this.zoneRects.find((r) => r.zone._id === b.zoneId) || this.zoneRects[0]
      const base = zr ? zr.x + 30 : 40
      const span = zr ? zr.w - 100 : W - 120
      const seed = hash(b._id)
      const x = base + (seed % 100) / 100 * span
      const y = H * 0.24 + (Math.floor(idx / 4) % 3) * H * 0.14 + (seed % 40)
      const size = { small: 0.7, medium: 1, large: 1.35 }[b.size || 'medium']
      return {
        id: b._id,
        zoneId: b.zoneId,
        x, y, size,
        phase: (seed % 628) / 100,
        img: assets.loadIceberg(b.size || 'medium', b.zoneName)
      }
    })
    // 杭航：稍微靠上一点，避开底部录音 dock 的遮挡
    this.whale.x = W * 0.5; this.whale.y = H * 0.56
    this.pickWhaleTarget()
  },

  // ==================== Canvas 渲染 ====================
  async initCanvas () {
    if (this.canvas) return
    const q = this.createSelectorQuery()
    q.select('#oceanCanvas').fields({ node: true, size: true })
    const info = await new Promise((r) => q.exec((res) => r(res[0])))
    if (!info || !info.node) return
    const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2
    this.canvas = info.node
    this.canvas.width = info.width * dpr
    this.canvas.height = info.height * dpr
    this.ctx = this.canvas.getContext('2d')
    this.ctx.scale(dpr, dpr)
    this.W = info.width; this.H = info.height
    const names = [
      '/images/animation/whale-swim-1.png',
      ...Object.values(assets.LOCAL)
    ]
    await Promise.all(names.map((n) => this.loadImg(n)))
    this.startRender()
  },

  loadImg (src) {
    if (this.loaded[src]) return this.loaded[src]
    return new Promise((resolve) => {
      const img = this.canvas.createImage()
      img.onload = () => { this.loaded[src] = img; resolve(img) }
      img.onerror = () => resolve(null)
      img.src = src
    })
  },

  startRender () {
    if (this.rafId) return
    this.renderStart = Date.now()
    const loop = () => {
      this.draw()
      this.rafId = this.canvas.requestAnimationFrame(loop)
    }
    this.rafId = this.canvas.requestAnimationFrame(loop)
  },

  stopRender () {
    if (this.rafId && this.canvas) this.canvas.cancelAnimationFrame(this.rafId)
    this.rafId = null
  },

  draw () {
    const ctx = this.ctx
    const t = (Date.now() - this.renderStart) / 1000
    const { W, H } = this
    if (!ctx) return

    this.camera.x += (this.camera.tx - this.camera.x) * 0.08
    this.camera.scale += (this.camera.tscale - this.camera.scale) * 0.08
    const cam = this.camera

    // ---- 海洋背景 ----
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#EAF6FC')
    g.addColorStop(0.5, '#CBE7F5')
    g.addColorStop(1, '#A9D6EC')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    ctx.save()
    ctx.translate(-cam.x * cam.scale, 0)
    ctx.scale(cam.scale, cam.scale)

    // ---- 浪 ----
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 1.2
    for (let l = 0; l < 2; l++) {
      const y0 = H * (0.58 + l * 0.16)
      ctx.globalAlpha = 0.5 - l * 0.2
      ctx.beginPath()
      for (let x = -20; x <= W * 2.2; x += 8) {
        const y = y0 + Math.sin(x * 0.02 + t * (0.5 + l * 0.2)) * 2.5
        x === -20 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    // ---- 冰山 ----
    this.icebergs.forEach((b) => {
      const img = this.loaded[b.img] || this.loaded[assets.LOCAL.medium]
      if (!img) return
      const h = 64 * b.size
      const w = h * (img.width / img.height)
      const sway = Math.sin(t * 0.5 + b.phase) * 0.02
      ctx.save()
      ctx.translate(b.x + w / 2, b.y + h / 2 + Math.sin(t * 0.6 + b.phase) * 1.5)
      ctx.rotate(sway)
      ctx.drawImage(img, -w / 2, -h / 2, w, h)
      ctx.restore()
    })

    // ---- 杭航：手指一落下就定住，不再游走 ----
    const img = this.loaded['/images/animation/whale-swim-1.png']
    if (img) {
      const frozen = this.whale.frozen || this.data.recording
      if (!frozen) {
        this.whale.phase = (this.whale.phase || 0) + 0.008
        this.whale.x += (this.whale.tx - this.whale.x) * 0.0022
        this.whale.y += (this.whale.ty - this.whale.y) * 0.0022
        if (Math.abs(this.whale.tx - this.whale.x) < 10) this.pickWhaleTarget()
      }
      const ph = this.whale.phase || 0
      const ww = WHALE_W; const wh = ww * (img.height / img.width)
      ctx.save()
      ctx.translate(this.whale.x, this.whale.y + Math.sin(ph) * 2.5)
      ctx.rotate(Math.sin(ph * 0.8) * 0.025)
      if (this.whale.flip) ctx.scale(-1, 1)
      ctx.drawImage(img, -ww / 2, -wh / 2, ww, wh)
      ctx.restore()
    }
    ctx.restore()
  },

  pickWhaleTarget () {
    const W = this.W || 375
    const H = this.H || (wx.getWindowInfo ? wx.getWindowInfo().windowHeight : 667)
    this.whale.tx = 70 + Math.random() * (W - 140)
    this.whale.ty = H * (0.48 + Math.random() * 0.18)
    this.whale.flip = this.whale.tx < this.whale.x
  },

  // ==================== 触摸交互 ====================
  onTouchStart (e) {
    const p = e.touches[0]
    this.touch = { x: p.x, y: p.y, t: Date.now(), moved: false }
    // 关键：手指落下即定住杭航，移动目标变成静止目标，好按多了
    this.whale.frozen = true
    // 副入口：长按杭航 = 按住说话
    if (this.hitWhale(p.x, p.y) && !this.data.recording && !this.data.preview) {
      this.holdTimer = setTimeout(() => this.startRecording('hold'), HOLD_MS)
    }
  },

  onTouchMove (e) {
    if (!this.touch) return
    const p = e.touches[0]
    if (Math.abs(p.x - this.touch.x) > JITTER_PX || Math.abs(p.y - this.touch.y) > JITTER_PX) {
      this.touch.moved = true
      if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null }
      if (this.data.recording) return // 录音中忽略移动，防误触取消
      const dx = p.x - (this.lastX || this.touch.x)
      this.lastX = p.x
      this.camera.tx = clamp(this.camera.tx - dx / this.camera.scale, 0, Math.max(0, (this.worldW - this.W / this.camera.scale)))
    }
  },

  onTouchEnd (e) {
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null }
    this.whale.frozen = false
    this.lastX = null
    if (this.data.recording) {
      // 只有"长按说话"模式才在松手时结束；点按模式必须点按钮，避免手一抖就停
      if (this.data.recordMode === 'hold') this.finishRecording()
      return
    }
    if (!this.touch || this.touch.moved) return
    const p = (e.changedTouches && e.changedTouches[0]) || this.touch
    const dt = Date.now() - this.touch.t
    if (dt > 600) return
    const hit = this.icebergs.find((b) => this.hitIceberg(b, p.x, p.y))
    if (hit) {
      wx.navigateTo({ url: `/pages/iceberg/iceberg?id=${hit.id}` })
      return
    }
    const wx_ = p.x / this.camera.scale + this.camera.x
    const zr = this.zoneRects.find((r) => wx_ >= r.x && wx_ <= r.x + r.w)
    if (zr && this.data.viewLevel === 'global') {
      this.setData({ viewLevel: 'zone', currentZone: zr.zone.name })
      this.camera.tscale = 1.6
      this.camera.tx = zr.x - 40
    }
  },

  backToGlobal () {
    this.setData({ viewLevel: 'global', currentZone: null })
    this.camera.tscale = 1
    this.camera.tx = 0
  },

  hitWhale (x, y) {
    const w = this.whale
    const cam = this.camera || { x: 0, scale: 1 }
    const sx = (w.x - cam.x) * cam.scale
    const sy = w.y * cam.scale
    const rx = Math.max(WHALE_W * cam.scale, MIN_HIT) / 2 + 10
    const ry = Math.max(WHALE_W * 0.62 * cam.scale, MIN_HIT) / 2 + 10
    return x > sx - rx && x < sx + rx && y > sy - ry && y < sy + ry
  },

  // 冰山热区：以中心外扩，视觉与热区对齐，且不小于 112rpx
  hitIceberg (b, x, y) {
    const cam = this.camera
    const h = 64 * b.size * cam.scale
    const img = this.loaded[b.img] || this.loaded[assets.LOCAL.medium]
    const w = h * (img ? img.width / img.height : 0.8)
    const cx = (b.x - cam.x) * cam.scale + w / 2
    const cy = b.y * cam.scale + h / 2
    const rx = Math.max(w, MIN_HIT) / 2 + 8
    const ry = Math.max(h, MIN_HIT) / 2 + 8
    return Math.abs(x - cx) <= rx && Math.abs(y - cy) <= ry
  },

  // ==================== 录音 ====================
  // 主入口：底部大按钮，点一下开始、说完了再点一下
  toggleRecord () {
    if (this.data.recording) this.finishRecording()
    else this.startRecording('tap')
  },

  async startRecording (mode) {
    if (this.data.recording || this.data.analyzing || this.data.preview) return
    const app = getApp()
    if (!app.globalData.asrConfig) {
      await app.silentLogin().catch(() => {})
    }
    const cfg = api.getAsrConfig()

    // 权限
    try {
      await wx.authorize({ scope: 'scope.record' })
    } catch (e) {
      this.guideOpenSetting()
      return
    }
    if (wx.vibrateShort) wx.vibrateShort({ type: 'medium' })

    // ===== 实时识别：绝不让建连挡住开口 =====
    // 预热成功 → 复用连接（省 300~400ms）；没有 → 边录边连，
    // 这期间录到的帧由 asr.js 缓存，连上后一次性补发，一个字都不丢。
    if (this.asr && this.asr.isReady) {
      this.asr.reset()
      // 录音期间停掉保活：别让静音保活帧混进真实语音
      this.asr.stopKeepAlive()
      this.setData({ asrHint: '' })
    } else if (cfg && cfg.key) {
      this.releaseAsr()
      const { AsrStream } = require('../../utils/asr')
      this.asr = new AsrStream(cfg)
      this.bindAsr(this.asr)
      this.setData({ asrHint: 'connecting' })
      // 不 await：连接与录音并行
      this.asr.connect().then((ok) => {
        if (this.data.recording) this.setData({ asrHint: ok ? '' : 'offline' })
      }).catch(() => {
        if (this.data.recording) this.setData({ asrHint: 'offline' })
      })
    } else {
      // 连配置都没拿到（login 云函数没通）：照样能录，松手后走云函数兜底
      console.warn('[ocean] ASR 配置缺失，将走兜底转写')
      this.asr = null
      this.setData({ asrHint: 'offline' })
    }

    this.setData({ recording: true, recordMode: mode, transcript: '', elapsed: 0, countdown: 0 })
    this._pendingText = null
    this.recorder.start({
      onFrame: (buf) => this.asr && this.asr.sendFrame(buf),
      onTick: (s) => this.setData({ elapsed: s }),
      onCountdown: (left) => this.setData({ countdown: left }),
      onStop: async (wavPath, durationMs, err) => {
        this.setData({ recording: false, countdown: 0, elapsed: 0, recordMode: '' })
        this.whale.frozen = false
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
          // 出错也不白说：有音频就存草稿
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

        // 界面上的字在录音期间已经实时显示了，这里只收最后一句的尾巴
        let finalText = (this.data.transcript || '').trim()
        if (this.asr) {
          const live = this.asr.isReady
          const t = await this.asr.finish(1500)
          console.log('[ocean] ASR report:', JSON.stringify(this.asr.report()))
          if (t && t.trim().length > finalText.length) finalText = t.trim()
          if (!live && !finalText) console.warn('[ocean] 实时流未就绪，走云函数兜底')
          if (live) {
            // 连接留给下一轮复用：重新开保活，下轮开口零建连延迟
            this.asr.startKeepAlive()
          } else {
            this.releaseAsr()
            this.preheatAsr()
          }
        }
        if ((!finalText || !finalText.trim()) && wavPath) {
          finalText = await this.fallbackTranscribe(wavPath)
        }
        this.setData({ transcript: finalText })
        this.openPreview(wavPath, finalText || this.data.transcript)
      }
    })
  },

  // 兜底转写：WAV 上传云存储 → transcribe 云函数
  async fallbackTranscribe (wavPath) {
    wx.showLoading({ title: '正在整理您说的话…', mask: true })
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
    } finally {
      wx.hideLoading()
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
        // 只有明确点"先存下来"才中止；点"继续说"什么都不做，录音继续
        if (r.confirm) this.saveDraftAndStop()
      }
    })
  },

  // 中止录音并落地草稿：真实音频由 recorder.onStop 拼好 WAV 后一并存下
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
    if (!hasText) {
      // 没识别出字：不逼妈妈重说，可以只存原声，也可以打字补
      this.setData({
        preview: {
          wavPath, text: '', audioOnly: !!wavPath,
          timeOptions: ['说不清了'], timeIndex: 0,
          zoneOptions: ['新的开始'], zoneIndex: 0,
          photos: [], previewVoicePlaying: false
        }
      })
      if (wavPath) wx.showToast({ title: '没听清，可以先存声音，或直接打字', icon: 'none', duration: 3000 })
      return
    }
    this.setData({ analyzing: true })
    let r = null
    try { r = await api.analyzeMemory(text) } catch (e) { console.warn(e) }
    this.setData({ analyzing: false })
    const timeOptions = (r && r.timeOptions && r.timeOptions.length) ? r.timeOptions : ['说不清了']
    const zoneOptions = (r && r.zoneOptions && r.zoneOptions.length) ? r.zoneOptions : ['新的开始']
    this.setData({
      preview: {
        wavPath,
        text: (r && r.title) ? `${r.title}\n${text}` : text,
        rawText: text,
        audioOnly: false,
        timeOptions, timeIndex: 0,
        zoneOptions, zoneIndex: 0,
        photos: [],
        previewVoicePlaying: false
      }
    })
  },

  onPreviewInput (e) {
    const v = e.detail.value
    const p = this.data.preview
    this.setData({
      'preview.text': v,
      // 有原声就允许只存声音；没原声则必须有文字才能发布
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

  // 发布前先听一遍自己的声音
  playPreviewVoice () {
    const p = this.data.preview
    if (!p || !p.wavPath) return
    if (this.data.previewVoicePlaying) { this.stopPreviewVoice(); return }
    this.previewAudio = wx.createInnerAudioContext()
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

  // 点图片 = 看大图（原来点图片就删，太容易误删）
  previewDraftPhoto (e) {
    const i = Number(e.currentTarget.dataset.i)
    wx.previewImage({ current: this.data.preview.photos[i], urls: this.data.preview.photos })
  },

  // 点右上角 × 才删，且带确认
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
      await api.createIceberg({
        text: body,
        audioPath: p.wavPath,
        photos: p.photos,
        timeValue: p.timeIndex >= 0 ? p.timeOptions[p.timeIndex] : '说不清了',
        zoneName: p.zoneIndex >= 0 ? p.zoneOptions[p.zoneIndex] : '新的开始',
        title: (p.rawText && body.startsWith(p.rawText)) ? '' : body.split('\n')[0].slice(0, 12)
      })
      this.stopPreviewVoice()
      this.setData({ preview: null, publishing: false })
      wx.hideLoading()
      wx.showToast({ title: '一座新的冰山入海了', icon: 'none', duration: 2400 })
      this.refreshData()
    } catch (e) {
      wx.hideLoading()
      this.setData({ publishing: false })
      console.error(e)
      // 发布失败：存草稿，不让妈妈说过的话消失
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

function clamp (v, a, b) { return Math.max(a, Math.min(b, v)) }
function hash (s) { let h = 0; for (let i = 0; i < (s || '').length; i++) { h = (h * 31 + s.charCodeAt(i)) % 1e9 } return h }
