// pages/iceberg/iceberg.js — 冰山详情 = 翻书阅读（v2.0 E/A10/A6/B4/B5）
// 三视图：整理稿/逐字/疑点标注；长文翻书+大字；句级"像不像我说的"；红字点改；句级原声精确跳转+进度条。
// 适老：原生 view/text、≥88rpx 触控、大白话；失败不阻塞；逐字与原声永远保留。
const api = require('../../utils/api')
const { createRecorder } = require('../../utils/recorder')

const ICONS = [
  { key: 'castle', file: '/images/pixel/castle.png', name: '城堡' },
  { key: 'flag-red', file: '/images/pixel/flag-red.png', name: '红旗' },
  { key: 'flag-gold', file: '/images/pixel/flag-gold.png', name: '金旗' },
  { key: 'flag-blue', file: '/images/pixel/flag-blue.png', name: '蓝旗' },
  { key: 'flag-green', file: '/images/pixel/flag-green.png', name: '绿旗' },
  { key: 'flag-purple', file: '/images/pixel/flag-purple.png', name: '紫旗' },
  { key: 'seagull', file: '/images/pixel/seagull.png', name: '海鸥' },
  { key: 'star', file: '/images/pixel/star.png', name: '星星' },
  { key: 'flower', file: '/images/pixel/flower.png', name: '花' },
  { key: 'anchor', file: '/images/pixel/anchor.png', name: '锚' }
]
const PAGE_SIZE = 4

