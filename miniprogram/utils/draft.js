// utils/draft.js — 未完成录音的本地兜底
// 原则：妈妈说的话绝不因为断网/来电/切后台/报错而丢掉。
// 录音文件已在 USER_DATA_PATH（utils/recorder.js 的 buildWavFile），
// 这里只登记索引，回到海洋页时提示"有一段话没存好，点这里找回"。
//
// 上限说明：原来 MAX=5，且超限用 `all.length = MAX` 直接截断 —— 第 6 段一来
// 就把第 1 段**静默挤掉**（无提示、音频文件还留在磁盘成孤儿）。
// 提到 20 并改为「挤出时回收文件 + 告警」：一段 60s WAV ≈ 1.9MB，
// 20 段 ≈ 38MB，远低于 USER_DATA_PATH 的 200MB 上限，代价可接受。
const KEY = 'pending_drafts'
const MAX = 20

function list () {
  try { return wx.getStorageSync(KEY) || [] } catch (e) { return [] }
}

// 索引被挤出时，顺手删掉它的本地 WAV，否则文件永远留在磁盘上成了孤儿：
// 既找不回来，又白占空间（20 段能占几十 MB）
function unlinkQuietly (path) {
  if (!path) return
  try {
    const fsm = wx.getFileSystemManager()
    fsm.unlink({ filePath: path, fail: () => { /* 文件可能已被系统清理，忽略 */ } })
  } catch (e) { /* 忽略 */ }
}

// draft: { wavPath, text, reason }
function save (draft) {
  if (!draft || (!draft.wavPath && !draft.text)) return null
  const all = list()
  const item = Object.assign({ at: Date.now() }, draft)
  all.unshift(item)
  // 超限丢弃最旧的，但绝不静默：清掉孤儿音频 + 明确告警，便于排查
  if (all.length > MAX) {
    const dropped = all.splice(MAX)
    dropped.forEach((d) => unlinkQuietly(d.wavPath))
    console.warn(`[draft] 草稿已满 ${MAX} 条，丢弃最旧 ${dropped.length} 段并已清理其音频文件`)
  }
  try { wx.setStorageSync(KEY, all) } catch (e) { console.warn('草稿保存失败', e) }
  return item
}

// 仅从索引中移除，**不删音频文件**。
// 调用方 recoverDraft 是"取出来交给发布卡继续用这个 wavPath"，
// 此时删文件会让发布卡的原声指向一个不存在的路径，妈妈的原声就没了。
// 真正要回收磁盘请用 forgetPath()。
function remove (at) {
  try { wx.setStorageSync(KEY, list().filter((d) => d.at !== at)) } catch (e) {}
}

// 按音频路径清理：发布成功后本地 WAV 已上传云端，成了冗余文件，连索引一起回收。
// 用路径而非 at 匹配 —— 发布卡的 wavPath 可能来自本次录音（不在索引里），
// 也可能来自草稿恢复（在索引里），两种情况都要能处理。
function forgetPath (wavPath) {
  if (!wavPath) return
  try {
    const all = list()
    const rest = all.filter((d) => d.wavPath !== wavPath)
    // 只在确实有匹配项时才回写，避免无谓的 storage 写入
    if (rest.length !== all.length) wx.setStorageSync(KEY, rest)
  } catch (e) { /* 忽略 */ }
  unlinkQuietly(wavPath)
}

module.exports = { list, save, remove, forgetPath, MAX }
