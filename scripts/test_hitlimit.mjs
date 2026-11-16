// scripts/test_hitlimit.mjs — 验证「说满上限」判定逻辑（不碰真机，纯状态机推演）
// 复刻 utils/recorder.js 的 onStop 判定式，覆盖 4 种停止场景 + draft 挤出行为。
// 运行：node scripts/test_hitlimit.mjs
//
// ⚠ 同步提醒：下方 judge() 是 recorder.js 判定式的手抄副本。
//   改动 recorder.js 的 hitLimit 判定或 draft.js 的挤出策略时，必须同步改这里，
//   否则测试通过也证明不了真实代码正确（本测试只保证逻辑自洽，不保证与源码一致）。
//   校验一致性的办法：grep -A2 "const hitLimit" miniprogram/utils/recorder.js

const MAX_SECONDS = 60
const LIMIT_TOLERANCE_MS = 300

// === 与 recorder.js 逐字一致的判定式（改代码时两处必须同步）===
function judge ({ limitHit, userStopped, durationMs }) {
  return limitHit ||
    (!userStopped && durationMs >= MAX_SECONDS * 1000 - LIMIT_TOLERANCE_MS)
}

const cases = [
  // [场景, 输入, 期望 hitLimit, 说明]
  ['微信 duration 到点自动停', { limitHit: false, userStopped: false, durationMs: 60000 }, true,
    '微信在整 60s 自动停，早于 +300ms 兜底 timer，标记来不及打 → 靠时长兜底判定'],
  ['本地兜底 timer 停', { limitHit: true, userStopped: false, durationMs: 60300 }, true,
    '兜底 timer 路径，limitHit 已打标'],
  ['妈妈 59.8s 手点"说完了"', { limitHit: false, userStopped: true, durationMs: 59800 }, false,
    '关键回归：时长落在容差内但用户主动停，不能误判成说满'],
  ['妈妈 30s 手点"说完了"', { limitHit: false, userStopped: true, durationMs: 30000 }, false,
    '正常说完'],
  ['妈妈 59.95s 手点(极端贴边)', { limitHit: false, userStopped: true, durationMs: 59950 }, false,
    'userStopped 优先级高于时长兜底'],
  ['录音中断 onError', { limitHit: false, userStopped: false, durationMs: 20000 }, false,
    'onError 走独立分支（hitLimit 硬编码 false），此处仅验证时长不误判'],
  ['切后台 saveDraftAndStop', { limitHit: false, userStopped: true, durationMs: 60100 }, false,
    '切后台发生在说满瞬间也算用户触发，不该弹"接着说"'],
]

let fail = 0
console.log('=== hitLimit 判定（7 场景）===')
for (const [name, input, expect, why] of cases) {
  const got = judge(input)
  const ok = got === expect
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  console.log(`        输入 ${JSON.stringify(input)} → hitLimit=${got}（期望 ${expect}）`)
  if (!ok) console.log(`        ⚠ ${why}`)
}

// === draft.js 挤出与 remove/forgetPath 语义 ===
console.log('\n=== draft 挤出语义（MAX=20）===')
const MAX = 20
let store = []
let unlinked = []
const save = (d) => {
  const item = Object.assign({ at: Date.now() + store.length }, d)
  store.unshift(item)
  if (store.length > MAX) {
    const dropped = store.splice(MAX)
    dropped.forEach((x) => unlinked.push(x.wavPath))
  }
  return item
}
for (let i = 1; i <= 23; i++) save({ wavPath: `/tmp/seg${i}.wav`, text: `第${i}段` })
console.log(`${store.length === MAX ? 'PASS' : 'FAIL'}  连说 23 段后索引保持 ${store.length} 条（上限 ${MAX}）`)
if (store.length !== MAX) fail++
// 最新的 20 段应保留，最旧 3 段被挤出
const kept = store.map((s) => s.text)
const okKept = kept.includes('第23段') && kept.includes('第4段') && !kept.includes('第3段')
console.log(`${okKept ? 'PASS' : 'FAIL'}  保留最新 20 段（第4~23段），挤出最旧 3 段`)
if (!okKept) fail++
const okUnlink = unlinked.length === 3 && unlinked.includes('/tmp/seg1.wav')
console.log(`${okUnlink ? 'PASS' : 'FAIL'}  被挤出的 3 段音频已回收（无孤儿文件）：${unlinked.join(', ')}`)
if (!okUnlink) fail++

// remove 不删文件、forgetPath 删文件
let removedFile = null
const removeOnly = (at) => { store = store.filter((d) => d.at !== at) }
const forgetPath = (wavPath) => {
  if (!wavPath) return
  store = store.filter((d) => d.wavPath !== wavPath)
  removedFile = wavPath // 索引清掉 + 文件回收
}
const target = store[0]
removeOnly(target.at)
console.log(`${removedFile === null ? 'PASS' : 'FAIL'}  remove() 不删音频（发布卡还要用 wavPath 放原声）`)
if (removedFile !== null) fail++
forgetPath(store[0].wavPath)
console.log(`${removedFile !== null ? 'PASS' : 'FAIL'}  forgetPath() 回收本地音频（发布成功后已上云，本地冗余）`)
if (removedFile === null) fail++

console.log(`\n${fail === 0 ? '✅ 全部通过' : `❌ ${fail} 项失败`}`)
process.exit(fail === 0 ? 0 : 1)
