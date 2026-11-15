// packageGuide/pages/guide/guide.js — 首次引导（4 步）
Page({
  data: {
    steps: [
      { img: '1.jpg', title: '欢迎来到人生海海', desc: '这里是妈妈的人生海洋，说过的每句话都会变成一座冰山，永远漂在海上' },
      { img: '2.jpg', title: '长按小鲸鱼杭航', desc: '像发微信语音一样，按住它说话，边说边会变成文字' },
      { img: '3.jpg', title: '话会变成冰山', desc: '说完松手，这段回忆就生成一座冰山，慢慢漂进属于它的海域' },
      { img: '4.jpg', title: '随时回来看看', desc: '点一点冰山就能重温，化成云的回忆也永远在云朵里等你' }
    ],
    step: 0
  },
  next () {
    if (this.data.step < 3) this.setData({ step: this.data.step + 1 })
    else wx.navigateBack()
  },
  skip () { wx.navigateBack() }
})
