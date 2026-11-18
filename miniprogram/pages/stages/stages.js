// pages/stages/stages.js — 人生之海规划：片数/名字/边界可调 + 语音 + 个人资料 + 人生节点
const life = require('../../utils/life')
const api = require('../../utils/api')
const { createRecorder } = require('../../utils/recorder')

Page({
  data: {
    stages: [],
    profileMode: 'year', profileBirthday: '', profileAge: '', profileYear: '',
    milestones: life.getMilestones(), msName: '', msAge: '',
    inviteCode: '', bindCode: '', feedQ: '',
    voiceState: '', voiceSampleUrl: '',
    listening: false, voiceText: ''
  },
  onLoad () {
    const p = life.getProfile() || {}
    this._draft = life.getStages().map((s) => ({ name: s.name, to: s.to }))
    this.setData({
      stages: life.getStages(),
      profileMode: p.mode || 'year',
      profileBirthday: p.birthday || '', profileAge: p.age != null ? String(p.age) : '', profileYear: p.year != null ? String(p.year) : ''
    })
    this.recorder = createRecorder()
    this.refreshVoice()
  },
  noop () {},

  // ---- 妈妈声音克隆管理 ----
  async refreshVoice () {
    try {
      const r = (await wx.cloud.callFunction({ name: 'voiceclone', data: { action: 'status' } })).result || {}
      this.setData({ voiceState: r.state || '', voiceSampleUrl: r.sampleUrl || '' })
    } catch (e) { /* 未部署静默 */ }
  },
  playVoiceSample () {
    if (!this.data.voiceSampleUrl) return
    if (this._va) { this._va.stop(); this._va.destroy(); this._va = null; return }
    this._va = wx.createInnerAudioContext()
    this._va.obeyMuteSwitch = false
    this._va.src = this.data.voiceSampleUrl
    this._va.onEnded(() => { this._va.destroy(); this._va = null })
    this._va.play()
  },
  async deleteVoice () {
    const r = await new Promise((res) => wx.showModal({
      title: '删除克隆的声音？', content: '删除后会重新自动克隆一个新的。', confirmText: '删除', cancelText: '留着',
      success: (x) => res(x.confirm), fail: () => res(false)
    }))
    if (!r) return
    try {
      await wx.cloud.callFunction({ name: 'voiceclone', data: { action: 'delete' } })
      this.refreshVoice()
      wx.showToast({ title: '删了，会重新克隆', icon: 'none' })
    } catch (e) { wx.showToast({ title: '没删掉', icon: 'none' }) }
  },
  syncDraft () { this.setData({ stages: life.buildStages(this._draft) }) },

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

  // ---- 海：改名 / 改边界 / 增删片数 ----
  onNameInput (e) {
    const i = Number(e.currentTarget.dataset.i)
    this._draft[i].name = e.detail.value || ('海' + (i + 1))
    this.syncDraft()
  },
  onToInput (e) {
    const i = Number(e.currentTarget.dataset.i)
    if (i >= this._draft.length - 1) return   // 最后一片是"以后"
    const v = parseInt(e.detail.value, 10)
    if (!isFinite(v)) return
    const lo = i === 0 ? 1 : this._draft[i - 1].to + 1
    const hi = this._draft[i + 1].to - 1
    this._draft[i].to = Math.max(lo, Math.min(hi, v))
    this.syncDraft()
  },
  addSea () {
    const last = this._draft[this._draft.length - 1]
    const prev = this._draft[this._draft.length - 2]
    const mid = Math.round((prev.to + last.to) / 2)
    this._draft.splice(this._draft.length - 1, 0, { name: '新海', to: Math.max(prev.to + 1, mid) })
    this.syncDraft()
  },
  removeSea (e) {
    if (this._draft.length <= 2) return wx.showToast({ title: '至少留两片海', icon: 'none' })
    this._draft.splice(Number(e.currentTarget.dataset.i), 1)
    this.syncDraft()
  },
  resetDefault () {
    life.resetStages()
    this._draft = life.getStages().map((s) => ({ name: s.name, to: s.to }))
    this.syncDraft()
    wx.showToast({ title: '恢复默认了', icon: 'none' })
  },
  saveAll () {
    life.setStages(this._draft)
    wx.showToast({ title: '保存好了', icon: 'none' })
    setTimeout(() => wx.navigateBack(), 900)
  },

  // ---- 人生节点 ----
  onMsName (e) { this.setData({ msName: e.detail.value }) },
  onMsAge (e) { this.setData({ msAge: e.detail.value }) },
  addMs () {
    const name = (this.data.msName || '').trim()
    const age = parseInt(this.data.msAge, 10)
    if (!name) return wx.showToast({ title: '写个节点名字', icon: 'none' })
    if (!isFinite(age)) return wx.showToast({ title: '填几岁', icon: 'none' })
    const ms = life.addMilestone(name, age)   // 加节点 = 开启一片新海
    this._draft = life.getStages().map((s) => ({ name: s.name, to: s.to }))
    this.setData({ milestones: ms, msName: '', msAge: '' })
    this.syncDraft()
    wx.showToast({ title: '记下了，多了一片海', icon: 'none' })
  },
  removeMs (e) {
    const ms = life.removeMilestone(e.currentTarget.dataset.id)   // 删节点 = 合并海
    this._draft = life.getStages().map((s) => ({ name: s.name, to: s.to }))
    this.setData({ milestones: ms })
    this.syncDraft()
  },

  // ---- 家人共建 ----
  async inviteFamily () {
    try {
      const r = (await wx.cloud.callFunction({ name: 'family', data: { action: 'invite' } })).result || {}
      if (r.ok) this.setData({ inviteCode: r.code })
      else wx.showToast({ title: r.error || '生成失败', icon: 'none' })
    } catch (e) { wx.showToast({ title: '需先部署 family 云函数', icon: 'none' }) }
  },
  onBindCode (e) { this.setData({ bindCode: e.detail.value }) },
  async bindFamily () {
    try {
      const r = (await wx.cloud.callFunction({ name: 'family', data: { action: 'bind', code: this.data.bindCode } })).result || {}
      if (r.ok) {
        wx.setStorageSync('familyOwner', r.owner)
        wx.showToast({ title: '绑定好了，回海洋看家人的海', icon: 'none', duration: 2400 })
      } else wx.showToast({ title: r.error || '绑定失败', icon: 'none' })
    } catch (e) { wx.showToast({ title: '需先部署 family 云函数', icon: 'none' }) }
  },
  onFeedQ (e) { this.setData({ feedQ: e.detail.value }) },
  async feedQuestion () {
    const t = (this.data.feedQ || '').trim()
    if (!t) return wx.showToast({ title: '写个问题', icon: 'none' })
    try {
      const r = (await wx.cloud.callFunction({ name: 'family', data: { action: 'addQuestion', text: t } })).result || {}
      if (r.ok) { this.setData({ feedQ: '' }); wx.showToast({ title: '投喂好了', icon: 'none' }) }
      else wx.showToast({ title: r.error || '投喂失败', icon: 'none' })
    } catch (e) { wx.showToast({ title: '需先部署 family 云函数', icon: 'none' }) }
  },

  // ---- 语音：按住跟杭航说 ----
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
        const list = life.parseStagesFromText(text)
        if (list) {
          life.setStages(list)
          this._draft = life.getStages().map((s) => ({ name: s.name, to: s.to }))
          this.syncDraft()
          this.setData({ voiceText: text })
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