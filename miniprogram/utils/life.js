// utils/life.js — 人生之海：可自定义片数/名字/边界 + 个人资料 + 人生节点 + 口述解析
// 默认五片海（童年/少年/青年/中年/晚年），用户可增删、改名、改边界；海面颜色按片数连续渐变。
// 海的片数由用户自己的重要事件生成，不预设/不猜测：默认仅一片"起点"海，
// 出生=第一个 mark；用户每说一个重要事件+时间 → 新增一片以它命名的海。
const DEFAULT_STAGES = [
  { name: '起点', to: 120 }
]
const C0 = [207, 232, 220]   // #CFE8DC 浅薄荷
const C1 = [110, 156, 192]   // #6E9CC0 深蓝
function lerpColor (t) {
  const c = C0.map((a, i) => Math.round(a + (C1[i] - a) * t))
  return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('')
}

// 年份模式优先：节点带年份即可开海，不依赖生日；生日填好后岁数自动换算
function readRaw () {
  try {
    const s = wx.getStorageSync('lifeStages')
    if (Array.isArray(s) && s.length && s.every((x) => x && x.name)) return s
  } catch (e) {}
  return [{ name: '起点', toYear: null, flag: false }]
}
function buildStages (list) {
  const n = list.length
  const by = getBirthYear()
  let from = 0, fromYear = null
  return list.map((x, i) => {
    const yearMode = x.toYear !== undefined
    const toYear = yearMode ? (x.toYear == null ? null : Number(x.toYear)) : null
    const to = yearMode ? (by != null && toYear != null ? toYear - by : (by != null ? 120 : null)) : Number(x.to)
    const st = {
      key: x.name, name: x.name, from, to, fromYear, toYear,
      dispTo: Math.min(to == null ? 100 : to, 100), flag: !!x.flag,
      color: lerpColor(n === 1 ? 0 : i / (n - 1))
    }
    from = to == null ? null : to + 1
    fromYear = toYear == null ? null : toYear + 1
    return st
  })
}
function getStages () {
  let list = readRaw()
  const by = getBirthYear()
  // 旧岁数模式 + 已知生日 → 换成年份模式
  if (list.every((x) => x.toYear === undefined) && by != null) {
    list = list.map((x) => ({ name: x.name, toYear: isFinite(x.to) ? by + Number(x.to) : null, flag: !!x.flag }))
  }
  return buildStages(list)
}
function setStages (list) {
  const yearMode = list.some((x) => x.toYear !== undefined)
  let b
  if (yearMode) {
    b = list.map((x) => ({ name: String(x.name).slice(0, 8), toYear: x.toYear == null ? null : Number(x.toYear), flag: !!x.flag }))
    for (let i = 1; i < b.length; i++) if (b[i].toYear != null && b[i - 1].toYear != null && b[i].toYear <= b[i - 1].toYear) b[i].toYear = b[i - 1].toYear + 1
  } else {
    b = list.map((x) => ({ name: String(x.name).slice(0, 8), to: Number(x.to), flag: !!x.flag }))
    for (let i = 1; i < b.length; i++) if (b[i].to <= b[i - 1].to) b[i].to = b[i - 1].to + 1
  }
  try { wx.setStorageSync('lifeStages', b) } catch (e) {}
  return b
}
function resetStages () { try { wx.removeStorageSync('lifeStages') } catch (e) {} }

function stageOfAge (age) {
  const a = Number(age)
  const s = getStages()
  if (!isFinite(a)) return s[s.length - 1]
  return s.find((x) => a >= x.from && a <= x.to) || s[s.length - 1]
}
function stageOfYear (year, birthYear) {
  const s = getStages()
  const y = Number(year)
  if (birthYear) return stageOfAge(y - Number(birthYear))
  return s.find((x) => x.fromYear != null && y >= x.fromYear && (x.toYear == null || y <= x.toYear)) || s[s.length - 1]
}
function stageByKey (key) { return getStages().find((s) => s.key === key) || null }

// ---- 个人资料：生日 / 年龄 / 出生年 三选一 ----
function getProfile () { try { return wx.getStorageSync('lifeProfile') || null } catch (e) { return null } }
function setProfile (p) { try { wx.setStorageSync('lifeProfile', p) } catch (e) {} }
function getNickname () { const p = getProfile(); return (p && p.nickname) || '' }
function setNickname (n) { const p = getProfile() || {}; p.nickname = n; setProfile(p) }
function getBirthYear () {
  const p = getProfile()
  if (!p) return null
  if (p.birthday) return Number(String(p.birthday).slice(0, 4))
  if (p.year) return Number(p.year)
  if (p.age != null && p.age !== '') return new Date().getFullYear() - Number(p.age)
  return null
}

