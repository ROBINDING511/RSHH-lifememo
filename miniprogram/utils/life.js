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

function buildStages (list) {
  const n = list.length
  let from = 0
  return list.map((x, i) => {
    const to = Number(x.to)
    const st = { key: x.name, name: x.name, from, to, dispTo: Math.min(to, 100), flag: !!x.flag, color: lerpColor(n === 1 ? 0 : i / (n - 1)) }
    from = to + 1
    return st
  })
}
function getStages () {
  let list = null
  try {
    const s = wx.getStorageSync('lifeStages')
    if (Array.isArray(s) && s.length >= 2 && s.every((x) => x && x.name && isFinite(x.to))) list = s
  } catch (e) {}
  if (!list) list = DEFAULT_STAGES.map((x) => ({ ...x }))
  return buildStages(list)
}
function setStages (list) {
  // 保证 to 单调递增
  const b = list.map((x) => ({ name: String(x.name).slice(0, 8), to: Number(x.to), flag: !!x.flag }))
  for (let i = 1; i < b.length; i++) if (b[i].to <= b[i - 1].to) b[i].to = b[i - 1].to + 1
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
  if (!birthYear) return s[s.length - 1]
  return stageOfAge(Number(year) - Number(birthYear))
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
  return getStages().filter((s) => s.flag && s.from > 0).map((s) => ({ id: s.key, name: s.name, age: s.from }))
}
function setMilestones (m) { /* 节点即海边界，直接改海即可，此处保留空实现兼容 */ }
function addMilestone (name, age) {
  const a = Number(age)
  const stages = getStages()
  const list = stages.map((s) => ({ name: s.name, to: s.to, flag: s.flag }))
  const i = stages.findIndex((s) => a >= s.from && a <= s.to)
  if (i < 0) return getMilestones()
  const oldTo = list[i].to
  list[i].to = a - 1                      // 左半保留原名
  list.splice(i + 1, 0, { name: String(name).slice(0, 8), to: oldTo, flag: true })  // 新节点开启新海+插旗
  setStages(list)
  return getMilestones()
}
function removeMilestone (id) {
  const stages = getStages()
  const i = stages.findIndex((s) => s.key === id)
  if (i <= 0) return getMilestones()
  const list = stages.map((s) => ({ name: s.name, to: s.to, flag: s.flag }))
  list[i - 1].to = list[i].to             // 合并进前一片海
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