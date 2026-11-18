// utils/ui.js — 统一轻提示与二次确认（适老大白话 + 统一 palette）
const PRIMARY = '#1F6478'
const DANGER = '#B3402F'

function toast (title, duration = 2000) {
  wx.showToast({ title, icon: 'none', duration })
}

// 二次确认：resolve 'confirm' | 'cancel'。danger=true 时确认键为危险色。
function confirm (opts) {
  return new Promise((resolve) => {
    wx.showModal({
      title: opts.title,
      content: opts.content,
      confirmText: opts.confirmText,
      cancelText: opts.cancelText,
      confirmColor: opts.danger ? DANGER : PRIMARY,
      cancelColor: opts.danger ? PRIMARY : DANGER,
      success: (r) => resolve(r.confirm ? 'confirm' : 'cancel'),
      fail: () => resolve('cancel')
    })
  })
}

module.exports = { toast, confirm, PRIMARY, DANGER }