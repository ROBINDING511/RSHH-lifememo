// utils/life.js — 人生阶段：默认 + 用户自定义（拖拽 / 语音），个人资料（生日/年龄/出生年）
// 海面从左到右 = 童年→晚年，颜色连续渐变；阶段边界可由用户调整（有人 0-6 算童年，有人 0-18）。
const NAMES = ['童年', '少年', '青年', '中年', '晚年']
const COLORS = ['#CFE8DC', '#BFE3E0', '#9FD0D8', '#7FB4C8', '#6E9CC0']
const DEFAULT_BOUNDS = [12, 17, 35, 59]   // 各阶段结束年龄（童年0-12 … 晚年60+）

function getBounds () {
  try {
    const b = wx.getStorageSync('lifeBounds')
    if (Array.isArray(b) && b.length === 4 && b.every((x) => isFinite(x))) return b
  } catch (e) {}
  return DEFAULT_BOUNDS.slice()
}
function setBounds (b) {
  try { wx.setStorageSync('lifeBounds', b) } catch (e) {}
}
function resetBounds () { setBounds(DEFAULT_BOUNDS.slice()) }

function getStages () {
  const b = getBounds()
  const starts = [0, b[0] + 1, b[1] + 1, b[2] + 1, b[3] + 1]
  return NAMES.map((n, i) => ({ key: n, from: starts[i], to: i < 4 ? b[i] : 120, color: COLORS[i] }))
}
function stageOfAge (age) {
  const a = Number(age)
  const s = getStages()
  if (!isFinite(a)) return s[s.length - 1]
  return s.find((x) => a >= x.from && a <= x.to) || s[s.length - 1]
}
function stageOfYear (year, birthYear) {
  if (!birthYear) return getStages()[4]
  return stageOfAge(Number(year) - Number(birthYear))
}
function stageByKey (key) { return getStages().find((s) => s.key === key) || null }

// ---- 个人资料：生日 / 年龄 / 出生年 三选一（长辈可只给年龄或年份）----
function getProfile () {
  try { return wx.getStorageSync('lifeProfile') || null } catch (e) { return null }
}
function setProfile (p) {
  try { wx.setStorageSync('lifeProfile', p) } catch (e) {}
}
function getBirthYear () {
  const p = getProfile()
  if (!p) return null
  if (p.birthday) return Number(String(p.birthday).slice(0, 4))
  if (p.year) return Number(p.year)
  if (p.age != null && p.age !== '') return new Date().getFullYear() - Number(p.age)
  return null
}

// ---- 口述年龄："当我14岁" / "十四岁" ----
const CN = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
function cn2num (s) {
  if (/^\d+$/.test(s)) return Number(s)
  if (s === '十') return 10
  const m = s.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/)
  if (m) return (m[1] ? CN[m[1]] : 1) * 10 + (m[2] ? CN[m[2]] : 0)
  return CN[s] != null ? CN[s] : null
}
function parseAge (text) {
  const t = String(text || '')
  let m = t.match(/(\d{1,2})\s*岁/)
  if (m) return Number(m[1])
  m = t.match(/([一二两三四五六七八九十]{1,3})\s*岁/)
  if (m) return cn2num(m[1])
  return null
}
function eventYear (birthYear, age) { return Number(birthYear) + Number(age) - 1 }

// ---- 口述阶段边界："童年到18岁" / "0到18算童年" / "青年到40" ----
function parseStagesFromText (text) {
  const t = String(text || '')
  const ends = {}
  for (const name of NAMES.slice(0, 4)) {
    // "童年到18岁" / "童年算到18" / "0到18岁是童年" / "18岁之前是童年"
    let m = t.match(new RegExp(name + '[^\\d]{0,6}(\\d{1,2})\\s*岁?'))
    if (!m) m = t.match(new RegExp('(\\d{1,2})\\s*岁?(?:之前|以前|以内|算|是)?[^\\d]{0,4}' + name))
    if (!m) m = t.match(new RegExp('(\\d{1,2})\\s*岁?(?:之前|以前|以内)?(?:都)?算' + name))
    if (m) ends[name] = Number(m[1])
  }
  if (!Object.keys(ends).length) return null
  const b = getBounds()
  NAMES.slice(0, 4).forEach((n, i) => { if (ends[n] != null) b[i] = ends[n] })
  // 保证单调递增
  for (let i = 1; i < 4; i++) if (b[i] <= b[i - 1]) b[i] = b[i - 1] + 1
  return b
}

module.exports = {
  NAMES, COLORS, DEFAULT_BOUNDS,
  getBounds, setBounds, resetBounds, getStages,
  stageOfAge, stageOfYear, stageByKey,
  getProfile, setProfile, getBirthYear,
  parseAge, eventYear, parseStagesFromText
}