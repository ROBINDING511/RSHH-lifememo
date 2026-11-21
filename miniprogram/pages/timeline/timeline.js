// pages/timeline/timeline.js — 时间轴视图
// 妈妈最常问"我什么时候说过这个"：按年份看全部冰山
// 适老化：记不清年份的回忆单独归到"记不清的"，排在最后，文案不带评判
const api = require('../../utils/api')

const UNKNOWN_LABEL = '记不清的'

Page({
  data: {
    tab: 'timeline',
    years: [], // [{year, items: [{id, title, icon, label}]}]
    total: 0
  },
  onTab (e) {
    const t = e.currentTarget.dataset.t
    if (t === this.data.tab) return
    wx.redirectTo({ url: { home: '/pages/home/home', ocean: '/pages/ocean/ocean', timeline: '/pages/timeline/timeline', me: '/pages/stages/stages' }[t] })
  },

  onShow () { this.load() },

  async load () {
    try {
      const icebergs = await api.listIcebergs()
      const byYear = {}
      icebergs.forEach((b) => {
        const y = this.yearOf(b)
        if (!byYear[y]) byYear[y] = []
        byYear[y].push({
          id: b._id,
          title: b.title || '一段回忆',
          zoneName: b.zoneName || '',
          icon: b.icon,
          label: this.timeLabel(b.memoryTime)
        })
      })
      // 有年份的从新到旧；"记不清的"永远排在最后
      const years = Object.keys(byYear)
        .sort((a, b) => {
          if (a === UNKNOWN_LABEL) return 1
          if (b === UNKNOWN_LABEL) return -1
          return a < b ? 1 : -1
        })
        .map((y) => ({ year: y, items: byYear[y] }))
      this.setData({ years, total: icebergs.length })
    } catch (e) {
      console.error('时间轴加载失败', e)
      this.setData({ years: [], total: 0 })
      wx.showToast({ title: '没加载出来，下拉再试试', icon: 'none' })
    }
  },

  yearOf (b) {
    const t = b.memoryTime || ''
    const m = String(t).match(/(\d{4})/)
    return m ? m[1] : UNKNOWN_LABEL
  },

  timeLabel (t) {
    if (!t) return ''
    // "说不清了""不确定的时间"这类，不再重复显示
    if (/说不清|不确定|记不清/.test(String(t))) return ''
    const m = String(t).match(/(\d{4})(?:[-年.](\d{1,2}))?/)
    if (!m) return t
    return m[2] ? `${Number(m[2])}月` : t
  },

  goDetail (e) {
    wx.navigateTo({ url: '/pages/iceberg/iceberg?id=' + e.currentTarget.dataset.id })
  },

  goOcean () {
    // 时间轴是从海洋 navigateTo 进来的，返回即可；异常路径直接重开海洋页
    const pages = getCurrentPages()
    if (pages.length > 1) wx.navigateBack()
    else wx.reLaunch({ url: '/pages/ocean/ocean' })
  }
})
