// pages/iceberg/iceberg.js — 冰山详情：一段回忆
// 首次进入看回忆内容；之后可为冰山放一个标记（icon）
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

  async load () {
    const res = await wx.cloud.database().collection('icebergs').doc(this.id).get()
    const b = res.data
    const icon = ICONS.find((i) => i.key === b.icon)
    this.setData({ b, iconFile: icon ? icon.file : '' })
    wx.setNavigationBarTitle({ title: b.zoneName || '一座冰山' })
  },

  // 播放妈妈的原声
  playVoice () {
    if (!this.data.b || !this.data.b.audioFileID) return
    if (!this.audio) {
      this.audio = wx.createInnerAudioContext()
      this.audio.onEnded(() => this.setData({ playing: false }))
      this.audio.onError(() => this.setData({ playing: false }))
    }
    this.audio.src = this.data.b.audioFileID
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
  // 设计：第二次进入这座冰山时，主动弹出标记选择
  onShowIconMenu () { this.setData({ showIconMenu: true }) },

  async pickIcon (e) {
    const i = Number(e.currentTarget.dataset.i)
    const icon = ICONS[i]
    await api.updateIceberg(this.id, { icon: icon.key })
    this.setData({ iconFile: icon.file, showIconMenu: false, 'b.icon': icon.key })
    wx.showToast({ title: '标记已放上冰山', icon: 'none' })
  },

  closeIconMenu () { this.setData({ showIconMenu: false }) },

  // ---- 删除：冰山融化成云 ----
  async meltIceberg () {
    const r = await new Promise((resolve) => {
      wx.showModal({
        title: '让这座冰山化成云吗？',
        content: '它会飘到云朵里，不会真的消失，随时可以落回海面。',
        confirmText: '化成云',
        cancelText: '再看看',
        success: resolve
      })
    })
    if (!r.confirm) return
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
    await api.removeIceberg(this.id)
    wx.showToast({ title: '冰山化成了云', icon: 'none', duration: 1800 })
    setTimeout(() => wx.navigateBack(), 900)
  }
})
