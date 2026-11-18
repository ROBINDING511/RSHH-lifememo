// utils/recorder.js — 录音器：一路 PCM 帧双路复用
//   1) 帧实时喂给 ASR 流式识别（边说边出字）
//   2) 帧本地攒起来，结束时拼 WAV 存档（妈妈的原声）
//
// 适老化改造：
//   - onTick：每秒回传"已说几秒"，界面常驻显示，不让妈妈猜还剩多久
//   - MAX_SECONDS 到点自动停，自动保存（原来会丢）
//   - 帧缓存常驻，任何异常路径都能先落地成本地 WAV
//   - onCountdown：最后 COUNTDOWN_SECONDS 秒每秒回传"还剩几秒"，
//     界面变红倒计时，和微信语音一致 —— 到点硬切前给足预警，不会话说一半被打断得莫名其妙
const MAX_SECONDS = 60 // 单段上限，与微信语音一致
const COUNTDOWN_SECONDS = 10 // 提前 10 秒开始倒计时提醒，与微信语音一致

function createRecorder () {
  const rm = wx.getRecorderManager()
  const state = {
    recording: false,
    startAt: 0,
    chunks: [], // PCM 帧缓存
    onFrame: null, // (arrayBuffer, elapsedMs) => void
    onTick: null, // (elapsedSeconds) => void 每秒回调
    onCountdown: null, // (leftSeconds) => void 剩余<=COUNTDOWN_SECONDS 时每秒回调
    onStop: null, // (wavPath, durationMs, err) => void
    timer: null,
    tickTimer: null,
    cdTimer: null,
    lastLeft: -1 // 去重：同一个秒数只回调一次，避免重复 setData
  }

  rm.onFrameRecorded((res) => {
    if (!state.recording) return
    state.chunks.push(res.frameBuffer)
    const elapsed = Date.now() - state.startAt
    if (state.onFrame) state.onFrame(res.frameBuffer, elapsed)
  })

  rm.onStart(() => {
    state.recording = true
    // 快速点按：touchend 早于 onStart 到达时已请求停止 → 立即补停，绝不留"按一下一直录"
    if (state.stopRequested) { state.stopRequested = false; rm.stop() }
  })

  rm.onStop(() => {
    state.recording = false
    clearInterval(state.cdTimer)
    clearInterval(state.tickTimer)
    if (state.timer) clearTimeout(state.timer)
    const durationMs = Date.now() - state.startAt
    const wavPath = buildWavFile(state.chunks)
    state.chunks = []
    if (state.onStop) state.onStop(wavPath, durationMs)
  })

  rm.onError((e) => {
    state.recording = false
    clearInterval(state.cdTimer)
    clearInterval(state.tickTimer)
    if (state.timer) clearTimeout(state.timer)
    // 出错也先把已录到的帧落地，绝不白说一场
    const durationMs = Date.now() - state.startAt
    const wavPath = buildWavFile(state.chunks)
    state.chunks = []
    if (state.onStop) state.onStop(wavPath, durationMs, e)
  })

  return {
    // 返回 Promise，授权失败会 reject
    async start (hooks) {
      state.onFrame = hooks.onFrame || null
      state.onTick = hooks.onTick || null
      state.onCountdown = hooks.onCountdown || null
      state.onStop = hooks.onStop || null
      state.chunks = []
      state.startAt = Date.now()
      state.lastLeft = -1
      state.stopRequested = false

      const setting = {
        duration: MAX_SECONDS * 1000, // 到点自动停，像微信语音
        format: 'PCM',
        sampleRate: 16000,
        numberOfChannels: 1,
        frameSize: 4 // ~128ms 一帧，实时性够
      }
      rm.start(setting)

      // 每秒回传已说时长（常驻显示）
      state.tickTimer = setInterval(() => {
        if (!state.recording || !state.onTick) return
        state.onTick(Math.floor((Date.now() - state.startAt) / 1000))
      }, 1000)

      // 最后 10 秒倒计时提醒。
      // 用 250ms 轮询 + lastLeft 去重：既保证秒数跳变及时（不会慢半拍），
      // 又不会像原来 500ms 无去重那样对同一秒重复回调、重复 setData。
      state.cdTimer = setInterval(() => {
        const left = Math.ceil((MAX_SECONDS * 1000 - (Date.now() - state.startAt)) / 1000)
        if (left > COUNTDOWN_SECONDS || left <= 0) return
        if (left === state.lastLeft) return
        state.lastLeft = left
        if (state.onCountdown) state.onCountdown(left)
      }, 250)

      // 超时兜底：到点自动 stop（走 onStop → 自动进入发布卡，内容不丢）
      // wx 自身 duration 在整 60s 就会停，早于这里的 +300ms，故本 timer 只是保险
      state.timer = setTimeout(() => this.stop(), MAX_SECONDS * 1000 + 300)
    },

    stop () {
      state.stopRequested = true
      if (state.timer) clearTimeout(state.timer)
      clearInterval(state.cdTimer)
      clearInterval(state.tickTimer)
      rm.stop()
    },

    get recording () { return state.recording }
  }
}

// PCM 帧拼 WAV（44 字节头 + 数据），存到用户目录
function buildWavFile (chunks) {
  if (!chunks || !chunks.length) return null
  const sampleRate = 16000
  let dataLen = 0
  chunks.forEach((c) => { dataLen += c.byteLength })
  const buffer = new ArrayBuffer(44 + dataLen)
  const view = new DataView(buffer)
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataLen, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint16(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // 单声道
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits
  writeStr(36, 'data')
  view.setUint32(40, dataLen, true)
  // 批量拷贝（旧实现逐字节 setUint8，60s 音频要 200 万次调用，真机会卡住）
  const out = new Uint8Array(buffer)
  let off = 44
  chunks.forEach((c) => {
    const src = new Uint8Array(c)
    out.set(src, off)
    off += src.length
  })
  const path = `${wx.env.USER_DATA_PATH}/voice_${Date.now()}.wav`
  try {
    const fsm = wx.getFileSystemManager()
    fsm.writeFileSync(path, buffer, 'binary')
    return path
  } catch (e) {
    console.warn('WAV 存档失败', e)
    return null
  }
}

// 续录拼接：把多段 WAV 的 PCM 顺次拼成一段新 WAV（继续说→接在原录音后）
function concatWavs (paths) {
  const fsm = wx.getFileSystemManager()
  const pcmParts = []
  for (const p of paths) {
    if (!p) continue
    try {
      const buf = fsm.readFileSync(p)
      const u8 = new Uint8Array(buf)
      // 定位 data chunk；找不到则跳过 44 字节标准头
      let off = 12, pcm = null
      if (u8.length > 44 && String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) === 'RIFF') {
        while (off + 8 <= u8.length) {
          const id = String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3])
          const size = u8[off + 4] | (u8[off + 5] << 8) | (u8[off + 6] << 16) | (u8[off + 7] << 24)
          if (id === 'data') { pcm = u8.slice(off + 8, off + 8 + size); break }
          off += 8 + size + (size % 2)
        }
      }
      if (!pcm) pcm = u8.slice(44)
      if (pcm && pcm.length) pcmParts.push(pcm)
    } catch (e) { /* 读不到的段跳过 */ }
  }
  if (!pcmParts.length) return null
  let total = 0
  pcmParts.forEach((p) => { total += p.length })
  const all = new Uint8Array(total)
  let o = 0
  pcmParts.forEach((p) => { all.set(p, o); o += p.length })
  return buildWavFile([all.buffer])
}

module.exports = { createRecorder, MAX_SECONDS, COUNTDOWN_SECONDS, concatWavs }
