// docs/tools/xcheck_class.js — wxml class 引用 → wxss 是否定义（统一 JS 工具链）
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..', 'miniprogram')
const PAGES = ['pages/ocean/ocean', 'pages/iceberg/iceberg', 'pages/timeline/timeline', 'pages/recycle/recycle', 'pages/stages/stages', 'packageGuide/pages/guide/guide']
const COMPARE_RE = /(===|!==|==|!=)\s*$/

const appWxss = fs.readFileSync(path.join(ROOT, 'app.wxss'), 'utf8')
const appClasses = new Set([...appWxss.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]))

let total = 0
for (const name of PAGES) {
  const wxml = fs.readFileSync(path.join(ROOT, name + '.wxml'), 'utf8')
  const wxssP = path.join(ROOT, name + '.wxss')
  const wxss = fs.existsSync(wxssP) ? fs.readFileSync(wxssP, 'utf8') : ''
  const local = new Set([...wxss.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]))
  const defined = new Set([...appClasses, ...local])

  const used = new Set()
  const addLit = (expr, lit, start) => {
    if (COMPARE_RE.test(expr.slice(0, start))) return
    for (const t of lit.split(/\s+/)) if (t) used.add(t)
  }
  for (const m of wxml.matchAll(/\bclass\s*=\s*"([^"]*)"/g)) {
    const raw = m[1]
    for (const sm of raw.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
      const expr = sm[1]
      for (const lm of expr.matchAll(/'([^']*)'/g)) addLit(expr, lm[1], lm.index)
      for (const lm of expr.matchAll(/"([^"]*)"/g)) addLit(expr, lm[1], lm.index)
    }
    for (const t of raw.replace(/\{\{[\s\S]*?\}\}/g, ' ').split(/\s+/)) if (t) used.add(t)
  }
  for (const m of wxml.matchAll(/\bhover-class\s*=\s*"([^"]*)"/g)) {
    const v = m[1].trim()
    if (v && v !== 'none') used.add(v)
  }

  const missing = [...used].filter((c) => !defined.has(c) && !c.startsWith('$')).sort()
  console.log(`=== ${path.basename(name)} ===  用到 ${used.size} 个类，未定义 ${missing.length} 个`)
  if (missing.length) {
    total += missing.length
    for (const c of missing) console.log(`   ⚠️  .${c}`)
  }
}
console.log('\n' + '='.repeat(50))
console.log(`未定义类名总计：${total}`)
process.exit(total ? 1 : 0)