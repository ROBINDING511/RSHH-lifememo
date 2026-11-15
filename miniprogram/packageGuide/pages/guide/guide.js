// packageGuide/pages/guide/guide.js — 首次引导（4 步）
// 适老化：支持"上一步"回看，进度明示（第 X 步/共 4 步）
Page({
  data: {
    steps: [
      { img: '1.jpg', title: '欢迎来到人生海海', desc: '这里是您的人生海洋，说过的每句话都会变成一座冰山，永远漂在海上' },
      { img: '2.jpg', title: '怎么说话', desc: '按住屏幕下面的蓝色按钮，想说什么就说什么；说完了，再点一下就行。也可以长按小鲸鱼杭航说话' },
      { img: '3.jpg', title: '话会变成冰山', desc: '说完松手，字会自己跳出来。看一眼，有错字可以改一改，然后点"变成冰山"' },
      { img: '4.jpg', title: '随时回来看看', desc: '点一下海上的冰山，就能看到当时的话，还能听听自己的声音。删掉的会变成云，随时能落回海面' }
    ],
    step: 0
  },
  next () {
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
