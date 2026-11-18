// docs/tools/a11y_check.js — wxss 对比度/字号/触控 三项 WCAG 2.2 AA 校验（统一 JS 工具链）
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..', 'miniprogram')

function walk (dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'miniprogram_npm') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.wxss')) out.push(p)
  }
  return out
}
function parseTokens (text) {
  const tok = {}
  for (const m of text.matchAll(/(--[\w-]+)\s*:\s*(#[0-9A-Fa-f]{3,8}|[\d.]+rpx)/g)) tok[m[1]] = m[2]
  return tok
}
function resolveLen (val, tok, depth = 0) {
  if (val == null || depth > 5) return null
  val = val.trim()
  if (val.startsWith('var(')) {
    const n = val.match(/var\(\s*(--[\w-]+)/)
    return n ? resolveLen(tok[n[1]], tok, depth + 1) : null
  }
  const m = val.match(/^([\d.]+)rpx$/)
  return m ? parseFloat(m[1]) : null
}
function resolve (val, tok, depth = 0) {
  if (val == null) return null
  val = val.trim()
  if (val.startsWith('var(')) {
    const n = val.match(/var\(\s*(--[\w-]+)/)
    return n && depth <= 5 ? resolve(tok[n[1]], tok, depth + 1) : null
  }
  const m = val.match(/^(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3})$/)
  if (!m) return null
  let h = m[1].slice(1)
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return '#' + h.toUpperCase()
}
function lum (hex) {
  const h = hex.slice(1)
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const [r, g, b] = [0, 2, 4].map((i) => f(parseInt(h.slice(i, i + 2), 16) / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function cr (a, b) {
  const la = lum(a), lb = lum(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
function parseRules (text) {
  text = text.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  for (const m of text.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const sel = (m[1].match(/\S+/g) || []).join(' ')
    const props = {}
    for (const pm of m[2].matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) props[pm[1]] = pm[2].trim()
    if (sel && Object.keys(props).length) out.push([sel, props])
  }
  return out
}

// 前景 → 实际底色 登记（跨选择器无法自动推断的）
const EXPLICIT_BG = {
  '.record-sub': ['.record-btn', '按住说话按钮主色底上的副文字'],
  '.record-main': ['.record-btn', '按住说话按钮主色底上的主文字'],
  '.live-text': ['.live-card', '实时转写纸白底上的正文'],
  '.live-state': ['.live-card', '实时转写面板状态文字'],
  '.live-timer': ['.live-card', '实时转写面板计时'],
  '.live-asr': ['.live-card', '实时转写面板连线提示'],
  '.live-hint': ['.live-card', '实时转写面板操作提示'],
  '.live-countdown-num': ['.live-card', '最后10秒倒计时大号数字'],
  '.live-countdown-label': ['.live-card', '最后10秒倒计时说明'],
  '.draft-text': ['.draft-bar', '草稿条黄底上的文字'],
  '.draft-btn': ['.draft-btn', '草稿按钮棕底白字'],
  '.vc-text': ['.voice-check', '回听条浅蓝底上的文字'],
  '.option-label': ['.preview-card', '白卡上的选项标签'],
  '.chip': ['.preview-card', '白卡上的未选 chip'],
  '.chip-on': ['.chip-on', '选中 chip 主色底白字'],
  '.hint-sub': ['.hint-card', '空态深色胶囊白字副标题'],
  '.hint-sub2': ['.hint-card', '空态深色胶囊白字说明'],
  '.hint-title': ['.hint-card', '空态深色胶囊白字标题'],
  '.g-desc': ['.page', '引导页描述'],
  '.g-skip': ['.page', '引导页跳过'],
  '.back-btn': ['.top-zone', '顶栏白底上的返回'],
  '.dock-pill': ['.dock-pill', '白药丸底上的文字'],
  '.year-badge': ['.year-badge', '年份徽章主色底白字'],
  '.rain-btn': ['.rain-btn', '恢复按钮主色底白字'],
  '.photo-add-text': ['.photo-add', '加照片浅蓝底上的文字'],
  '.item-meta': ['.item-card', '卡片上的元信息'],
  '.item-title': ['.item-card', '卡片上的标题'],
  '.cloud-meta': ['.cloud-card', '云卡片上的元信息'],
  '.cloud-title': ['.cloud-card', '云卡片上的标题'],
  '.melt': ['.card', '化成云危险文字'],
  '.voice-tip': ['.card', '原声提示'],
  '.berg-meta': ['.card', '冰山元信息'],
  '.tl-sub': ['.page', '时间轴副标题'],
  '.tl-title': ['.page', '时间轴标题'],
  '.sub': ['.page', '副标题'],
  '.title': ['.page', '标题'],
  '.preview-title': ['.preview-card', '预览卡标题'],
  '.preview-hint': ['.preview-card', '预览卡提示'],
  '.preview-text': ['.preview-text', '输入框浅底上的正文'],
  '.list-tip': ['.page', '列表底部提示'],
  '.text-secondary': ['.card', '全局次要文字'],
  '.btn-primary': ['.btn-primary', '主按钮白字'],
  '.btn-ghost': ['.btn-ghost', '幽灵按钮'],
  '.btn-danger-ghost': ['.btn-danger-ghost', '危险幽灵按钮']
}

function collectBg (sel, allRules, tok) {
  for (const [s, p] of allRules) {
    if (s !== sel) continue
    const raw = p.background || p['background-color']
    if (!raw) continue
    const c = resolve(raw, tok)
    if (c) return c
    if (raw.includes('rgba(255,255,255')) return '#FFFFFF'
    if (raw.startsWith('linear-gradient')) {
      const gm = raw.match(/#[0-9A-Fa-f]{6}/)
      if (gm) return '#' + gm[0].slice(1).toUpperCase()
    }
  }
  return null
}

const files = walk(ROOT)
const tok = parseTokens(fs.readFileSync(path.join(ROOT, 'app.wxss'), 'utf8'))
const allRules = []
for (const fp of files) for (const [sel, props] of parseRules(fs.readFileSync(fp, 'utf8'))) allRules.push([path.relative(ROOT, fp), sel, props])
const merged = {}
for (const [, sel, props] of allRules) Object.assign(merged[sel] = merged[sel] || {}, props)

const bgcache = {}
function bgOf (key) {
  if (key in bgcache) return bgcache[key]
  let c = null
  if (key.startsWith('#')) c = key
  else if (key === '.page') c = resolve('var(--c-bg)', tok)
  else if (key === '.record-mask') c = '#0F3A5C'
  else if (key === '.hint-card') c = '#446372'
  else if (key === '.live-card') c = '#FDFCF9'
  else c = collectBg(key, allRules.map(([, s, p]) => [s, p]), tok)
  bgcache[key] = c
  return c
}

const rows = [], fails = [], smallFs = [], smallTap = []
for (const fp of files) {
  const rel = path.relative(ROOT, fp)
  const txt = fs.readFileSync(fp, 'utf8')
  for (const m of txt.matchAll(/font-size:\s*(\d+)rpx/g)) {
    const px = parseInt(m[1], 10)
    if (px < 30) smallFs.push([rel, txt.slice(0, m.index).split('\n').length, px])
  }
}
const TAPPABLE = ['btn', 'chip', 'pill', 'del', 'skip', 'row', 'item', 'card', 'link']
for (const [rel, sel, props] of allRules) {
  if (!TAPPABLE.some((h) => sel.toLowerCase().includes(h))) continue
  for (const k of ['min-height', 'height']) {
    const v = props[k]
    if (v) {
      const m = v.trim().match(/^(\d+)rpx$/)
      if (m && parseInt(m[1], 10) < 88) smallTap.push([rel, sel, k, parseInt(m[1], 10)])
      break
    }
  }
}
for (const [fg, [bgkey, note]] of Object.entries(EXPLICIT_BG)) {
  const props = merged[fg]
  if (!props || !props.color) continue
  const fgc = resolve(props.color, tok)
  if (!fgc) continue
  const bgc = bgOf(bgkey)
  if (!bgc) continue
  const r = cr(fgc, bgc)
  let fs = resolveLen(props['font-size'] || '', tok)
  if (fs == null) fs = 36
  const bold = ['500', '600', '700', 'bold'].some((w) => (props['font-weight'] || '').includes(w))
  const need = (bold && fs >= 38) || fs >= 48 ? 3.0 : 4.5
  const ok = r >= need
  rows.push([fg, fgc, bgc, r, need, ok, note, fs, bold])
  if (!ok) fails.push([fg, fgc, bgc, r, need, note, fs, bold])
}

console.log('='.repeat(108))
console.log('对比度核算（WCAG 2.2 AA）— 大文字阈值：常规≥48rpx / 加粗≥38rpx 时放宽到 3:1')
console.log('='.repeat(108))
for (const [fg, fgc, bgc, r, need, ok, note, fs, bold] of rows.sort((a, b) => a[3] - b[3])) {
  console.log(`${fg.padEnd(20)}${fgc.padEnd(10)}${bgc.padEnd(10)}${r.toFixed(2).padStart(7)}:1  ${need.toFixed(1).padStart(5)}:1  ${(fs + 'rpx' + (bold ? 'B' : '')).padStart(7)} ${ok ? 'PASS' : 'FAIL'}  ${note}`)
}
console.log('\n' + '='.repeat(96))
console.log(`字号下限 30rpx 违规：${smallFs.length} 处`)
for (const [rel, line, px] of smallFs) console.log(`  ${rel}:${line}  ${px}rpx`)
console.log('\n' + '='.repeat(96))
console.log(`触控尺寸 <88rpx 可疑：${smallTap.length} 处`)
for (const [rel, sel, k, px] of smallTap) console.log(`  ${rel}  ${sel}  ${k}=${px}rpx`)
console.log('\n' + '='.repeat(96))
console.log(`总计：对比度 ${rows.length} 组（FAIL ${fails.length}）｜字号违规 ${smallFs.length}｜触控可疑 ${smallTap.length}`)
console.log('='.repeat(96))
process.exit(fails.length || smallFs.length ? 1 : 0)