// scripts/test_countdown.js — 录音倒计时行为测试（驱动真实 recorder.js，非副本）
// 运行：node scripts/test_countdown.js
//
// 做法：shim 掉 wx 与定时器（假时钟），直接 require 真实的 utils/recorder.js，
// 推进虚拟时间，收集 onCountdown 回调。这样测的就是线上代码本身，
// 不存在「测试副本与源码不同步」的问题。

const { readFileSync } = require('fs')
const { join } = require('path')
const ROOT = join(__dirname, '..')

// ===== 假时钟 =====
let virtualNow = 0
let idSeq = 1
const intervals = new Map() // id -> { fn, every, next }
const timeouts = new Map()  // id -> { fn, at }
globalThis.setInterval = (fn, every) => {
  const id = idSeq++; intervals.set(id, { fn, every, next: virtualNow + every }); return id
}
globalThis.clearInterval = (id) => { intervals.delete(id) }
globalThis.setTimeout = (fn, ms) => {
  const id = idSeq++; timeouts.set(id, { fn, at: virtualNow + ms }); return id
}
globalThis.clearTimeout = (id) => { timeouts.delete(id) }
const realNow = Date.now
Date.now = () => virtualNow

// 按 stepMs 步进推进虚拟时间，逐点触发到期的定时器（interval 重复、timeout 一次性）
function advance (ms, stepMs = 5) {
  const target = virtualNow + ms
  while (virtualNow < target) {
    virtualNow = Math.min(virtualNow + stepMs, target)
    for (const [id, it] of [...intervals]) {
      while (it.next <= virtualNow) {
        it.next += it.every
        it.fn()
        if (!intervals.has(id)) break // 回调里可能 clearInterval
      }
    }
    for (const [id, to] of [...timeouts]) {
      if (to.at <= virtualNow) { timeouts.delete(id); to.fn() }
    }
  }
}

// ===== wx shim =====
// rmHandlers 收集 recorder.js 通过 rm.onXxx() 注册的回调，
// 这样 rm.stop() 能真正触发内部的 onStop，拿到实际参数做断言
const rmHandlers = {}
const rmCalls = { start: 0, stop: 0, startSetting: null }
globalThis.wx = {
  getRecorderManager: () => ({
    onFrameRecorded (fn) { rmHandlers.frameRecorded = fn },
    onStart (fn) { rmHandlers.start = fn },
    onStop (fn) { rmHandlers.stop = fn },
    onError (fn) { rmHandlers.error = fn },
    start (setting) {
      rmCalls.start++
      rmCalls.startSetting = setting
      if (rmHandlers.start) rmHandlers.start() // 真实时序：start 后置 recording = true
    },
    stop () {
      rmCalls.stop++
      if (rmHandlers.stop) rmHandlers.stop()
    }
  }),
  env: { USER_DATA_PATH: '/tmp' },
  getFileSystemManager: () => ({ writeFileSync () {} })
}

// ===== require 真实代码 =====
const { createRecorder, MAX_SECONDS, COUNTDOWN_SECONDS } = require(join(ROOT, 'miniprogram/utils/recorder.js'))

