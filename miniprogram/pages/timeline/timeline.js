// pages/timeline/timeline.js — 时间轴视图
// 妈妈最常问"我什么时候说过这个"：按年份看全部冰山
const api = require('../../utils/api')

Page({
  data: {
    years: [], // [{year, items: [{id, title, icon, monthDay}]}]
    total: 0
  },

  onShow () { this.load() },

  async load () {
    const icebergs = await api.listIcebergs()
    const byYear = {}
    icebergs.forEach((b) => {
      const y = this.yearOf(b)
      if (!byYear[y]) byYear[y] = []
      byYear[y].push({
        id: b._id,
        title: b.title,
        zoneName: b.zoneName,
        icon: b.icon,
        label: this.timeLabel(b.memoryTime)
      })
    })
    const years = Object.keys(byYear).sort((a, b) => (a === '未知' ? 1 : b === '未知' ? -1 : a < b ? -1 : 1))
      .map((y) => ({ year: y, items: byYear[y] }))
    this.setData({ years, total: icebergs.length })
  },

  yearOf (b) {
    const t = b.memoryTime || ''
    const m = String(t).match(/(\d{4})/)
    return m ? m[1] : '未知'
  },

  timeLabel (t) {
    if (!t) return ''
    const m = String(t).match(/(\d{4})(?:[-年.](\d{1,2}))?/)
    if (!m) return t
    return m[2] ? `${Number(m[2])}月` : t
  },

  goDetail (e) {
    wx.navigateTo({ url: '/pages/iceberg/iceberg?id=' + e.currentTarget.dataset.id })
  }
})
