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
    playing: false
  },

  onLoad (query) {
    this.id = query.id
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
      const res = await wx.cloud.database().collection('icebergs').doc(this.id).get()
      const b = res.data
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
      this.setData({ b, iconFile: icon ? icon.file : '', loadFailed: false })
      wx.setNavigationBarTitle({ title: b.zoneName || '一座冰山' })
    } catch (e) {
      console.error('冰山加载失败', e)
      this.setData({ loadFailed: true })
    } finally {
      wx.hideLoading()
    }
  },

  goBack () { wx.navigateBack() },

  // 播放妈妈的原声（再点一次暂停）。下载到本地再播 + 关静音键跟随，避免"听不到"。
  async playVoice () {
    const b = this.data.b
    if (!b || !b.audioFileID) return
    if (this.data.playing) {
      this.audio && this.audio.stop()
      this.setData({ playing: false })
      return
    }
    let src = this._audioLocal
    if (!src) {
      try {
        const d = await wx.cloud.downloadFile({ fileID: b.audioFileID })
        src = d.tempFilePath
        this._audioLocal = src
      } catch (e) {
        src = b.audioURL || ''   // 下载失败回退 https 临时链
      }
    }
    if (!src) { wx.showToast({ title: '这段没有录音', icon: 'none' }); return }
    if (!this.audio) {
      this.audio = wx.createInnerAudioContext()
      this.audio.obeyMuteSwitch = false   // iOS 静音键下也出声
      this.audio.onEnded(() => this.setData({ playing: false }))
      this.audio.onError(() => {
        this.setData({ playing: false })
        wx.showToast({ title: '声音放不出来，换个网络试试', icon: 'none', duration: 2600 })
      })
    }
    this.audio.src = src
    this.audio.play()
    this.setData({ playing: true })
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
        content: '它会飘到"云朵"里，不会真的消失。想它了，随时可以让它落回海面。',
        confirmText: '化成云',
        cancelText: '再看看',
        confirmColor: '#C0392B',
        cancelColor: '#24648F',
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