Page({
  data: {
    b: null, icons: ICONS, iconFile: '', showIconMenu: false, loadFailed: false,
    viewCount: 0, playing: false, familyMode: false,
    // v2.0 阅读
    view: 'clean', big: false, page: 0, pages: [], sentences: [], doubts: [],
    confirmExpand: '', fixText: '', fixing: false,
    doubtSheet: null, doubtInput: '',
    cur: 0, dur: 0
  },

  onLoad (query) {
    this.id = query.id
    this.recorder = createRecorder()
    this.setData({ familyMode: !!wx.getStorageSync('familyOwner') })
  },
  onShow () {
    this.load()
    const n = Number(wx.getStorageSync('view_' + this.id) || 0)
    wx.setStorageSync('view_' + this.id, n + 1)
    this.setData({ viewCount: n + 1 })
  },
  onHide () { this.stopAudio() },
  onUnload () { this.stopAudio() },
  stopAudio () {
    if (this.audio) { this.audio.stop(); this.audio.destroy(); this.audio = null }
    if (this.data.playing) this.setData({ playing: false })
  },

  async load () {
    this.stopAudio()
    this._audioLocal = null
    wx.showLoading({ title: '正在打开…', mask: true })
    try {
      let b
      if (this.data.familyMode) {
        const r = await wx.cloud.callFunction({ name: 'family', data: { action: 'get', id: this.id } })
        b = (r.result && r.result.ok) ? r.result.data : null
        if (!b) throw new Error('family get failed')
      } else {
        b = (await wx.cloud.database().collection('icebergs').doc(this.id).get()).data
      }
      const fileIDs = [...(b.photos || []), ...(b.audioFileID ? [b.audioFileID] : [])].filter((id) => id && id.startsWith('cloud://'))
      const urlMap = {}
      if (fileIDs.length) {
        const r = await wx.cloud.getTempFileURL({ fileList: fileIDs })
        ;(r.fileList || []).forEach((f) => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL })
      }
      b.photos = (b.photos || []).map((p) => urlMap[p] || p)
      b.audioURL = b.audioFileID ? (urlMap[b.audioFileID] || b.audioFileID) : ''
      const icon = ICONS.find((i) => i.key === b.icon)
      // 旧冰山无 sentences → 走 splitSentences，不迁移不报错
      const sentences = (b.sentences && b.sentences.length)
        ? b.sentences
        : splitSentences(b.text).map((t, i) => ({ id: 's' + i, text: t, state: 'unset', source: 'raw', evidence: [], dialect: [] }))
      const doubts = b.doubts || []
      this._lines = b.lines || []
      this.setData({
        b, iconFile: icon ? icon.file : '', loadFailed: false,
        sentences, doubts,
        view: (b.sentences && b.sentences.length) ? 'clean' : 'raw',
        page: 0
      })
      this.buildPages()
      wx.setNavigationBarTitle({ title: b.title || b.zoneName || '一座冰山' })
    } catch (e) {
      console.error('冰山加载失败', e)
      this.setData({ loadFailed: true })
    } finally { wx.hideLoading() }
  },

  // E 翻书：长文分页（每页≤4句）；短文单页
  buildPages () {
    const s = this.data.sentences
    const long = s.length > 4 || (this.data.b.text || '').length > 200
    const pages = []
    if (!long) pages.push(s.map((x, i) => i))
    else for (let i = 0; i < s.length; i += PAGE_SIZE) pages.push(s.slice(i, i + PAGE_SIZE).map((_, j) => i + j))
    // 红字分段（B4）：把疑点词在句内标红
    const doubts = this.data.doubts
    const segs = s.map((sen) => {
      let parts = [{ t: sen.text, red: '' }]
      for (const d of doubts) {
        if (d.status === 'fixed' || !d.original) continue
        const next = []
        for (const p of parts) {
          if (p.red || !p.t.includes(d.original)) { next.push(p); continue }
          const [a, b2] = p.t.split(d.original)
          if (a) next.push({ t: a, red: '' })
          next.push({ t: d.original, red: d.id })
          if (b2) next.push({ t: b2, red: '' })
        }
        parts = next
      }
      return parts
    })
    this.setData({ pages, segs, pageCount: pages.length })
  },
  setView (e) { this.setData({ view: e.currentTarget.dataset.v }) },
  toggleBig () { this.setData({ big: !this.data.big }) },
  prevPage () { if (this.data.page > 0) this.setData({ page: this.data.page - 1 }) },
  nextPage () { if (this.data.page < this.data.pageCount - 1) this.setData({ page: this.data.page + 1 }) },
  onBookTouchStart (e) { this._bx = e.touches[0].clientX },
  onBookTouchEnd (e) {
    const dx = e.changedTouches[0].clientX - this._bx
    if (dx < -60) this.nextPage()
    else if (dx > 60) this.prevPage()
  },

  // A6 句级确认
  confirmYes (e) {
    const id = e.currentTarget.dataset.id
    const sentences = this.data.sentences.map((s) => s.id === id ? { ...s, state: 'yes' } : s)
    this.setData({ sentences, confirmExpand: '' })
    this.persistSentences(sentences)
  },
  confirmNo (e) {
    const id = e.currentTarget.dataset.id
    this.setData({ confirmExpand: id, fixText: '' })
  },
  onFixInput (e) { this.setData({ fixText: e.detail.value }) },
  // 按住说话纠正（复用录音+转写）
  fixHoldStart () {
    this.setData({ fixing: true })
    const cfg = api.getAsrConfig()
    this.asr = null
    if (cfg && cfg.key) {
      const { AsrStream } = require('../../utils/asr')
      this.asr = new AsrStream(cfg)
      this.asr.on('partial', (t) => this.setData({ fixText: t }))
      this.asr.on('sentence', (t) => this.setData({ fixText: t }))
      this.asr.connect()
    }
    this.recorder.start({
      onFrame: (b) => this.asr && this.asr.sendFrame(b),
      onStop: async (wav, dur, err) => {
        let t = this.data.fixText
        if (this.asr) { const x = await this.asr.finish(1200).catch(() => ''); if (x && x.length > t.length) t = x; this.asr.close() }
        this.setData({ fixing: false, fixText: t })
      }
    })
  },
  fixHoldEnd () { if (this.data.fixing) this.recorder.stop() },
  async applyFix (e) {
    const id = e.currentTarget.dataset.id
    const val = (this.data.fixText || '').trim()
    if (!val) return wx.showToast({ title: '先写或说一句', icon: 'none' })
    const old = (this.data.sentences.find((s) => s.id === id) || {}).text || ''
    const sentences = this.data.sentences.map((s) => s.id === id ? { ...s, text: val, state: 'user-fixed', source: 'user' } : s)
    const corrections = (this.data.b.corrections || []).concat([{ at: Date.now(), kind: 'sentence', target: id, old, new: val, by: 'user' }])
    this.setData({ sentences, confirmExpand: '', fixText: '', 'b.corrections': corrections })
    this.buildPages()
    this.persistSentences(sentences, corrections)
    wx.showToast({ title: '按您说的改好了', icon: 'none' })
  },
  persistSentences (sentences, corrections) {
    const patch = { sentences }
    if (corrections) patch.corrections = corrections
    api.updateIceberg(this.id, patch).catch(() => {})
  },

  // B4 红字点改
  openDoubt (e) {
    const id = e.currentTarget.dataset.id
    const d = this.data.doubts.find((x) => x.id === id)
    if (!d) return
    const sen = this.data.sentences.find((s) => s.text.includes(d.original)) || {}
    this.setData({ doubtSheet: { ...d, ctx: sen.text || d.original }, doubtInput: '' })
  },
  closeDoubt () { this.setData({ doubtSheet: null }) },
  onDoubtInput (e) { this.setData({ doubtInput: e.detail.value }) },
  playDoubtLine () {
    const d = this.data.doubtSheet
    if (!d) return
    this.seekToLine(d.line)
  },
  pickCandidate (e) { this.applyDoubt(e.currentTarget.dataset.v) },
  keepOriginal () {
    const d = this.data.doubtSheet
    const doubts = this.data.doubts.map((x) => x.id === d.id ? { ...x, status: 'kept' } : x)
    this.setData({ doubts, doubtSheet: null })
    api.updateIceberg(this.id, { doubts }).catch(() => {})
    wx.showToast({ title: '保留原说，记下了', icon: 'none' })
  },
  applyDoubt (val) {
    const d = this.data.doubtSheet
    const v = (val || this.data.doubtInput || '').trim()
    if (!v) return wx.showToast({ title: '选一个或自己写', icon: 'none' })
    const sentences = this.data.sentences.map((s) => s.text.includes(d.original) ? { ...s, text: s.text.split(d.original).join(v) } : s)
    const lines = (this._lines || []).map((l) => l.n === d.line ? { ...l, text: (l.text || '').split(d.original).join(v) } : l)
    const doubts = this.data.doubts.map((x) => x.id === d.id ? { ...x, status: 'fixed', fixedValue: v } : x)
    const corrections = (this.data.b.corrections || []).concat([{ at: Date.now(), kind: d.kind, target: d.id, old: d.original, new: v, by: 'user' }])
    this._lines = lines
    this.setData({ sentences, doubts, doubtSheet: null, 'b.corrections': corrections })
    this.buildPages()
    api.updateIceberg(this.id, { sentences, doubts, lines, corrections }).catch(() => {})
    wx.showToast({ title: '已人工确认', icon: 'none' })
  },

  // B5 精确 seek + 进度条
  async ensureAudio () {
    if (this.audio) return this.audio
    const b = this.data.b
    let src = this._audioLocal
    if (!src) {
      try { src = (await wx.cloud.downloadFile({ fileID: b.audioFileID })).tempFilePath; this._audioLocal = src }
      catch (e) { src = b.audioURL || '' }
    }
    if (!src) return null
    this.audio = wx.createInnerAudioContext()
    this.audio.obeyMuteSwitch = false
    this.audio.src = src
    this.audio.onCanplay(() => {
      this._dur = this.audio.duration || 0
      this.setData({ dur: Math.round(this._dur) })
      if (this._seekSec != null) { this.audio.seek(this._seekSec); this._seekSec = null; this.audio.play(); this.setData({ playing: true }) }
    })
    this.audio.onTimeUpdate(() => { this.setData({ cur: Math.round(this.audio.currentTime || 0) }) })
    this.audio.onEnded(() => this.setData({ playing: false, cur: 0 }))
    this.audio.onError(() => { this.setData({ playing: false }); wx.showToast({ title: '声音放不出来，换个网络试试', icon: 'none', duration: 2600 }) })
    return this.audio
  },
  async playVoice () {
    const b = this.data.b
    if (!b || !b.audioFileID) return
    if (this.data.playing) { this.audio && this.audio.stop(); this.setData({ playing: false }); return }
    const a = await this.ensureAudio()
    if (!a) return wx.showToast({ title: '这段没有录音', icon: 'none' })
    if (this._dur) a.seek(0)
    a.play(); this.setData({ playing: true })
    if (!wx.getStorageSync('L4_listen')) wx.setStorageSync('L4_listen', Date.now())   // A12 首次回听
  },
  seekToLine (line) {
    const l = (this._lines || [])[line]
    if (l && l.t != null) { this._seekSec = l.t; this._playSeek() }
    else this.playSentenceByIndex(line)
  },
  async _playSeek () {
    const a = await this.ensureAudio()
    if (!a) return
    if (this._dur) { a.seek(this._seekSec); this._seekSec = null; a.play(); this.setData({ playing: true }) }
    else a.play()
  },
  playSentence (e) { this.playSentenceByIndex(Number(e.currentTarget.dataset.i)) },
  playSentenceByIndex (i) {
    const sen = this.data.sentences[i]
    const t = sen && sen.evidence && sen.evidence[0] && sen.evidence[0].tStart
    if (t != null) { this._seekSec = t; return this._playSeek() }
    // 无时间戳 → 字数比例估算
    const total = (this.data.b.text || '').length || 1
    let before = 0
    for (let k = 0; k < i; k++) before += (this.data.sentences[k].text || '').length
    this._seekSec = null
    this._seekFrac = before / total
    this.ensureAudio().then((a) => {
      if (!a) return
      if (this._dur) { a.seek(this._seekFrac * this._dur); this._seekFrac = null; a.play(); this.setData({ playing: true }) }
      else a.play()
    })
  },
  onSeek (e) {
    const frac = e.detail.value / 100
    if (this.audio && this._dur) { this.audio.seek(frac * this._dur); this.setData({ cur: Math.round(frac * this._dur) }) }
  },

  async react (e) {
    const t = e.currentTarget.dataset.t
    try {
      await wx.cloud.callFunction({ name: 'family', data: { action: 'react', id: this.id, type: t } })
      wx.showToast({ title: t === 'hug' ? '抱抱已送达' : '告诉妈妈你想听', icon: 'none' })
    } catch (err) { wx.showToast({ title: '没送出去', icon: 'none' }) }
  },
  previewPhoto (e) { wx.previewImage({ current: e.currentTarget.dataset.src, urls: this.data.b.photos }) },
  onShowIconMenu () { this.setData({ showIconMenu: true }) },
  async pickIcon (e) {
    const icon = ICONS[Number(e.currentTarget.dataset.i)]
    try {
      await api.updateIceberg(this.id, { icon: icon.key })
      this.setData({ iconFile: icon.file, showIconMenu: false, 'b.icon': icon.key })
      wx.showToast({ title: '标记放好了', icon: 'none' })
    } catch (err) { wx.showToast({ title: '没放上去，再试试', icon: 'none' }) }
  },
  closeIconMenu () { this.setData({ showIconMenu: false }) },
  goBack () { wx.navigateBack() },
  continueRecord () {
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: '/pages/ocean/ocean?edit=' + this.id })
  },
  async meltIceberg () {
    const r = await new Promise((resolve) => wx.showModal({
      title: '删除这段回忆吗？', content: '删除后放在"删除的记忆"里，5 天内可随时找回。',
      confirmText: '删除', cancelText: '再看看', confirmColor: '#B3402F', cancelColor: '#1F6478', success: resolve
    }))
    if (!r.confirm) return
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
    wx.showLoading({ title: '正在删除…', mask: true })
    try {
      await api.removeIceberg(this.id)
      wx.hideLoading()
      getApp().globalData.topHint = '删除了，在"删除的记忆"里5天可以找回'
      wx.navigateBack()   // 立刻回主页面，顶端小字提示
    } catch (e) { wx.hideLoading(); wx.showToast({ title: '网络不太好，再试一次', icon: 'none' }) }
  }
})

function splitSentences (text) {
  return String(text || '').split(/(?<=[。！？!?；;])/).map((s) => s.trim()).filter(Boolean)
}