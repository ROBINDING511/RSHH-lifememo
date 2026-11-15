// pages/ocean/ocean.js — 人生海洋主界面
// 渲染：Canvas 2D（杭航帧动画、冰山摇曳、波浪、缩放）
// 交互：长按杭航录音（微信式60s+倒计时+边说边出字）、点冰山看回忆、点海域缩放
const { createRecorder, MAX_SECONDS } = require('../../utils/recorder')
const api = require('../../utils/api')
const assets = require('../../utils/assets')

const HOLD_MS = 300 // 长按判定

Page({
  data: {
    viewLevel: 'global', // global | zone
    currentZone: null,
    // 录音 overlay
    recording: false,
    transcript: '',
    countdown: 0,
    // 发布卡片
    preview: null, // { wavPath, text, timeOptions, timeIndex, zoneOptions, zoneIndex, photos: [] }
    analyzing: false,
    firstLaunch: false,
    icebergCount: 0
  },

  onLoad () {
    this.camera = { x: 0, scale: 1, tx: 0, tscale: 1 } // 当前/目标
    this.whale = { x: 100, y: 100, tx: 200, ty: 300, frame: 0, frameAt: 0, flip: false }
    this.icebergs = []   // 渲染对象 {id,x,y,img,w,h,phase,icon}
    this.zoneRects = []  // {zone, x, w}
    this.loaded = {}
    this.holdTimer = null
    this.asr = null
    this.recorder = createRecorder()
    this.setData({ firstLaunch: getApp().globalData.firstLaunch })
  },

  onShow () {
    if (this.data.firstLaunch) {
      // 首次引导
      this.setData({ firstLaunch: false })
      wx.navigateTo({ url: '/packageGuide/pages/guide/guide' })
      return
    }
    this.initCanvas()
    this.refreshData()
  },

  onHide () { this.stopRender() },
  onUnload () { this.stopRender(); this.asr && this.asr.close() },

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
      const y = this.H * 0.32 + (Math.floor(idx / 4) % 3) * this.H * 0.16 + (seed % 40)
      const size = { small: 0.7, medium: 1, large: 1.35 }[b.size || 'medium']
      return {
        id: b._id,
        zoneId: b.zoneId,
        x, y, size,
        phase: (seed % 628) / 100,
        img: assets.loadIceberg(b.size || 'medium', b.zoneName)
      }
    })
    // 杭航初始位置
    this.whale.x = W * 0.5; this.whale.y = this.H * 0.62
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
    // 预加载图片
    const names = [
      ...[1, 2, 3, 4, 5, 6].map((i) => `/images/animation/whale-swim-${i}.png`),
      ...[1, 2, 3].map((i) => `/images/animation/wave-${i}.png`),
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

    // 相机缓动
    this.camera.x += (this.camera.tx - this.camera.x) * 0.08
    this.camera.scale += (this.camera.tscale - this.camera.scale) * 0.08
    const cam = this.camera

    // ---- 海洋背景（垂直渐变）----
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#D6EFFB')
    g.addColorStop(0.45, '#A8D8F0')
    g.addColorStop(1, '#7FBFE0')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    ctx.save()
    ctx.translate(-cam.x * cam.scale, 0)
    ctx.scale(cam.scale, cam.scale)

    // ---- 海域色带 + 名称 ----
    this.zoneRects.forEach((zr) => {
      const zc = this.zoneColor(zr.zone.name)
      ctx.fillStyle = zc + '22'
      roundRect(ctx, zr.x - 10, H * 0.18, zr.w - 20, H * 0.66, 24)
      ctx.fill()
      ctx.fillStyle = '#3E6B8A'
      ctx.font = '500 16px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(zr.zone.name || '新的海域', zr.x + zr.w / 2 - 10, H * 0.18 + 34)
    })

    // ---- 波浪（三层，循环平移）----
    for (let l = 0; l < 3; l++) {
      const img = this.loaded[`/images/animation/wave-${(l % 3) + 1}.png`]
      if (!img) continue
      const y = H * (0.52 + l * 0.14)
      const off = (t * (12 + l * 8) + l * 160) % (W + 320)
      ctx.globalAlpha = 0.35 + l * 0.15
      for (let x = -320; x < W * 3; x += 320) {
        ctx.drawImage(img, x + off, y + Math.sin(t + l) * 4, 320, 78)
      }
    }
    ctx.globalAlpha = 1

    // ---- 冰山（摇曳）----
    this.icebergs.forEach((b) => {
      const img = this.loaded[b.img] || this.loaded[assets.LOCAL.medium]
      if (!img) return
      const h = 120 * b.size
      const w = h * (img.width / img.height)
      const sway = Math.sin(t * 0.7 + b.phase) * 0.035
      ctx.save()
      ctx.translate(b.x + w / 2, b.y + h / 2 + Math.sin(t * 0.9 + b.phase) * 3)
      ctx.rotate(sway)
      ctx.drawImage(img, -w / 2, -h / 2, w, h)
      ctx.restore()
    })

    // ---- 杭航（帧动画 + 缓动游动 + 翻面）----
    const frames = [1, 2, 3, 4, 5, 6].map((i) => this.loaded[`/images/animation/whale-swim-${i}.png`])
    const wf = frames.find(Boolean)
    if (wf) {
      const now = Date.now()
      if (now - this.whale.frameAt > 240) { this.whale.frame = (this.whale.frame + 1) % 6; this.whale.frameAt = now }
      const img = frames[this.whale.frame] || wf
      // 缓动走向目标
      this.whale.x += (this.whale.tx - this.whale.x) * 0.006
      this.whale.y += (this.whale.ty - this.whale.y) * 0.006 + Math.sin(t) * 0.5
      if (Math.abs(this.whale.tx - this.whale.x) < 30) this.pickWhaleTarget()
      const ww = 120; const wh = ww * (img.height / img.width)
      ctx.save()
      ctx.translate(this.whale.x, this.whale.y)
      if (this.whale.flip) ctx.scale(-1, 1)
      ctx.drawImage(img, -ww / 2, -wh / 2, ww, wh)
      ctx.restore()
    }
    ctx.restore()

    // ---- 录音中：杭航旁提示 ----
    if (this.data.recording) {
      ctx.fillStyle = 'rgba(255,255,255,0.65)'
      roundRect(ctx, W / 2 - 90, this.whale.y - 110, 180, 40, 20)
      ctx.fill()
      ctx.fillStyle = '#3E6B8A'
      ctx.font = '500 15px sans-serif'
      ctx.textAlign = 'center'
      const cd = this.data.countdown > 0 ? ` ${this.data.countdown}s` : ''
      ctx.fillText('杭航正在听…' + cd, W / 2, this.whale.y - 85)
    }
  },

  pickWhaleTarget () {
    const W = this.W || 375
    this.whale.tx = 60 + Math.random() * (W - 120)
    this.whale.ty = this.H * (0.55 + Math.random() * 0.25)
    this.whale.flip = this.whale.tx < this.whale.x
  },

  zoneColor (name) {
    const map = { 童年: '#F2C94C', 结婚: '#EB5757', 孩子: '#56CCF2', 工作: '#27AE60', 晚年: '#9B51E0' }
    return map[name] || '#4A9BD1'
  },

  // ==================== 触摸交互 ====================
  onTouchStart (e) {
    const p = e.touches[0]
    this.touch = { x: p.x, y: p.y, t: Date.now(), moved: false }
    // 命中杭航 → 长按录音
    if (this.hitWhale(p.x, p.y) && !this.data.recording && !this.data.preview) {
      this.holdTimer = setTimeout(() => this.startRecording(), HOLD_MS)
    }
  },

  onTouchMove (e) {
    if (!this.touch) return
    const p = e.touches[0]
    if (Math.abs(p.x - this.touch.x) > 10 || Math.abs(p.y - this.touch.y) > 10) {
      this.touch.moved = true
      if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null }
      if (this.data.recording) return // 录音中忽略移动（防误触取消）
      // 拖动平移
      const dx = p.x - (this.lastX || this.touch.x)
      this.lastX = p.x
      this.camera.tx = clamp(this.camera.tx - dx / this.camera.scale, 0, Math.max(0, (this.worldW - this.W / this.camera.scale)))
    }
  },

  onTouchEnd (e) {
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null }
    this.lastX = null
    if (this.data.recording) { this.finishRecording(); return }
    if (!this.touch || this.touch.moved) return
    const p = (e.changedTouches && e.changedTouches[0]) || this.touch
    const dt = Date.now() - this.touch.t
    if (dt > 600) return
    // 命中冰山 → 详情
    const hit = this.icebergs.find((b) => this.hitIceberg(b, p.x, p.y))
    if (hit) {
      wx.navigateTo({ url: `/pages/iceberg/iceberg?id=${hit.id}` })
      return
    }
    // 命中海域 → 缩放进入
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
    return x > w.x - 75 && x < w.x + 75 && y > w.y - 50 && y < w.y + 50
  },

  hitIceberg (b, x, y) {
    const cam = this.camera
    const bx = (b.x) * cam.scale - cam.x * cam.scale
    const by = b.y * cam.scale
    const h = 120 * b.size * cam.scale
    const w = h * 0.8
    return x > bx && x < bx + w && y > by && y < by + h
  },

  // ==================== 录音（流式） ====================
  async startRecording () {
    const app = getApp()
    if (!app.globalData.asrConfig) {
      await app.silentLogin().catch(() => {})
    }
    const cfg = api.getAsrConfig()
    if (!cfg || !cfg.key) {
      wx.showToast({ title: '语音服务未就绪，请稍后再试', icon: 'none' })
      return
    }
    // 权限
    try {
      await wx.authorize({ scope: 'scope.record' })
    } catch (e) {
      this.guideOpenSetting()
      return
    }
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })

    // ASR 流
    const { AsrStream } = require('../../utils/asr')
    this.asr = new AsrStream(cfg)
    this.asr.on('partial', (text) => this.setData({ transcript: text }))
    this.asr.on('sentence', (text) => this.setData({ transcript: text }))
    this.asr.on('error', () => { /* 静默：识别断了不影响录音 */ })

    try {
      await this.asr.connect()
    } catch (e) {
      wx.showToast({ title: '语音服务连接失败', icon: 'none' })
      this.asr.close()
      return
    }

    this.setData({ recording: true, transcript: '', countdown: 0 })
    this.recorder.start({
      onFrame: (buf) => this.asr && this.asr.sendFrame(buf),
      onCountdown: (left) => this.setData({ countdown: left }),
      onStop: async (wavPath, durationMs, err) => {
        this.setData({ recording: false, countdown: 0 })
        const finalText = await this.asr.finish()
        this.asr.close()
        if (err) { wx.showToast({ title: '录音中断了', icon: 'none' }); return }
        if (durationMs < 800) { // 误触：太短，静默丢弃
          return
        }
        this.openPreview(wavPath, finalText || this.data.transcript)
      }
    })
  },

  finishRecording () {
    if (!this.recorder.recording) return
    this.recorder.stop() // onStop 里走 openPreview
  },

  guideOpenSetting () {
    wx.showModal({
      title: '需要麦克风权限',
      content: '长按杭航说话需要用到麦克风。请在设置中允许「人生海海」使用麦克风。',
      confirmText: '去设置',
      success: (r) => { if (r.confirm) wx.openSetting() }
    })
  },

  // ==================== 发布卡片 ====================
  async openPreview (wavPath, text) {
    if (!text || text.replace(/\s/g, '').length < 2) {
      // 没识别到字：让妈妈重说或打字
      this.setData({
        preview: { wavPath, text: '', timeOptions: [], timeIndex: -1, zoneOptions: [], zoneIndex: -1, photos: [] }
      })
      return
    }
    this.setData({ analyzing: true })
    let r = null
    try { r = await api.analyzeMemory(text) } catch (e) { console.warn(e) }
    this.setData({ analyzing: false })
    const timeOptions = (r && r.timeOptions && r.timeOptions.length)
      ? r.timeOptions : ['不确定的时间']
    const zoneOptions = (r && r.zoneOptions && r.zoneOptions.length)
      ? r.zoneOptions : ['新的海域']
    this.setData({
      preview: {
        wavPath,
        text: (r && r.title) ? `${r.title}\n${text}` : text,
        rawText: text,
        timeOptions, timeIndex: 0,
        zoneOptions, zoneIndex: 0,
        photos: []
      }
    })
  },

  onPreviewInput (e) {
    this.setData({ 'preview.text': e.detail.value })
  },

  pickTime (e) { this.setData({ 'preview.timeIndex': Number(e.currentTarget.dataset.i) }) },
  pickZone (e) { this.setData({ 'preview.zoneIndex': Number(e.currentTarget.dataset.i) }) },

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

  removePhoto (e) {
    const i = Number(e.currentTarget.dataset.i)
    const photos = this.data.preview.photos.slice()
    photos.splice(i, 1)
    this.setData({ 'preview.photos': photos })
  },

  async publish () {
    const p = this.data.preview
    const text = (p.text || '').trim()
    if (!text) { wx.showToast({ title: '先说一句话或打几个字吧', icon: 'none' }); return }
    wx.showLoading({ title: '冰山生成中…' })
    try {
      await api.createIceberg({
        text,
        audioPath: p.wavPath,
        photos: p.photos,
        timeValue: p.timeIndex >= 0 ? p.timeOptions[p.timeIndex] : '不确定的时间',
        zoneName: p.zoneIndex >= 0 ? p.zoneOptions[p.zoneIndex] : '新的海域',
        title: (p.rawText && text.startsWith(p.rawText)) ? '' : text.split('\n')[0].slice(0, 12)
      })
      this.setData({ preview: null })
      wx.hideLoading()
      wx.showToast({ title: '一座新的冰山入海了', icon: 'none', duration: 2000 })
      this.refreshData()
    } catch (e) {
      wx.hideLoading()
      console.error(e)
      wx.showToast({ title: '发布失败，再试一次', icon: 'none' })
    }
  },

  discardPreview () {
    this.setData({ preview: null })
  },

  // ==================== 导航 ====================
  goTimeline () { wx.navigateTo({ url: '/pages/timeline/timeline' }) },
  goRecycle () { wx.navigateTo({ url: '/pages/recycle/recycle' }) }
})

function clamp (v, a, b) { return Math.max(a, Math.min(b, v)) }
function hash (s) { let h = 0; for (let i = 0; i < (s || '').length; i++) { h = (h * 31 + s.charCodeAt(i)) % 1e9 } return h }
function roundRect (ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
