// docs/tools/xcheck_wxml_js.js — WXML ↔ JS 交叉校验（统一 JS 工具链）
// 1. wxml 里 bind/catch 事件处理函数必须在对应 js 定义
// 2. wxml 标签闭合检查
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..', 'miniprogram')
const PAGES = [
  'pages/ocean/ocean',
  'pages/iceberg/iceberg',
  'pages/timeline/timeline',
  'pages/recycle/recycle',
  'pages/stages/stages',
  'packageGuide/pages/guide/guide'
]
const EVENT_RE = /\b(?:bind|catch)(?::)?([A-Za-z]+)\s*=\s*"([A-Za-z_$][\w$]*)"/gi
const SELF_CLOSING = new Set(['image', 'input', 'icon', 'import', 'include', 'wxs', 'slot', 'switch', 'progress', 'checkbox', 'radio', 'audio', 'video', 'camera', 'live-player', 'live-pusher', 'official-account', 'open-data', 'ad', 'functional-page-navigator', 'navigator', 'block'])

function checkTags (wxml) {
  const body = wxml.replace(/<!--[\s\S]*?-->/g, '').replace(/<wxs[^>]*?\/>/g, '')
  const stack = []
  const errs = []
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g
  let m
  while ((m = re.exec(body))) {
    const closing = m[1], tag = m[2].toLowerCase(), selfclose = m[4]
    if (selfclose || (SELF_CLOSING.has(tag) && !closing)) continue
    if (closing) {
      if (!stack.length) errs.push(`多余的闭合 </${tag}>`)
      else if (stack[stack.length - 1] !== tag) {
        errs.push(`标签不匹配：期望 </${stack[stack.length - 1]}>，实际 </${tag}>`)
        if (stack.includes(tag)) while (stack.length && stack.pop() !== tag) {}
      } else stack.pop()
    } else stack.push(tag)
  }
  for (const t of stack) errs.push(`未闭合 <${t}>`)
  return errs
}

let totalBad = 0
for (const name of PAGES) {
  const wxmlP = path.join(ROOT, name + '.wxml')
  const jsP = path.join(ROOT, name + '.js')
  if (!fs.existsSync(wxmlP)) continue
  const wxml = fs.readFileSync(wxmlP, 'utf8')
  const js = fs.existsSync(jsP) ? fs.readFileSync(jsP, 'utf8') : ''

  const defined = new Set()
  for (const re of [/^\s{2,}([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm, /^\s{2,}([A-Za-z_$][\w$]*)\s*:\s*(?:function|\()/gm, /^\s{2,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm]) {
    let m
    while ((m = re.exec(js))) defined.add(m[1])
  }

  const referenced = {}
  let m
  EVENT_RE.lastIndex = 0
  while ((m = EVENT_RE.exec(wxml))) {
    const fn = m[2]
    ;(referenced[fn] = referenced[fn] || []).push('bind' + m[1].toLowerCase())
  }
  const missing = Object.keys(referenced).filter((fn) => !defined.has(fn))
  const tagErrs = checkTags(wxml)
  const status = !missing.length && !tagErrs.length ? 'OK' : 'PROBLEM'
  console.log(`\n=== ${path.basename(name)} [${status}] ===`)
  console.log(`  wxml 引用事件处理函数 ${Object.keys(referenced).length} 个，js 定义 ${defined.size} 个`)
  if (missing.length) {
    totalBad += missing.length
    for (const fn of missing) console.log(`  ❌ 缺失处理函数: ${fn}()  <- ${[...new Set(referenced[fn])].sort().join(',')}`)
  } else console.log(`  ✅ 全部 ${Object.keys(referenced).length} 个事件处理函数均已定义`)
  if (tagErrs.length) {
    totalBad += tagErrs.length
    for (const e of tagErrs) console.log(`  ❌ 标签: ${e}`)
  } else console.log('  ✅ 标签闭合正常')
}
console.log('\n' + '='.repeat(60))
console.log(`总计问题：${totalBad}`)
process.exit(totalBad ? 1 : 0)