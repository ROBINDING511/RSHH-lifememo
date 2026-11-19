// utils/sea.js — 人生之海的纯布局逻辑（无 UI 副作用，便于单测与复用）
// 世界 = 3×3 屏的 2D 海；人生阶段放射分布；冰山/节点落在所属海域。
const life = require('./life')

const WORLD_SCREENS = 3
const SIZE_SCALE = { small: 0.8, medium: 1, large: 1.15 }
const BASE_W = { far: 25, mid: 41, near: 56 }
const BERG_DROP = 'bergdrop 0.95s cubic-bezier(0.22,1.2,0.36,1) both'

function windowSize () {
  const i = wx.getWindowInfo ? wx.getWindowInfo() : { windowWidth: 375, windowHeight: 667 }
  return { W: i.windowWidth, H: i.windowHeight }
}
function clamp (v, a, b) { return Math.max(a, Math.min(b, v)) }
function hash (s) { let h = 0; for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) % 1e9; return h }

// 构建世界：区域中心/半径 + 海色晕染 + 初始居中偏移
function buildWorld (stages) {
  const { W, H } = windowSize()
  const W2 = W * WORLD_SCREENS, H2 = H * WORLD_SCREENS
  const cx0 = W2 / 2, cy0 = H2 / 2
  const R = Math.min(W2, H2) * 0.30
  const n = stages.length
  const regions = stages.map((s, i) => {
    if (i === 0) return Object.assign({}, s, { cx: cx0, cy: cy0, r: R * 0.62 })
    const a = (-90 + (i - 1) * (360 / Math.max(1, n - 1))) * Math.PI / 180
    return Object.assign({}, s, { cx: cx0 + R * Math.cos(a), cy: cy0 + R * Math.sin(a), r: R * 0.55 })
  })
  const tint = regions.map((g) => `radial-gradient(circle at ${g.cx}px ${g.cy}px, ${g.color} 0%, ${g.color}00 ${g.r}px)`).join(',')
  return { regions, tint, worldWidth: W2, worldHeight: H2, movX: -(W2 - W) / 2, movY: -(H2 - H) / 2 }
}

// 视口居中到某海域（考虑缩放 scale，transform-origin 0 0）
function centerOn (g, world, scale) {
  const s = scale || 1
  const { W, H } = windowSize()
  return {
    movX: clamp(W / 2 - s * g.cx, -(s * world.worldWidth - W), 0),
    movY: clamp(H / 2 - s * g.cy, -(s * world.worldHeight - H), 0)
  }
}

// 触点落在哪片海（超出半径容差返回 null）
function regionAt (regions, x, y) {
  let best = null, bd = Infinity
  for (const g of regions) {
    const d = Math.hypot(x - g.cx, y - g.cy)
    if (d < bd) { bd = d; best = g }
  }
  return best && bd <= (best.r || 120) * 1.25 ? best : null
}

// 回忆归属海域：优先 zoneName，其次年份+生日，最后哈希兜底
function stageOfMemory (b, birthYear) {
  const byName = life.stageByKey(b.zoneName)
  if (byName) return byName
  const yr = parseInt(b.memoryTime, 10)
  if (isFinite(yr) && birthYear) return life.stageOfYear(yr, birthYear)
  const all = life.getStages()
  return all[hash(b._id) % all.length]
}

// 回忆 → 冰山（拖拽过的用保存偏移，否则极坐标散点）
function layoutBergs (icebergs, regions, birthYear, newId) {
  return (icebergs || []).map((b) => {
    const seed = hash(b._id)
    const st = stageOfMemory(b, birthYear)
    const g = regions.find((x) => x.key === st.key) || regions[0]
    const r = g.r || 120
    const layer = b.size === 'large' ? 'near' : b.size === 'small' ? 'far' : 'mid'
    const width = Math.round(BASE_W[layer] * (SIZE_SCALE[b.size] || 1))
    let dx, dy
    if (b.offX != null && b.offY != null) { dx = b.offX * r; dy = b.offY * r }
    else {
      const a = (seed % 360) * Math.PI / 180
      const rad = (((seed >> 3) % 100) / 100) * r * 0.8
      dx = rad * Math.cos(a); dy = rad * Math.sin(a)
    }
    // 冰山静止（去掉无意义循环摇曳）；仅新冰山落海有一次入场动画
    return {
      id: b._id, left: g.cx + dx - width / 2, top: g.cy + dy - width / 2, width,
      opacity: layer === 'far' ? 0.85 : 1,
      // 新冰山插红旗 5 分钟（长辈会回听），到期自动消失
      flag: !!(b.createdAt && Date.now() - b.createdAt < 5 * 60 * 1000),
      swayAnim: '', anim: b._id === newId ? BERG_DROP : '', stage: st.key
    }
  })
}

// 人生节点 → 海域内小旗
function layoutMilestones (regions) {
  return life.getMilestones().map((m) => {
    const st = life.stageOfAge(m.age)
    const g = regions.find((x) => x.key === st.key) || regions[0]
    const r = g.r || 120
    const span = Math.max(1, st.to - st.from + 1)
    const f = clamp((m.age - st.from) / span, 0, 1)
    return { id: m.id, name: m.name, age: m.age, left: g.cx + (f - 0.5) * r, top: g.cy - r * 0.6 }
  })
}

// 水平夜海·山=回忆：高度∝留言量；新=红 → 久=深蓝（矢量 CSS 形状，可缩放）
function lerp (a, b, t) { return Math.round(a + (b - a) * t) }
function mountainColor (t) {
  const R = [232, 64, 42], B = [27, 42, 107]
  return '#' + [0, 1, 2].map((i) => lerp(R[i], B[i], t).toString(16).padStart(2, '0')).join('')
}
function layoutMountains (icebergs, H) {
  const list = (icebergs || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))  // 左=年轻 右=久远
  const n = list.length
  return list.map((b, i) => {
    const len = (b.text || '').length
    const height = Math.round(140 + Math.min(320, len * 1.2))
    const t = n <= 1 ? 0 : i / (n - 1)
    return {
      id: b._id, left: 60 + i * 180, width: 150, height,
      bottom: Math.round(H * 0.30) + (i % 3) * 24,
      color: mountainColor(t),
      flag: !!(b.createdAt && Date.now() - b.createdAt < 5 * 60 * 1000)
    }
  })
}

module.exports = { buildWorld, centerOn, regionAt, stageOfMemory, layoutBergs, layoutMilestones, layoutMountains, windowSize, hash }