// 官方隐私授权弹窗：wx.onNeedPrivacyAuthorization 触发，同意按钮用 open-type
Component({
  data: { show: false },
  lifetimes: {
    attached () {
      if (wx.onNeedPrivacyAuthorization) {
        wx.onNeedPrivacyAuthorization((resolve) => {
          this._resolve = resolve
          this.setData({ show: true })
        })
      }
    }
  },
  methods: {
    onAgree () {
      if (this._resolve) this._resolve({ event: 'agree', buttonId: 'privacy-agree-btn' })
      this._resolve = null
      this.setData({ show: false })
    },
    onRefuse () {
      if (this._resolve) this._resolve({ event: 'disagree' })
      this._resolve = null
      this.setData({ show: false })
    }
  }
})
