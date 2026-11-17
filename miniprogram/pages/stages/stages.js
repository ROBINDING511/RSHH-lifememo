// pages/stages/stages.js — 人生阶段规划：拖拽分隔点 / 语音告诉杭航 / 个人资料
const life = require('../../utils/life')
const api = require('../../utils/api')
const { createRecorder } = require('../../utils/recorder')

Page({
  data: {
    bounds: [], stages: [],
    profileMode: 'year', profileBirthday: '', profileAge: '', profileYear: '',
    milestones: life.getMilestones(), msName: '', msAge: '',
    listening: false, voiceText: ''
  },
  onLoad () {
    const p = life.getProfile() || {}
    this.setData({
      bounds: life.getBounds(), stages: this.stagesOf(life.getBounds()),
      profileMode: p.mode || 'year',
      profileBirthday: p.birthday || '', profileAge: p.age != null ? String(p.age) : '', profileYear: p.year != null ? String(p.year) : ''
    })
    this.recorder = createRecorder()
  },
  noop () {},

  // ---- 个人资料 ----
  setMode (e) { this.setData({ profileMode: e.currentTarget.dataset.m }) },
  onBirthdayPick (e) { this.setData({ profileBirthday: e.detail.value }) },
  onAgeInput (e) { this.setData({ profileAge: e.detail.value }) },
  onYearInput (e) { this.setData({ profileYear: e.detail.value }) },
  saveProfile () {
    const m = this.data.profileMode
    const p = { mode: m }
    if (m === 'birthday') { if (!this.data.profileBirthday) return wx.showToast({ title: '先选生日', icon: 'none' }); p.birthday = this.data.profileBirthday }
    else if (m === 'age') { if (!this.data.profileAge) return wx.showToast({ title: '填个年龄', icon: 'none' }); p.age = Number(this.data.profileAge) }
    else { if (!this.data.profileYear) return wx.showToast({ title: '填个年份', icon: 'none' }); p.year = Number(this.data.profileYear) }
    life.setProfile(p)
    wx.showToast({ title: '记好了', icon: 'none' })
  },

  // ---- 数字框改边界（比拖拽更稳、适老）----
  onToInput (e) {
    const i = Number(e.currentTarget.dataset.i)
    if (i >= 4) return
    const v = parseInt(e.detail.value, 10)
    if (!isFinite(v)) return
    const b = this.data.bounds.slice()
    const lo = i === 0 ? 1 : b[i - 1] + 1
    const hi = i === 3 ? 99 : b[i + 1] - 1
    b[i] = Math.max(lo, Math.min(hi, v))
    this.setData({ bounds: b, stages: this.stagesOf(b) })
  },
  onFromInput (e) {
    const i = Number(e.currentTarget.dataset.i)
    if (i === 0) return
    const v = parseInt(e.detail.value, 10)
    if (!isFinite(v)) return
    const b = this.data.bounds.slice()
    const lo = i - 1 === 0 ? 1 : b[i - 2] + 1
    const hi = b[i] - 1
    b[i - 1] = Math.max(lo, Math.min(hi, v - 1))
    this.setData({ bounds: b, stages: this.stagesOf(b) })
  },
  stagesOf (b) {
    const starts = [0, b[0] + 1, b[1] + 1, b[2] + 1, b[3] + 1]
    return life.NAMES.map((n, i) => {
      const to = i < 4 ? b[i] : 120
      return { key: n, from: starts[i], to, dispTo: Math.min(to, 100), color: life.COLORS[i] }
    })
  },
  // ---- 自定义人生节点 ----
  onMsName (e) { this.setData({ msName: e.detail.value }) },
  onMsAge (e) { this.setData({ msAge: e.detail.value }) },
  addMs () {
    const name = (this.data.msName || '').trim()
    const age = parseInt(this.data.msAge, 10)
    if (!name) return wx.showToast({ title: '写个节点名字', icon: 'none' })
    if (!isFinite(age)) return wx.showToast({ title: '填几岁', icon: 'none' })
    this.setData({ milestones: life.addMilestone(name, age), msName: '', msAge: '' })
    wx.showToast({ title: '记下了', icon: 'none' })
  },
  removeMs (e) {
    this.setData({ milestones: life.removeMilestone(e.currentTarget.dataset.id) })
  },

  resetDefault () {
    life.resetBounds()
    this.setData({ bounds: life.getBounds(), stages: life.getStages() })
    wx.showToast({ title: '恢复默认了', icon: 'none' })
  },
  saveAll () {
    life.setBounds(this.data.bounds)
    wx.showToast({ title: '保存好了', icon: 'none' })
    setTimeout(() => wx.navigateBack(), 900)
  },

  // ---- 语音：按住跟杭航说划分 ----
  onVoiceStart () {
    if (this.data.listening) return
    this.setData({ listening: true, voiceText: '' })
    const cfg = api.getAsrConfig()
    this.asr = null
    if (cfg && cfg.key) {
      const { AsrStream } = require('../../utils/asr')
      this.asr = new AsrStream(cfg)
      this.asr.on('partial', (t) => this.setData({ voiceText: t }))
      this.asr.on('sentence', (t) => this.setData({ voiceText: t }))
      this.asr.connect()
    }
    this.recorder.start({
      onFrame: (buf) => this.asr && this.asr.sendFrame(buf),
      onStop: async (wavPath, dur, err) => {
        let text = this.data.voiceText
        if (this.asr) { const t = await this.asr.finish(1200).catch(() => ''); if (t && t.length > text.length) text = t; this.asr.close() }
        this.setData({ listening: false })
        const b = life.parseStagesFromText(text)
        if (b) {
          life.setBounds(b)
          this.setData({ bounds: b, stages: this.stagesOf(b), voiceText: text })
          wx.showToast({ title: '按你说的设好了', icon: 'none', duration: 2200 })
        } else {
          const ms = life.parseMilestoneFromText(text)
          if (ms && ms.name) {
            this.setData({ milestones: life.addMilestone(ms.name, ms.age), voiceText: text })
            wx.showToast({ title: '记下节点：' + ms.age + '岁 ' + ms.name, icon: 'none', duration: 2400 })
          } else {
            wx.showToast({ title: '没听清，试试说"童年到18岁"或"30岁孩子出生"', icon: 'none', duration: 2600 })
          }
        }
      }
    })
  },
  onVoiceEnd () { if (this.data.listening) this.recorder.stop() },
  onUnload () { if (this.asr) this.asr.close(); if (this.recorder.recording) this.recorder.stop() }
})