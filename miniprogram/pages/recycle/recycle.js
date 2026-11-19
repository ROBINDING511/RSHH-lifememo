// pages/recycle/recycle.js — 云朵（回收站）
// 删除的冰山化成云飘在这里；云保留 5 天，到期完全飘散（永久删除）；云下雨可提前落回海面
// 适老化：恢复是安全操作，不弹确认，点一下立即执行 + 明确反馈；飘散倒计时明示
const api = require('../../utils/api')
const CLOUD_TTL_MS = 5 * 24 * 3600 * 1000   // 5 天后飘散

Page({
  data: {
    items: [],
    loading: true,
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
  // 编辑：回到海洋编辑卡，可直接存为冰山
  editCloud (e) {
    wx.navigateTo({ url: '/pages/ocean/ocean?edit=' + e.currentTarget.dataset.id })
  },
  // 删除：彻底清除（不可恢复），一次确认
  async purgeCloud (e) {
    const id = e.currentTarget.dataset.id
    const ok = await new Promise((res) => wx.showModal({
      title: '彻底删除这段记忆？', content: '删除后就找不回来了。', confirmText: '彻底删除', cancelText: '再想想',
      confirmColor: '#F94830', success: (r) => res(r.confirm), fail: () => res(false)
    }))
    if (!ok) return
    try {
      await wx.cloud.database().collection('icebergs').doc(id).remove()
      wx.showToast({ title: '已彻底删除', icon: 'none' })
      this.load()
    } catch (err) {
      wx.showToast({ title: '网络不太好，再试一次', icon: 'none' })
    }
  },
  goOcean () {
    const pages = getCurrentPages()
    if (pages.length > 1) wx.navigateBack()
    else wx.reLaunch({ url: '/pages/ocean/ocean' })
  }
})
