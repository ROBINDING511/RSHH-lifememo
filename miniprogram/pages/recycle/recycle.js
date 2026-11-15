// pages/recycle/recycle.js — 云朵（回收站）
// 删除的冰山化成云飘在这里，永远保留；云下雨，冰山回到海面
// 适老化：恢复是安全操作（不会丢东西），不弹确认，点一下立即执行 + 明确反馈
const api = require('../../utils/api')

Page({
  data: {
    items: [],
    loading: true,
    raining: '' // 正在下雨（恢复动画）的冰山 id
  },

  onShow () { this.load() },

  async load () {
    this.setData({ loading: true })
    try {
      const items = await api.listRecycled()
      this.setData({ items, loading: false })
    } catch (e) {
      console.error('云朵加载失败', e)
      this.setData({ loading: false })
      wx.showToast({ title: '没加载出来，下拉再试试', icon: 'none' })
    }
  },

  // 云下雨：恢复冰山
  async rain (e) {
    const id = e.currentTarget.dataset.id
    if (this.data.raining) return // 防连点
    this.setData({ raining: id })
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
    try {
      await api.restoreIceberg(id)
      this.setData({ raining: '' })
      wx.showToast({ title: '冰山回到了海面', icon: 'none', duration: 2200 })
      this.load()
    } catch (err) {
      console.error('恢复失败', err)
      this.setData({ raining: '' })
      wx.showToast({ title: '网络不太好，再试一次', icon: 'none', duration: 2400 })
    }
  },

  goOcean () {
    const pages = getCurrentPages()
    if (pages.length > 1) wx.navigateBack()
    else wx.reLaunch({ url: '/pages/ocean/ocean' })
  }
})
