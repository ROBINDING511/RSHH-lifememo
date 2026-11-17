// packageGuide/pages/guide/guide.js — 首次引导（4 步 + 年纪设置）
// 适老化：支持"上一步"回看，进度明示；年纪可给生日/年龄/出生年（尊重长辈隐私）
const life = require('../../../utils/life')
Page({
  data: {
    steps: [
      { img: '1.png', title: '欢迎来到人生海海', desc: '这里是您的人生海洋。说过的每句话，都会变成一座冰山，永远漂在海上。' },
      { img: '2.png', title: '怎么说话', desc: '按住下面的青色按钮说话，松手发送，上滑取消。也可以长按小鲸鱼杭航说话。' },
      { img: '3.png', title: '话会变成冰山', desc: '松手后字已实时出来。看一眼、改改错字，点"变成冰山"。' },
      { img: '4.png', title: '随时回来看看', desc: '点海上的冰山看回忆、听原声。删掉的变成云，随时能落回海面。' },
      { type: 'profile', title: '告诉我你的年纪', desc: '方便就选生日；不方便，给年龄或出生年份也行。这样你说"当我14岁"，我就知道是哪一年、该漂在哪片海。' }
    ],
    step: 0,
    safeTop: 88,
    profileMode: 'year', profileBirthday: '', profileAge: '', profileYear: ''
  },
  onLoad () {
    // 自定义导航：内容从胶囊下沿以下开始，避免被状态栏/胶囊压住
    let top = 88
    try {
      const r = wx.getMenuButtonBoundingClientRect()
      if (r && r.bottom) top = r.bottom + 8
    } catch (e) {}
    const p = life.getProfile() || {}
    this.setData({
      safeTop: top,
      profileMode: p.mode || 'year',
      profileBirthday: p.birthday || '', profileAge: p.age != null ? String(p.age) : '', profileYear: p.year != null ? String(p.year) : ''
    })
  },
  setMode (e) { this.setData({ profileMode: e.currentTarget.dataset.m }) },
  onBirthdayPick (e) { this.setData({ profileBirthday: e.detail.value }) },
  onAgeInput (e) { this.setData({ profileAge: e.detail.value }) },
  onYearInput (e) { this.setData({ profileYear: e.detail.value }) },
  saveProfileFromFields () {
    const m = this.data.profileMode
    const p = { mode: m }
    if (m === 'birthday' && this.data.profileBirthday) p.birthday = this.data.profileBirthday
    else if (m === 'age' && this.data.profileAge) p.age = Number(this.data.profileAge)
    else if (m === 'year' && this.data.profileYear) p.year = Number(this.data.profileYear)
    else return   // 没填就不存，尊重隐私
    life.setProfile(p)
  },
  next () {
    const cur = this.data.steps[this.data.step]
    if (cur && cur.type === 'profile') { this.saveProfileFromFields(); this.finish(); return }
    if (this.data.step < this.data.steps.length - 1) this.setData({ step: this.data.step + 1 })
    else this.finish()
  },
  prev () {
    if (this.data.step > 0) this.setData({ step: this.data.step - 1 })
  },
  skip () { this.finish() },
  finish () {
    const pages = getCurrentPages()
    if (pages.length > 1) wx.navigateBack()
    else wx.reLaunch({ url: '/pages/ocean/ocean' })
  }
})