// ---- 口述年龄 ----
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

// ---- 口述阶段边界："童年到18岁" / "0到18算童年" ----
function parseStagesFromText (text) {
  const t = String(text || '')
  const list = getStages().map((x) => ({ name: x.name, to: x.to }))
  let hit = false
  for (let i = 0; i < list.length - 1; i++) {
    const name = list[i].name
    let m = t.match(new RegExp(name + '[^\\d]{0,6}(\\d{1,2})\\s*岁?'))
    if (!m) m = t.match(new RegExp('(\\d{1,2})\\s*岁?(?:之前|以前|以内|算|是)?[^\\d]{0,4}' + name))
    if (m) { list[i].to = Number(m[1]); hit = true }
  }
  return hit ? list : null
}

// ---- 人生节点 == 海的开端（同一份清单的两种视图）----
// 节点是转折点(点)，海是它开启的区间；加节点=多一片海，删节点=合并海。
// 小旗只标"用户自己加的节点"，默认阶段边界不插旗（避免少年13/晚年60都挂旗）
function getMilestones () {
  return getStages().filter((s) => s.flag && (s.fromYear != null || s.from > 0))
    .map((s) => ({ id: s.key, name: s.name, age: s.from != null && s.from > 0 ? s.from : null, year: s.fromYear }))
}
function setMilestones (m) { /* 节点即海边界，直接改海即可，此处保留空实现兼容 */ }
function addMilestone (name, age, year) {
  const by = getBirthYear()
  const nm = String(name).slice(0, 8)
  let y = year != null && isFinite(Number(year)) ? Number(year) : null
  if (y == null && age != null && isFinite(Number(age)) && by != null) y = by + Number(age)
  const stages = getStages()
  if (y != null) {
    // 年份模式：不需要生日也能开海
    let raw = readRaw()
    if (raw.every((x) => x.toYear === undefined)) raw = raw.map((x) => ({ name: x.name, toYear: by != null && isFinite(x.to) ? by + Number(x.to) : null, flag: !!x.flag }))
    const bs = buildStages(raw)
    let i = bs.findIndex((s) => y >= (s.fromYear == null ? -Infinity : s.fromYear) && (s.toYear == null || y <= s.toYear))
    if (i < 0) i = bs.length - 1
    const oldTo = raw[i].toYear
    raw[i].toYear = y - 1
    raw.splice(i + 1, 0, { name: nm, toYear: oldTo, flag: true })
    setStages(raw)
    return getMilestones()
  }
  // 仅岁数且无生日：旧岁数模式兜底
  const a = Number(age)
  if (!isFinite(a)) return getMilestones()
  const list = stages.map((s) => ({ name: s.name, to: s.to == null ? 120 : s.to, flag: s.flag }))
  const i = stages.findIndex((s) => s.from != null && a >= s.from && a <= s.to)
  if (i < 0) return getMilestones()
  const oldTo = list[i].to
  list[i].to = a - 1
  list.splice(i + 1, 0, { name: nm, to: oldTo, flag: true })
  setStages(list)
  return getMilestones()
}
function removeMilestone (id) {
  const stages = getStages()
  const i = stages.findIndex((s) => s.key === id)
  if (i <= 0) return getMilestones()
  const yearMode = stages[i].toYear !== undefined
  const list = stages.map((s) => yearMode ? ({ name: s.name, toYear: s.toYear, flag: s.flag }) : ({ name: s.name, to: s.to, flag: s.flag }))
  if (yearMode) list[i - 1].toYear = list[i].toYear
  else list[i - 1].to = list[i].to        // 合并进前一片海
  list.splice(i, 1)
  setStages(list)
  return getMilestones()
}
function parseMilestoneFromText (text) {
  const t = String(text || '')
  let m = t.match(/(\d{1,2})\s*岁(?:那年|的时候|时)?[，,]?\s*([^，,。；;]{2,12})/)
  if (m) return { age: Number(m[1]), name: m[2].trim() }
  m = t.match(/([^，,。；;]{2,12}?)(?:那年|的时候|时)?[，,]?\s*(?:我)?(\d{1,2})\s*岁/)
  if (m) return { age: Number(m[2]), name: m[1].trim() }
  return null
}

module.exports = {
  DEFAULT_STAGES, getStages, setStages, resetStages, buildStages,
  stageOfAge, stageOfYear, stageByKey,
  getProfile, setProfile, getNickname, setNickname, getBirthYear,
  parseAge, eventYear, parseStagesFromText,
  getMilestones, setMilestones, addMilestone, removeMilestone, parseMilestoneFromText
}