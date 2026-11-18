// pages/iceberg/iceberg.js — 冰山详情：一段回忆
// 适老化改造：
//  - 加载失败不再"toast 后自动退回"，而是给出明确按钮（重新打开/回到海洋）
//  - 删除文案用大白话，按钮写"化成云/再看看"，不写"确定/取消"
//  - 删除后 toast 告知去哪找回
const api = require('../../utils/api')

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

Page({
  data: {
    b: null,
    icons: ICONS,
    iconFile: '',
    showIconMenu: false,
    loadFailed: false,
    viewCount: 0,
    playing: false,
    sentences: [],
    familyMode: false
  },

  onLoad (query) {
    this.id = query.id
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
    if (this.audio) {
      this.audio.stop()
      this.audio.destroy()
      this.audio = null
    }
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
      // 云存储 fileID 换 https 临时链接：音频播放、图片预览在部分机型/基础库上不认 cloud://
      const fileIDs = [...(b.photos || []), ...(b.audioFileID ? [b.audioFileID] : [])]
        .filter((id) => id && id.startsWith('cloud://'))
      const urlMap = {}
      if (fileIDs.length) {
        const r = await wx.cloud.getTempFileURL({ fileList: fileIDs })
        ;(r.fileList || []).forEach((f) => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL })
      }
      b.photos = (b.photos || []).map((p) => urlMap[p] || p)
      b.audioURL = b.audioFileID ? (urlMap[b.audioFileID] || b.audioFileID) : ''
      const icon = ICONS.find((i) => i.key === b.icon)
      this.setData({ b, iconFile: icon ? icon.file : '', loadFailed: false, sentences: splitSentences(b.text) })
      wx.setNavigationBarTitle({ title: b.zoneName || '一座冰山' })
    } catch (e) {
      console.error('冰山加载失败', e)
      this.setData({ loadFailed: true })
    } finally {
      wx.hideLoading()
    }
  },

  goBack () { wx.navigateBack() },

  // 继续说/补录：回海洋以编辑模式打开这段回忆
  continueRecord () {
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
    wx.navigateTo({ url: '/pages/ocean/ocean?edit=' + this.id })
  },

  // 音频上下文：本地优先 + 关静音键跟随；canplay 时支持按句 seek
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
      if (this._seekFrac != null && this._dur) {
        this.audio.seek(this._seekFrac * this._dur)
        this._seekFrac = null
        this.audio.play()
        this.setData({ playing: true })
      }
    })
    this.audio.onEnded(() => this.setData({ playing: false }))
    this.audio.onError(() => { this.setData({ playing: false }); wx.showToast({ title: '声音放不出来，换个网络试试', icon: 'none', duration: 2600 }) })
    return this.audio
  },

  // 整段播放（再点暂停）
  async playVoice () {
    const b = this.data.b
    if (!b || !b.audioFileID) return
    if (this.data.playing) { this.audio && this.audio.stop(); this.setData({ playing: false }); return }
    this._seekFrac = 0
    const a = await this.ensureAudio()
    if (!a) return wx.showToast({ title: '这段没有录音', icon: 'none' })
    if (this._dur) a.seek(0)
    a.play()
    this.setData({ playing: true })
  },

  // 点某一句 → 估算定位到该句原声（文字是音频的索引）
  async playSentence (e) {
    const b = this.data.b
    if (!b || !b.audioFileID) return
    const i = Number(e.currentTarget.dataset.i)
    const total = (b.text || '').length || 1
    let before = 0
    for (let k = 0; k < i; k++) before += (this.data.sentences[k] || '').length
    this._seekFrac = before / total
    const a = await this.ensureAudio()
    if (!a) return
    if (this._dur) { a.seek(this._seekFrac * this._dur); this._seekFrac = null; a.play(); this.setData({ playing: true }) }
    else a.play()   // canplay 回调里 seek
  },

  // 家人反应回流（想听/抱抱）
  async react (e) {
    const t = e.currentTarget.dataset.t
    try {
      await wx.cloud.callFunction({ name: 'family', data: { action: 'react', id: this.id, type: t } })
      wx.showToast({ title: t === 'hug' ? '抱抱已送达' : '告诉妈妈你想听', icon: 'none' })
    } catch (err) { wx.showToast({ title: '没送出去', icon: 'none' }) }
  },

  previewPhoto (e) {
    wx.previewImage({
      current: e.currentTarget.dataset.src,
      urls: this.data.b.photos
    })
  },

  // ---- 标记（icon）----
  onShowIconMenu () { this.setData({ showIconMenu: true }) },

  async pickIcon (e) {
    const i = Number(e.currentTarget.dataset.i)
    const icon = ICONS[i]
    try {
      await api.updateIceberg(this.id, { icon: icon.key })
      this.setData({ iconFile: icon.file, showIconMenu: false, 'b.icon': icon.key })
      wx.showToast({ title: '标记放好了', icon: 'none' })
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '没放上去，再试试', icon: 'none' })
    }
  },

  closeIconMenu () { this.setData({ showIconMenu: false }) },

  // ---- 删除：冰山融化成云 ----
  async meltIceberg () {
    const r = await new Promise((resolve) => {
      wx.showModal({
        title: '让这座冰山化成云吗？',
        content: '它会飘到"云朵"里，5 天后完全飘散。想留住，就早点让它落回海面。',
        confirmText: '化成云',
        cancelText: '再看看',
        confirmColor: '#B3402F',
        cancelColor: '#1F6478',
        success: resolve
      })
    })
    if (!r.confirm) return
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
    wx.showLoading({ title: '正在化成云…', mask: true })
    try {
      await api.removeIceberg(this.id)
      wx.hideLoading()
      wx.showToast({ title: '化好了，在"云朵"里能找到', icon: 'none', duration: 2400 })
      setTimeout(() => wx.navigateBack(), 1200)
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '网络不太好，再试一次', icon: 'none' })
    }
  }
})

// 按句切分（供"点句听原声"）
function splitSentences (text) {
  return String(text || '').split(/(?<=[。！？!?；;])/).map((s) => s.trim()).filter(Boolean)
}
