// utils/draft.js — 未完成录音的本地兜底
// 原则：妈妈说的话绝不因为断网/来电/切后台/报错而丢掉。
// 录音文件已在 USER_DATA_PATH（utils/recorder.js 的 buildWavFile），
// 这里只登记索引，回到海洋页时提示"有一段话没存好，点这里找回"。
const KEY = 'pending_drafts'
const MAX = 5

function list () {
  try { return wx.getStorageSync(KEY) || [] } catch (e) { return [] }
}

// draft: { wavPath, text, reason }
function save (draft) {
  if (!draft || (!draft.wavPath && !draft.text)) return null
  const all = list()
  const item = Object.assign({ at: Date.now() }, draft)
  all.unshift(item)
  if (all.length > MAX) all.length = MAX
  try { wx.setStorageSync(KEY, all) } catch (e) { console.warn('草稿保存失败', e) }
  return item
}

function remove (at) {
  try { wx.setStorageSync(KEY, list().filter((d) => d.at !== at)) } catch (e) {}
}

module.exports = { list, save, remove }
