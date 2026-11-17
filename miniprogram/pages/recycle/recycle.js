// pages/recycle/recycle.js — 云朵（回收站）
// 删除的冰山化成云飘在这里；云保留 5 天，到期完全飘散（永久删除）；云下雨可提前落回海面
// 适老化：恢复是安全操作，不弹确认，点一下立即执行 + 明确反馈；飘散倒计时明示
const api = require('../../utils/api')
const CLOUD_TTL_MS = 5 * 24 * 3600 * 1000   // 5 天后飘散

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
      // 到期云完全飘散（永久删除），只清自己的、已删除且超 5 天的
      const db = wx.cloud.database()
      const cutoff = Date.now() - CLOUD_TTL_MS
      try {
        await db.collection('icebergs').where({ deleted: true, deletedAt: db.command.lt(cutoff) }).remove()
      } catch (e) { /* 清理失败不阻塞展示 */ }
      const items = (await api.listRecycled()).map((it) => {
        const left = it.deletedAt ? Math.max(0, Math.ceil((it.deletedAt + CLOUD_TTL_MS - Date.now()) / 86400000)) : 5
        return Object.assign({}, it, { daysLeft: left })
      })
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
