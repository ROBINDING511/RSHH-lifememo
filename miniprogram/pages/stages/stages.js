// pages/stages/stages.js — 人生之海规划：片数/名字/边界可调 + 语音 + 个人资料 + 人生节点
const life = require('../../utils/life')
const draft = require('../../utils/draft')
const api = require('../../utils/api')
const { createRecorder } = require('../../utils/recorder')

Page({
  data: {
    stages: [],
    milestones: life.getMilestones(), msName: '', msAge: '',
    inviteCode: '', bindCode: '', feedQ: '',
    polishStyle: 'light',
    openMenu: '', cloneConsent: false, showClonePanel: false, nickname: '',
    showNick: false, showAge: false, ageDisplay: '', showPeople: false, peopleList: [], personInput: '',
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
    this.setData({ polishStyle: wx.getStorageSync('polishStyle') || 'light', cloneConsent: wx.getStorageSync('cloneConsent') === '1', nickname: life.getNickname(), ageDisplay: this.fmtAge(life.getProfile()), peopleList: life.getKnownPeople() })
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
  toggleNick () { this.setData({ showNick: !this.data.showNick, showAge: false, showPeople: false }) },
  togglePeople () { this.setData({ showPeople: !this.data.showPeople, showNick: false }) },
  onPersonInput (e) { this.setData({ personInput: e.detail.value }) },
  addPerson () {
    const n = (this.data.personInput || '').trim()
    if (!n) return
    this.setData({ peopleList: life.addKnownPerson(n), personInput: '' })
  },
  removePerson (e) { this.setData({ peopleList: life.removeKnownPerson(e.currentTarget.dataset.n) }) },
  renameMs (e) {
    const id = e.currentTarget.dataset.id
    const name = (e.detail.value || '').trim()
    if (!name) return
    life.renameMilestone(id, name)
    this.setData({ milestones: life.getMilestones() })
    this.syncDraft()
  },
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
    life.addKnownPerson(n)
    this.setData({ nickname: n, showNick: false, peopleList: life.getKnownPeople() })   // 记好后收起编辑，直接显示在菜单上
    wx.showToast({ title: `好了，${n}`, icon: 'none' })
  },
  // 声音克隆=菜单子功能：默认关闭；主动点开才弹同意框
  toggleCloneSwitch () {
    if (this.data.cloneConsent) { this.closeClone(); return }   // 再点=关闭
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
  openDraft () {
    const d = draft.list()[0]
    if (!d) return
    wx.navigateTo({ url: '/pages/ocean/ocean?draft=' + d.at })
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
  onBirthdayPick (e) {
    const b = e.detail.value
    if (!b) return
    life.setProfile(Object.assign({}, life.getProfile() || {}, { mode: 'birthday', birthday: b }))
    this.setData({ profileBirthday: b, ageDisplay: this.fmtAge(life.getProfile()), milestones: life.getMilestones() })
    this.syncDraft()   // 生日填好后岁数自动换算，海边界同步
    wx.showToast({ title: '记好了，' + b, icon: 'none' })
  },

  // ---- 海：改名 / 改边界 / 增删片数 ----

  // ---- 人生节点 ----
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
  onNodeStart () {
    if (this.data.listening) return
    this.setData({ listening: true, voiceText: '' })
    let plugin = null
    try { plugin = requirePlugin('WechatSI') } catch (e) {}
    if (plugin) {
      const mgr = plugin.getRecordRecognitionManager()
      this._native = mgr
      mgr.onRecognize = (res) => { if (res && res.result) this.setData({ voiceText: res.result }) }
      mgr.onStop = (res) => { this.setData({ listening: false }); this.applyNodes((res && res.result) || this.data.voiceText, res && res.tempFilePath) }
      mgr.onError = () => { this.setData({ listening: false }); wx.showToast({ title: '没听清，按住再说一次', icon: 'none' }) }
      mgr.start({ lang: 'zh_CN', duration: 60000 })
      return
    }
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
        this.applyNodes(text, wavPath)
      }
    })
  },
  // 大模型听懂多个节点→自动填好（去重/合并反复），带年月日
  async applyNodes (text, wavPath) {
    if ((!text || !text.trim()) && wavPath) {
      wx.showLoading({ title: '正在听懂您的节点…', mask: true })
      try {
        const up = await wx.cloud.uploadFile({ cloudPath: 'tmp_asr/nodes_' + Date.now() + '.wav', filePath: wavPath })
        const r = (await wx.cloud.callFunction({ name: 'transcribe', data: { fileID: up.fileID } })).result || {}
        if (r.ok && r.text) text = r.text
        wx.cloud.deleteFile({ fileList: [up.fileID] }).catch(() => {})
      } catch (e) {}
      wx.hideLoading()
    }
    this.setData({ voiceText: text })
    if (!text || !text.trim()) return wx.showToast({ title: '没听清，按住再说一次', icon: 'none' })
    const by = life.getBirthYear()
    wx.showLoading({ title: '正在听懂您的节点…', mask: true })
    let nodes = []
    try {
      const r = (await wx.cloud.callFunction({ name: 'analyze', data: { action: 'milestones', text } })).result || {}
      nodes = r.nodes || []
    } catch (e) {}
    wx.hideLoading()
    if (!nodes.length) {
      const ms = life.parseMilestoneFromText(text)
      if (ms && ms.name) nodes = [{ name: ms.name, year: by ? by + ms.age : null }]
    }
    if (!nodes.length) return wx.showToast({ title: '没听懂节点，试试"2011年7月毕业"', icon: 'none', duration: 2600 })
    let added = 0
    const seen = {}
    nodes.forEach((n) => {
      const year = parseInt(n.year, 10)
      const name = String(n.name || '').trim().slice(0, 8)
      if (!name || !isFinite(year)) return
      const age = by != null ? year - by : null
      if (age != null && (age < 0 || age > 120)) return
      const key = name + '@' + year
      if (seen[key]) return
      seen[key] = 1
      const date = n.year + '年' + (n.month ? n.month + '月' : '') + (n.day ? n.day + '日' : '')
      life.addMilestone(name, age, year, date)
      added++
    })
    this.setData({ milestones: life.getMilestones() })
    this.syncDraft()
    wx.showToast({ title: added ? '听懂了，填好' + added + '个节点' : '这些节点已经有了', icon: 'none', duration: 2400 })
    if (added && by == null) setTimeout(() => wx.showToast({ title: '方便的话在"关于我"填出生年月，岁数会自动算', icon: 'none', duration: 2600 }), 2500)
  },
  onNodeEnd () { if (!this.data.listening) return; if (this._native) this._native.stop(); else this.recorder.stop() },
  onUnload () { if (this.asr) this.asr.close(); if (this.recorder.recording) this.recorder.stop() }
})