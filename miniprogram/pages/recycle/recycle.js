// pages/recycle/recycle.js — 云朵（回收站）
// 删除的冰山化成云飘在这里，永远保留；云下雨，冰山回到海面
const api = require('../../utils/api')

Page({
  data: {
    items: [],
    raining: '' // 正在下雨（恢复动画）的冰山 id
  },

  onShow () { this.load() },

  async load () {
    const items = await api.listRecycled()
    this.setData({ items })
  },

  // 云下雨：恢复冰山
  async rain (e) {
    const id = e.currentTarget.dataset.id
    this.setData({ raining: id })
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
    await api.restoreIceberg(id)
    setTimeout(() => {
      this.setData({ raining: '' })
      wx.showToast({ title: '冰山回到了海面', icon: 'none', duration: 1800 })
      this.load()
    }, 1200)
  }
})
