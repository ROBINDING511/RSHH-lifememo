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
    polishStyle: 'light',
    openMenu: 'about', cloneConsent: false, showClonePanel: false, nickname: '',
    showNick: false, showAge: false, ageDisplay: '',
    searchQ: '', searchResults: [],
    voiceState: '', voiceSampleUrl: '',
    listening: false, voiceText: ''
  },
  onLoad () {
    const p = life.getProfile() || {}
    this._draft = life.getStages().map((s) => ({ name: s.name, to: s.to, flag: s.flag }))
    this.setData({
      stages: life.getStages(),
      profileMode: p.mode || 'year',
      profileBirthday: p.birthday || '', profileAge: p.age != null ? String(p.age) : '', profileYear: p.year != null ? String(p.year) : ''
    })
    this.recorder = createRecorder()
    this.refreshVoice()
    this.loadAll()
    this.setData({ polishStyle: wx.getStorageSync('polishStyle') || 'light', cloneConsent: wx.getStorageSync('cloneConsent') === '1', nickname: life.getNickname(), ageDisplay: this.fmtAge(life.getProfile()) })
  },
  onNick (e) { this.setData({ nickname: e.detail.value }) },
  // 搜索全部回忆
  async loadAll () {
    try { this._all = await api.listIcebergs() } catch (e) { this._all = [] }
  },
  onSearch (e) {
    const q = (e.detail.value || '').trim()
    this.setData({ searchQ: q })
    if (!q) { this.setData({ searchResults: [] }); return }
    const all = this._all || []
    const hit = all.filter((b) => [b.title, b.text, b.zoneName, b.memoryTime].some((v) => (v || '').includes(q)))
    this.setData({ searchResults: hit.slice(0, 20) })
  },
  clearSearch () { this.setData({ searchQ: '', searchResults: [] }) },
  goDetail (e) { wx.navigateTo({ url: '/pages/iceberg/iceberg?id=' + e.currentTarget.dataset.id }) },
  // 导出回忆录：按年编排文稿 + 原声链接，可分享/复制/预览
  async exportBook () {
    wx.showLoading({ title: '正在编排回忆录…', mask: true })
    try {
      const all = (this._all && this._all.length) ? this._all : await api.listIcebergs()
      if (!all.length) { wx.hideLoading(); wx.showToast({ title: '还没有回忆可导出', icon: 'none' }); return }
      const ids = all.map((b) => b.audioFileID).filter(Boolean)
      const urlMap = {}
      if (ids.length) {
        const r = await wx.cloud.getTempFileURL({ fileList: ids })
        ;(r.fileList || []).forEach((f) => { if (f.tempFileURL) urlMap[f.fileID] = f.tempFileURL })
      }
      const groups = {}
      all.forEach((b) => {
        const y = /^\d{4}$/.test(String(b.memoryTime || '')) ? b.memoryTime + '年' : '记不清的'
        ;(groups[y] = groups[y] || []).push(b)
      })
      const years = Object.keys(groups).sort((a, b) => (a === '记不清的' ? 1 : b === '记不清的' ? -1 : a.localeCompare(b)))
      const nick = life.getNickname()
      let txt = `人生海海 · 回忆录\n${nick ? nick + ' 的回忆' : '我的回忆'}\n导出时间：${new Date().toLocaleString()}\n共 ${all.length} 段\n`
      years.forEach((y) => {
        txt += `\n【${y}】\n`
        groups[y].forEach((b) => {
          txt += `\n· ${b.title || '一段回忆'}\n`
          txt += `${b.text || ''}\n`
          if (b.audioFileID && urlMap[b.audioFileID]) txt += `原声：${urlMap[b.audioFileID]}\n`
        })
      })
      const fs = wx.getFileSystemManager()
      const path = `${wx.env.USER_DATA_PATH}/人生海海-回忆录.txt`
      fs.writeFileSync(path, txt, 'utf8')
      wx.hideLoading()
      this._bookPath = path
      this._bookTxt = txt
      wx.showActionSheet({
        itemList: ['分享给微信好友', '复制全文', '打开预览'],
        success: (r) => {
          if (r.tapIndex === 0) wx.shareFileMessage({ filePath: path, fileName: '人生海海-回忆录.txt' }).catch(() => wx.showToast({ title: '分享未成功', icon: 'none' }))
          else if (r.tapIndex === 1) wx.setClipboardData({ data: txt, success: () => wx.showToast({ title: '已复制全文', icon: 'none' }) })
          else wx.openDocument({ filePath: path, fileType: 'txt', showMenu: true }).catch(() => wx.showToast({ title: '预览未成功', icon: 'none' }))
        }
      })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '导出没成功，再试一次', icon: 'none' })
    }
  },
  toggleNick () { this.setData({ showNick: !this.data.showNick, showAge: false }) },
  toggleAge () { this.setData({ showAge: !this.data.showAge, showNick: false }) },
  fmtAge (p) {
    if (!p) return ''
    if (p.mode === 'birthday' && p.birthday) return p.birthday
    if (p.mode === 'age' && p.age) return p.age + '岁'
    if (p.year) return p.year + '年'
    return ''
  },
  saveNick () {
    const n = (this.data.nickname || '').trim()
    if (!n) return wx.showToast({ title: '先写个称呼', icon: 'none' })
    life.setNickname(n)
    this.setData({ nickname: n, showNick: false })   // 记好后收起编辑，直接显示在菜单上
    wx.showToast({ title: `好了，${n}`, icon: 'none' })
  },
  // 声音克隆=菜单子功能：默认关闭；主动点开才弹同意框
  openClone () {
    if (this.data.cloneConsent) {
      this.setData({ showClonePanel: !this.data.showClonePanel })
      return
    }
    wx.showModal({
      title: '克隆您的声音，需要您同意',
      content: '用您的录音做一个"您的声音"，只存您自己的云空间、随时可删；不同意完全不影响记录回忆。',
      confirmText: '同意并开启', cancelText: '不同意',
      success: (r) => {
        if (r.confirm) {
          wx.setStorageSync('cloneConsent', '1')
          this.setData({ cloneConsent: true, showClonePanel: true })
          this.refreshVoice()
          wx.showToast({ title: '已开启，开始收集声音', icon: 'none' })
        }
      }
    })
  },
  closeClone () {
    wx.setStorageSync('cloneConsent', '0')
    this.setData({ cloneConsent: false, showClonePanel: false })
    wx.showToast({ title: '已关闭，不再收集克隆样本', icon: 'none' })
  },
  // 主菜单：一级展开/收起二级
  toggleMenu (e) {
    const k = e.currentTarget.dataset.k
    this.setData({ openMenu: this.data.openMenu === k ? '' : k })
  },

  setStyle (e) {
    const s = e.currentTarget.dataset.s
    wx.setStorageSync('polishStyle', s)
    this.setData({ polishStyle: s })
    wx.showToast({ title: '梳理风格已记下', icon: 'none' })
  },
  goTimeline () { wx.navigateTo({ url: '/pages/timeline/timeline' }) },
  goRecycle () { wx.navigateTo({ url: '/pages/recycle/recycle' }) },


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
    this._va.volume = 1
    this._va.src = String(this.data.voiceSampleUrl).replace(/^http:/, 'https:')   // 真机需 https
    this._va.onEnded(() => { this._va.destroy(); this._va = null })
    this._va.onError(() => { wx.showToast({ title: '试听没成功，再点一次', icon: 'none' }); this._va.destroy(); this._va = null })
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
    this.setData({ ageDisplay: this.fmtAge(life.getProfile()), showAge: false })   // 记好后显示在菜单上
    wx.showToast({ title: '记好了', icon: 'none' })
  },

  // ---- 海：改名 / 改边界 / 增删片数 ----
  resetDefault () {
    life.resetStages()
    this._draft = life.getStages().map((s) => ({ name: s.name, to: s.to, flag: s.flag }))
    this.syncDraft()
    wx.showToast({ title: '恢复默认了', icon: 'none' })
  },
  saveAll () {
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
    life.setStages(this._draft)
    wx.showToast({ title: '保存好了', icon: 'none' })
    setTimeout(() => wx.navigateBack(), 900)
  },

  // ---- 人生节点 ----
  onMsName (e) { this.setData({ msName: e.detail.value }) },
  onMsAge (e) { this.setData({ msAge: e.detail.value }) },
  addMs () {
    const name = (this.data.msName || '').trim()
    const raw = String(this.data.msAge || '').trim()
    if (!name) return wx.showToast({ title: '写个节点名字', icon: 'none' })
    let age = NaN
    const ym = raw.match(/^(19|20)\d{2}/)                      // 支持 2017 / 2017.6.8 / 2017-6-8
    if (ym) {
      const by = life.getBirthYear()
      if (!by) return wx.showToast({ title: '先在"关于我"填出生年份，才能换算几岁', icon: 'none', duration: 2600 })
      age = parseInt(ym[0], 10) - by
    } else {
      age = parseInt(raw, 10)
    }
    if (!isFinite(age) || age < 0 || age > 120) return wx.showToast({ title: '填几岁，或填年份如2017', icon: 'none' })
    const ms = life.addMilestone(name, age)   // 加节点 = 开启一片新海
    this._draft = life.getStages().map((s) => ({ name: s.name, to: s.to, flag: s.flag }))
    this.setData({ milestones: ms, msName: '', msAge: '' })
    this.syncDraft()
    wx.showToast({ title: '记下了，多了一片海', icon: 'none' })
  },
  removeMs (e) {
    const ms = life.removeMilestone(e.currentTarget.dataset.id)   // 删节点 = 合并海
    this._draft = life.getStages().map((s) => ({ name: s.name, to: s.to, flag: s.flag }))
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
          this._draft = life.getStages().map((s) => ({ name: s.name, to: s.to, flag: s.flag }))
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