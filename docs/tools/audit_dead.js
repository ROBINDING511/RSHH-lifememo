// 遗留审计：未用方法/数据字段/CSS类/资源
const fs = require('fs'), path = require('path')
const ROOT = path.join(__dirname, '../../miniprogram')
const PAGES = ['pages/ocean/ocean', 'pages/stages/stages', 'pages/iceberg/iceberg', 'pages/timeline/timeline', 'pages/recycle/recycle', 'packageGuide/pages/guide/guide']
for (const name of PAGES) {
  const js = fs.readFileSync(path.join(ROOT, name + '.js'), 'utf8')
  const wxml = fs.existsSync(path.join(ROOT, name + '.wxml')) ? fs.readFileSync(path.join(ROOT, name + '.wxml'), 'utf8') : ''
  const wxss = fs.existsSync(path.join(ROOT, name + '.wxss')) ? fs.readFileSync(path.join(ROOT, name + '.wxss'), 'utf8') : ''
  // methods
  const methods = [...js.matchAll(/^  (?:async )?([A-Za-z_$][\w$]*) \(/gm)].map(m => m[1])
  const deadM = methods.filter(m => {
    const inWxml = new RegExp('(bind|catch)[a-z]*="' + m + '"|hover-class[^>]*|\\b' + m + '\\b').test(wxml) && new RegExp('="' + m + '"').test(wxml)
    const calls = (js.match(new RegExp('\\b' + m + '\\s*\\(', 'g')) || []).length
    return !inWxml && calls <= 1
  })
  // data keys
  const dataBlock = js.slice(js.indexOf('data: {'), js.indexOf('onLoad'))
  const keys = [...dataBlock.matchAll(/^\s{4}([A-Za-z_$][\w$]*):/gm)].map(m => m[1])
  const deadD = keys.filter(k => !wxml.includes(k) && (js.match(new RegExp('\\b' + k + '\\b', 'g')) || []).length <= 1)
  // css classes not in wxml
  const cls = [...wxss.matchAll(/\.([a-z][\w-]*)\s*[{,:.]/g)].map(m => m[1])
  const deadC = [...new Set(cls)].filter(c => !wxml.includes(c) && !js.includes("'" + c + "'") && !js.includes('`' + c))
  console.log('=== ' + name)
  console.log(' deadMethods:', deadM.join(', ') || '-')
  console.log(' deadData:', deadD.join(', ') || '-')
  console.log(' deadCss:', deadC.join(', ') || '-')
}
// assets referenced?
const all = PAGES.map(n => fs.readFileSync(path.join(ROOT, n + '.wxml'), 'utf8')).join('\n') + fs.readFileSync(path.join(ROOT, 'app.wxss'), 'utf8')
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])
for (const f of walk(path.join(ROOT, 'images')).concat(walk(path.join(ROOT, 'assets')))) {
  const rel = '/' + path.relative(ROOT, f)
  if (!all.includes(rel) && !all.includes(path.basename(f))) console.log(' unusedAsset:', rel)
}
