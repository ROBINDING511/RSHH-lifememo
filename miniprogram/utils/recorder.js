// utils/recorder.js — 录音器：一路 PCM 帧双路复用
//   1) 帧实时喂给 ASR 流式识别（边说边出字）
//   2) 帧本地攒起来，结束时拼 WAV 存档（妈妈的原声）
//
// 适老化改造：
//   - onTick：每秒回传"已说几秒"，界面常驻显示，不让妈妈猜还剩多久
//   - MAX_SECONDS 到点自动停，自动保存（原来会丢）
//   - 帧缓存常驻，任何异常路径都能先落地成本地 WAV
//   - 说满上限时通过 onStop 第四参 { hitLimit:true } 告知上层，
//     上层据此问"要不要接着说下一段"，而不是把话头硬切掉
const MAX_SECONDS = 60 // 单段上限，与微信语音一致；长回忆由「接着说」拆成多段
// 判定"这次停止是说满触发的"的容差。
// 注意：wx 自身 duration 在整 60s 就自动停，早于下面 +300ms 的兜底 timer，
// 所以 limitHit 标记经常来不及打上，必须保留时长兜底判断；
// 但要加「非用户主动停」这个前提，否则妈妈在 59.8s 手点"说完了"会被误判成说满。
const LIMIT_TOLERANCE_MS = 300

function createRecorder () {
  const rm = wx.getRecorderManager()
  const state = {
    recording: false,
    startAt: 0,
    chunks: [], // PCM 帧缓存
    onFrame: null, // (arrayBuffer, elapsedMs) => void
    onTick: null, // (elapsedSeconds) => void 每秒回调
    onCountdown: null, // (leftSeconds) => void 剩余<=10s时回调
    onStop: null, // (wavPath, durationMs, err, meta) => void
    timer: null,
    tickTimer: null,
    cdTimer: null,
    limitHit: false, // 本次停止是否由「说满上限」触发
    userStopped: false // 本次停止是否由用户主动触发（点"说完了"/不录了/切后台）
  }

  rm.onFrameRecorded((res) => {
    if (!state.recording) return
    state.chunks.push(res.frameBuffer)
    const elapsed = Date.now() - state.startAt
    if (state.onFrame) state.onFrame(res.frameBuffer, elapsed)
  })

  rm.onStart(() => { state.recording = true })

  rm.onStop(() => {
    state.recording = false
    clearInterval(state.cdTimer)
    clearInterval(state.tickTimer)
    if (state.timer) clearTimeout(state.timer)
    const durationMs = Date.now() - state.startAt
    // 说满判定：本地 timer 打标，或（wx duration 先到点、标记没来得及打）时长够长且不是用户主动停
    const hitLimit = state.limitHit ||
      (!state.userStopped && durationMs >= MAX_SECONDS * 1000 - LIMIT_TOLERANCE_MS)
    state.limitHit = false
    state.userStopped = false
    const wavPath = buildWavFile(state.chunks)
    state.chunks = []
    if (state.onStop) state.onStop(wavPath, durationMs, null, { hitLimit })
  })

  rm.onError((e) => {
    state.recording = false
    clearInterval(state.cdTimer)
    clearInterval(state.tickTimer)
    if (state.timer) clearTimeout(state.timer)
    // 出错也先把已录到的帧落地，绝不白说一场
    const durationMs = Date.now() - state.startAt
    state.limitHit = false
    state.userStopped = false
    const wavPath = buildWavFile(state.chunks)
    state.chunks = []
    if (state.onStop) state.onStop(wavPath, durationMs, e, { hitLimit: false })
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
      state.limitHit = false
      state.userStopped = false

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

      // 最后 10 秒倒计时提醒
      state.cdTimer = setInterval(() => {
        const left = Math.ceil((MAX_SECONDS * 1000 - (Date.now() - state.startAt)) / 1000)
        if (left <= 10 && left > 0 && state.onCountdown) state.onCountdown(left)
      }, 500)

      // 超时兜底：到点自动 stop（走 onStop → 自动进入发布卡，内容不丢）
      // 打标 limitHit：上层据此问「要不要接着说下一段」，而不是把话头硬切掉
      // stop(false)：这次不是用户按的，别把它误记成"用户主动停"
      state.timer = setTimeout(() => {
        state.limitHit = true
        this.stop(false)
      }, MAX_SECONDS * 1000 + 300)
    },

    /**
     * @param {boolean} byUser 是否用户主动停（点"说完了"/不录了/切后台）。
     *   用于把"说满上限"和"妈妈自己在 59 秒点结束"区分开 —— 后者不该弹"接着说"。
     */
    stop (byUser = true) {
      if (byUser !== false) state.userStopped = true
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

module.exports = { createRecorder, MAX_SECONDS }
