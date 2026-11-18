// packageGuide/pages/setup/setup.js — 首次设置指引（填空+滚轮，非追问式调研）
// 微信不提供生日；昵称可用"头像昵称填写能力"(input type=nickname)一键带入微信昵称。
const life = require('../../../utils/life')

const YEARS = []
for (let y = 2020; y >= 1920; y--) YEARS.push(y + '年')

Page({
  data: {
    nickname: '',
    birthMode: 'date',
    birthday: '',
    year: '',
    years: YEARS,
    yearIdx: 60,
    event: '',
    eventYear: '',
    evIdx: 40
  },
  onLoad () {
    const p = life.getProfile() || {}
    this.setData({
      nickname: p.nickname || '',
      birthday: p.birthday || '',
      year: p.year ? p.year + '年' : '',
      yearIdx: p.year ? Math.max(0, 2020 - p.year) : 60
    })
  },
  onNick (e) { this.setData({ nickname: e.detail.value }) },
  setBirthMode (e) { this.setData({ birthMode: e.currentTarget.dataset.m }) },
  onBirthday (e) { this.setData({ birthday: e.detail.value }) },
  onYear (e) { this.setData({ yearIdx: +e.detail.value, year: YEARS[+e.detail.value] }) },
  onEvent (e) { this.setData({ event: e.detail.value }) },
  onEventYear (e) { this.setData({ evIdx: +e.detail.value, eventYear: YEARS[+e.detail.value] }) },
  save () {
    const nick = (this.data.nickname || '').trim()
    const p = { mode: this.data.birthMode === 'date' ? 'birthday' : 'year' }
    if (nick) p.nickname = nick
    if (this.data.birthMode === 'date' && this.data.birthday) p.birthday = this.data.birthday
    else if (this.data.year) p.year = parseInt(this.data.year, 10)
    life.setProfile(p)
    // 重要时刻（可选）→ 多开一片海；不填不猜测
    const ev = (this.data.event || '').trim()
    if (ev && this.data.eventYear) {
      const ey = parseInt(this.data.eventYear, 10)
      const by = life.getBirthYear()
      const age = by ? ey - by : null
      if (age != null && age >= 0) life.addMilestone(ev, age)
    }
    wx.reLaunch({ url: '/pages/ocean/ocean' })
  },
  skip () { wx.reLaunch({ url: '/pages/ocean/ocean' }) }
})