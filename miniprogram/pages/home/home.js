// pages/home/home.js — 苹果健康·睡眠语法 摘要页（真实数据）
const api = require('../../utils/api')
const life = require('../../utils/life')
const draft = require('../../utils/draft')

Page({
  data: {
    tab: 'home', date: '', score: 0, weekTotal: 0, goal: 7,
    stage: [], legend: [], trend: [], avgTop: '50%',
    recent: null, drafts: 0, nodes: 0
  },
  onShow () { this.load() },
  async load () {
    const list = await api.listIcebergs().catch(() => [])
    const now = new Date()
    const day0 = new Date(now); day0.setHours(0, 0, 0, 0)
    const buckets = [0, 0, 0, 0]
    list.forEach((b) => {
      const t = b.createdAt || 0
      if (t >= day0.getTime()) { const h = new Date(t).getHours(); buckets[h < 6 ? 0 : h < 12 ? 1 : h < 18 ? 2 : 3]++ }
    })
    const ks = ['awake', 'rem', 'core', 'deep']
    const ns = ['凌晨', '上午', '下午', '夜晚']
    // 周堆叠柱：每列=一日，段高=该时段/当日总量（value→height）
    const weekDays = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(day0); d.setDate(d.getDate() - i)
      const nxt = new Date(d); nxt.setDate(nxt.getDate() + 1)
      const bb = [0, 0, 0, 0]
      list.forEach((x) => {
        const t = x.createdAt || 0
        if (t >= d.getTime() && t < nxt.getTime()) { const h = new Date(t).getHours(); bb[h < 6 ? 0 : h < 12 ? 1 : h < 18 ? 2 : 3]++ }
      })
      weekDays.push({ d: (d.getMonth() + 1) + '/' + d.getDate(), bb, tot: bb.reduce((x, y) => x + y, 0) })
    }
    const maxDay = Math.max(1, ...weekDays.map((x) => x.tot))
    const stage = weekDays.map((x) => ({
      d: x.d, colH: Math.max(4, x.tot / maxDay * 100) + '%',
      segs: x.tot ? x.bb.map((v, i) => ({ k: ks[i], h: (v / x.tot * 100) + '%' })).filter((z) => z.h !== '0%') : [{ k: 'deep', h: '100%' }]
    }))
    const weekBuckets = [0, 0, 0, 0]
    weekDays.forEach((x) => x.bb.forEach((v, i) => { weekBuckets[i] += v }))
    const legend = ks.map((k, i) => ({ k, n: ns[i], v: weekBuckets[i] + '段' }))
    const days = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(day0); d.setDate(d.getDate() - i)
      const nxt = new Date(d); nxt.setDate(nxt.getDate() + 1)
      const c = list.filter((b) => (b.createdAt || 0) >= d.getTime() && (b.createdAt || 0) < nxt.getTime()).length
      days.push({ d: (d.getMonth() + 1) + '/' + d.getDate(), c })
    }
    const max = Math.max(1, ...days.map((x) => x.c))
    const avg = days.reduce((a, b) => a + b.c, 0) / 7
    const trend = days.map((x) => ({ d: x.d, h: Math.max(4, x.c / max * 100) + '%' }))
    const week = list.filter((b) => (b.createdAt || 0) >= day0.getTime() - 6 * 86400000).length
    const recent = list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null
    this.setData({
      date: (now.getMonth() + 1) + '月' + now.getDate() + '日',
      score: Math.min(100, Math.round(week / this.data.goal * 100)),
      weekTotal: week, stage, legend, trend,
      avgTop: (100 - avg / max * 100) + '%',
      recent, drafts: draft.list().length, nodes: life.getMilestones().length
    })
  },
  goOcean () { wx.redirectTo({ url: '/pages/ocean/ocean' }) },
  openRecent () { if (this.data.recent) wx.navigateTo({ url: '/pages/iceberg/iceberg?id=' + this.data.recent._id }) },
  goMe () { wx.redirectTo({ url: '/pages/stages/stages' }) },
  onTab (e) {
    const t = e.currentTarget.dataset.t
    if (t === 'home') return
    wx.redirectTo({ url: { ocean: '/pages/ocean/ocean', timeline: '/pages/timeline/timeline', me: '/pages/stages/stages' }[t] })
  }
})