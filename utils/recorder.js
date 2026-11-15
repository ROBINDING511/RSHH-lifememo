// utils/recorder.js — 录音器：一路 PCM 帧双路复用
//   1) 帧实时喂给 ASR 流式识别（边说边出字）
//   2) 帧本地攒起来，结束时拼 WAV 存档（妈妈的原声）
const MAX_SECONDS = 60 // 与微信语音一致

function createRecorder () {
  const rm = wx.getRecorderManager()
  const state = {
    recording: false,
    startAt: 0,
    chunks: [], // PCM 帧缓存
    onFrame: null, // (arrayBuffer, elapsedMs) => void
    onCountdown: null, // (leftSeconds) => void 剩余<=10s时回调
    onStop: null, // (wavPath, durationMs) => void
    timer: null,
    cdTimer: null
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
    if (state.timer) clearTimeout(state.timer)
    const durationMs = Date.now() - state.startAt
    const wavPath = buildWavFile(state.chunks)
    state.chunks = []
    if (state.onStop) state.onStop(wavPath, durationMs)
  })

  rm.onError((e) => {
    state.recording = false
    if (state.onStop) state.onStop(null, 0, e)
  })

  return {
    // 返回 Promise，授权失败会 reject
    async start (hooks) {
      state.onFrame = hooks.onFrame || null
      state.onCountdown = hooks.onCountdown || null
      state.onStop = hooks.onStop || null
      state.chunks = []
      state.startAt = Date.now()

      const setting = {
        duration: MAX_SECONDS * 1000, // 到点自动停，像微信语音
        format: 'PCM',
        sampleRate: 16000,
        numberOfChannels: 1,
        frameSize: 4 // ~128ms 一帧，实时性够
      }
      rm.start(setting)

      // 最后 10 秒倒计时提醒
      const cdStart = (MAX_SECONDS - 10) * 1000
      state.cdTimer = setInterval(() => {
        const left = Math.ceil((MAX_SECONDS * 1000 - (Date.now() - state.startAt)) / 1000)
        if (left <= 10 && left > 0 && state.onCountdown) state.onCountdown(left)
      }, 500)
      // 超时兜底
      state.timer = setTimeout(() => this.stop(), MAX_SECONDS * 1000 + 300)
    },

    stop () {
      if (state.timer) clearTimeout(state.timer)
      clearInterval(state.cdTimer)
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
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // 单声道
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits
  writeStr(36, 'data')
  view.setUint32(40, dataLen, true)
  let off = 44
  chunks.forEach((c) => {
    const src = new Uint8Array(c)
    view.setUint8 ? src.forEach((b) => view.setUint8(off++, b)) : null
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
