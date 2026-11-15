// app.js — 人生海海
// 核心隐喻：海洋=人生，冰山=回忆，杭航(浅蓝色鲸鱼)=儿子
App({
  globalData: {
    userInfo: null,
    asrConfig: null, // { key, url, model } 由 login 云函数下发，不打进包里
    whaleName: '杭航',
    firstLaunch: false
  },

  onLaunch () {
    if (!wx.cloud) {
      console.error('基础库版本过低，无法使用云开发')
      return
    }
    // 云开发环境 ID（2026-11-15 用户开通，环境名 lifememo）
    wx.cloud.init({
      env: 'lifememo-d7gopzprfc266a543',
      traceUser: true
    })
    this.firstLaunch = !wx.getStorageSync('hasLaunched')
    this.globalData.firstLaunch = this.firstLaunch
    if (this.firstLaunch) {
      wx.setStorageSync('hasLaunched', true)
    }
    this.silentLogin()
  },

  // 静默登录：拿 openid + ASR 流式配置
  async silentLogin () {
    try {
      const res = await wx.cloud.callFunction({ name: 'login' })
      const r = res.result || {}
      this.globalData.userInfo = { openid: r.openid }
      this.globalData.asrConfig = {
        key: r.asrKey,
        url: r.asrUrl,
        model: r.asrModel
      }
    } catch (e) {
      console.warn('登录失败，稍后重试', e)
    }
  }
})