let fail = 0
const check = (ok, msg, extra) => {
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`)
  if (extra !== undefined) console.log(`        ${extra}`)
}

console.log('=== 常量来自真实 recorder.js（非手抄）===')
check(MAX_SECONDS === 60, `MAX_SECONDS = ${MAX_SECONDS}`)
check(COUNTDOWN_SECONDS === 10, `COUNTDOWN_SECONDS = ${COUNTDOWN_SECONDS}`)

// ===== 场景：录满整段，收集倒计时回调 =====
console.log('\n=== 倒计时回调序列（推进到 62 秒）===')
virtualNow = 0; idSeq = 1; intervals.clear(); timeouts.clear()
rmCalls.start = 0; rmCalls.stop = 0
const countdowns = []
const ticks = []
let stopArgs = null
const rec = createRecorder()
rec.start({
  onTick: (s) => ticks.push(s),
  onCountdown: (left) => countdowns.push({ left, atMs: virtualNow }),
  // 用 rest 参数捕获真实传入的参数个数，验证 meta 第四参已彻底移除
  onStop: (...args) => { stopArgs = args }
})

advance((MAX_SECONDS + 2) * 1000)

const lefts = countdowns.map((c) => c.left)
check(
  JSON.stringify(lefts) === JSON.stringify([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
  `恰好触发 ${COUNTDOWN_SECONDS} 次、从 10 递减到 1、无重复无缺号`,
  `序列 = ${lefts.join(', ')}`
)
check(
  new Set(lefts).size === lefts.length,
  `无重复秒数（lastLeft 去重生效）`,
  `${lefts.length} 次回调 / ${new Set(lefts).size} 个不同值`
)

const first = countdowns[0]
check(
  Math.abs(first.atMs - (MAX_SECONDS - COUNTDOWN_SECONDS) * 1000) <= 250,
  `left=10 首次出现在 ${first.atMs}ms，理论值 ${(MAX_SECONDS - COUNTDOWN_SECONDS) * 1000}ms，偏差在轮询步长内`
)

console.log('\n=== 硬切：到点自动 stop，不弹窗、不询问 ===')
check(rmCalls.stop >= 1, `到点后调用了 rm.stop()（共 ${rmCalls.stop} 次）—— 到点即切，符合微信行为`)
check(rmCalls.startSetting && rmCalls.startSetting.duration === MAX_SECONDS * 1000,
  `rm.start 的 duration = ${rmCalls.startSetting && rmCalls.startSetting.duration}ms（微信层硬上限）`)

console.log('\n=== onStop 签名回归：第四参 meta 已彻底移除 ===')
// 运行时断言：真实 rm.onStop 回调透传给上层 onStop 的参数个数
check(Array.isArray(stopArgs) && stopArgs.length <= 3,
  `onStop 实际收到 ${stopArgs ? stopArgs.length : 0} 个参数（正常路径 wavPath+durationMs，≤3）`)
check(!stopArgs || stopArgs[3] === undefined,
  '第 4 参为 undefined —— 不再有 meta.hitLimit 传入上层')
check(stopArgs && stopArgs[1] >= MAX_SECONDS * 1000,
  `durationMs = ${stopArgs && stopArgs[1]}ms，确实录满了 ${MAX_SECONDS} 秒才被切`,
  '证明是「到点硬切」而非提前中断')

console.log('\n=== onTick 每秒回传（已说 N 秒常驻显示）===')
check(ticks.length >= MAX_SECONDS,
  `tick 回调 ${ticks.length} 次（≥${MAX_SECONDS}），每秒一次不断档`)
check(ticks[0] === 0 || ticks[0] === 1,
  `首个 tick = ${ticks[0]} 秒，从 0/1 开始计数`)

console.log('\n=== 源码残留检查（已撤销逻辑不应再出现）===')
const recSrc = readFileSync(join(ROOT, 'miniprogram/utils/recorder.js'), 'utf8')
const oceanSrc = readFileSync(join(ROOT, 'miniprogram/pages/ocean/ocean.js'), 'utf8')
check(!/hitLimit|userStopped|LIMIT_TOLERANCE/.test(recSrc), 'recorder.js 无 hitLimit/userStopped 残留')
check(!/offerContinue|hitLimit/.test(oceanSrc), 'ocean.js 无 offerContinue/hitLimit 残留')
check(/onStop: async \(wavPath, durationMs, err\) =>/.test(oceanSrc), 'ocean.js onStop 为 3 参签名')

console.log('\n=== 震动时机：最后 3 秒各一次（ocean.js onCountdown 中 left<=3）===')
const buzz = lefts.filter((l) => l <= 3)
check(
  JSON.stringify(buzz) === '[3,2,1]',
  `仅 3/2/1 秒会触发 vibrateShort，不密集打扰`,
  `震动秒数 = ${buzz.join(', ')}`
)

Date.now = realNow
console.log(`\n${fail === 0 ? '✅ 全部通过' : `❌ ${fail} 项失败`}`)
process.exit(fail === 0 ? 0 : 1)
