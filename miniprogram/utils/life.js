// utils/life.js — 人生阶段：由生日推导年份→阶段，供"哪片海"归类与海面配色
// 阶段按年龄划分；海面从左到右 = 童年→晚年，颜色连续渐变（整片海滚动）。
const STAGES = [
  { key: '童年', from: 0, to: 12, color: '#CFE8DC' },
  { key: '少年', from: 13, to: 17, color: '#BFE3E0' },
  { key: '青年', from: 18, to: 35, color: '#9FD0D8' },
  { key: '中年', from: 36, to: 59, color: '#7FB4C8' },
  { key: '晚年', from: 60, to: 120, color: '#6E9CC0' }
]

function stageOfAge (age) {
  const a = Number(age)
  if (!isFinite(a)) return STAGES[STAGES.length - 1]
  return STAGES.find((s) => a >= s.from && a <= s.to) || STAGES[STAGES.length - 1]
}
function stageOfYear (year, birthYear) {
  if (!birthYear) return STAGES[STAGES.length - 1]
  return stageOfAge(Number(year) - Number(birthYear))
}
function stageByKey (key) {
  return STAGES.find((s) => s.key === key) || null
}
// 从口述正文里抓"…14岁…"→ 年龄；支持"当我14岁/我14岁/14岁那年"
function parseAge (text) {
  const m = String(text || '').match(/(\d{1,2})\s*岁/)
  return m ? Number(m[1]) : null
}
// 事情发生年份 = 出生年 + 年龄 - 1
function eventYear (birthYear, age) {
  return Number(birthYear) + Number(age) - 1
}
function getBirthday () {
  try { return wx.getStorageSync('birthday') || '' } catch (e) { return '' }
}
function getBirthYear () {
  const b = getBirthday()
  return b ? Number(String(b).slice(0, 4)) : null
}
function setBirthday (v) {
  try { wx.setStorageSync('birthday', v) } catch (e) {}
}

module.exports = { STAGES, stageOfAge, stageOfYear, stageByKey, parseAge, eventYear, getBirthday, getBirthYear, setBirthday }