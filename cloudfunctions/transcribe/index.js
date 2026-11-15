// cloudfunctions/transcribe/index.js
// 兜底转写：小程序端流式 ASR 连不上时（真机域名白名单等），
// 录音结束后把 WAV 上传云存储，本函数按实时速率喂给百炼 Realtime 接口转写整段。
// 协议：连上后直接 append base64 PCM → commit（不发 session.update，用服务端默认配置，见下）。
// 环境变量：DASHSCOPE_API_KEY（与 login/analyze 相同）
const cloud = require('wx-server-sdk')
const WebSocket = require('ws')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const API_KEY = () => process.env.DASHSCOPE_API_KEY || ''
const MODEL = process.env.ASR_MODEL || 'qwen-audio-3.0-realtime-plus'
const WS_URL = (process.env.ASR_WS_URL || 'wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime') + '?model=' + MODEL
const FRAME_BYTES = 3200 // 100ms @16kHz 16bit mono
const FRAME_INTERVAL = 50 // ms，实测 2x 发送 + 结尾静音即可出结果
const MAX_AUDIO_MS = 55000 // 兜底只处理 <=55s
// 推流尾部开销：起始等待 0.5s + 静音后 VAD 断句等待 2.5s + commit 后 1.5s
const TAIL_MS = 4500
// 预留给「返回结果 + 网络往返」的时间，避免平台在收尾阶段强杀
const RESERVE_MS = 5000
// 云端函数超时未知时的保守假设（微信默认 3s，本项目实际配 60s）
const FALLBACK_BUDGET_MS = 60000

function sleep (ms) { return new Promise((r) => setTimeout(r, ms)) }

/**
 * 按平台给的真实剩余时间算出本次可用的时间预算。
 * 必须自适应：CLI/控制台改超时后代码不用跟着改，且保证兜底 timer
 * 一定早于平台强杀触发 —— 否则卡住时用户连已识别的部分文本都拿不到。
 */
function budgetOf (context) {
  let remaining = 0
  try {
    if (context && typeof context.getRemainingTimeInMillis === 'function') {
      remaining = Number(context.getRemainingTimeInMillis()) || 0
    }
  } catch (e) { /* 取不到就用兜底值 */ }
  if (!remaining || remaining < 10000) remaining = FALLBACK_BUDGET_MS
  return Math.max(10000, remaining - RESERVE_MS)
}

// WAV → 裸 PCM（跳过 44 字节标准头；若已含 data chunk 定位则更稳）
function wavToPcm (buf) {
  if (buf.length > 44 && buf.toString('ascii', 0, 4) === 'RIFF') {
    // 找 data chunk
    let off = 12
    while (off + 8 <= buf.length) {
      const id = buf.toString('ascii', off, off + 4)
      const size = buf.readUInt32LE(off + 4)
      if (id === 'data') return buf.slice(off + 8, off + 8 + size)
      off += 8 + size + (size % 2)
    }
    return buf.slice(44)
  }
  return buf
}

function transcribePcm (pcm, context) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers: { Authorization: 'bearer ' + API_KEY() } })
    const parts = []
    let lastFull = ''
    let settled = false
    let hardTimer = null
    const finish = (err) => {
      if (settled) return
      settled = true
      if (hardTimer) clearTimeout(hardTimer)
      try { ws.close() } catch (e) { /* ignore */ }
      // completed 事件可能不来：用最后一次 delta 兜底
      const text = (parts.join('') + lastFull).trim()
      err && !text ? reject(err) : resolve(text)
    }
    // 本次可用的时间预算（随平台超时自适应，不再写死 +15s）
    const budgetMs = budgetOf(context)
    // 音频时长（ms）：32 bytes = 1ms @16kHz 16bit mono
    const audioMs = Math.min(pcm.length / 32, MAX_AUDIO_MS)
    // 推流按 FRAME_INTERVAL/100 倍速进行，故耗时 = audioMs * (FRAME_INTERVAL/100)
    const pushMs = audioMs * (FRAME_INTERVAL / 100)
    // 兜底 timer 必须早于平台强杀，否则卡住时连部分文本都拿不到
    const totalMs = Math.min(pushMs + TAIL_MS + 8000, budgetMs)
    console.log('transcribe budget=%dms audio=%dms push=%dms timer=%dms', budgetMs, audioMs, pushMs, totalMs)
    hardTimer = setTimeout(() => finish(parts.length || lastFull ? null : new Error('transcribe timeout')), totalMs)

    ws.on('open', () => {
      // 重要（2026-11-15 实测）：不要发 session.update！
      // 服务端默认已配好 input_audio_transcription={model:'fun-asr'} + server VAD，
      // 发空的 input_audio_transcription:{} 反而会覆盖默认配置导致无转写事件。
      console.log('ws open, use server default session config')
    })
    ws.on('message', (raw) => {
      let b
      try { b = JSON.parse(raw.toString()) } catch (e) { return }
      const t = b.type || ''
      if (t === 'conversation.item.input_audio_transcription.delta') {
        // text=已确认前缀，stash=渐进当前句；完整文本 = text + stash
        const full = ((b.text || '') + (b.stash || '')).trim()
        if (full) lastFull = full
      } else if (t === 'conversation.item.input_audio_transcription.completed') {
        const final = b.transcript || lastFull
        if (final && !parts.includes(final)) parts.push(final)
        lastFull = ''
      } else if (t === 'error') {
        // modalities 配置类错误可忽略（session 仍正常工作）
        const em = (b.error && b.error.message) || ''
        if (!/modalities/.test(em)) finish(new Error('asr error: ' + em.slice(0, 150)))
      }
    })
    ws.on('error', (e) => finish(new Error('ws error: ' + e.message)))
    ws.on('close', () => finish(null))

    // 推流（2x 实测可用；结尾补 0.8s 静音触发 VAD 断句）
    ;(async () => {
      await sleep(500)
      // 音频上限之外，还要留出 TAIL_MS 给静音断句与 commit，超预算则截断音频
      const usableMs = Math.max(1000, budgetMs - TAIL_MS - 1000)
      const audioLimitMs = Math.min(MAX_AUDIO_MS, usableMs / (FRAME_INTERVAL / 100))
      const limit = Math.min(pcm.length, Math.floor(audioLimitMs / 100) * FRAME_BYTES)
      if (limit < pcm.length) {
        console.log('audio truncated to fit budget: %d/%d bytes (%ds)', limit, pcm.length, Math.round(limit / 32000))
      }
      for (let off = 0; off < limit && !settled; off += FRAME_BYTES) {
        ws.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: pcm.slice(off, off + FRAME_BYTES).toString('base64')
        }))
        await sleep(FRAME_INTERVAL)
      }
      if (settled) return
      // 0.8s 静音 + 等待 VAD 断句（实测：静音后 ~1.5s 内 delta 全部到齐）
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: Buffer.alloc(25600).toString('base64') }))
      await sleep(2500)
      ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
      await sleep(1500)
      finish(null)
    })().catch((e) => finish(e))
  })
}

exports.main = async (event, context) => {
  const key = API_KEY()
  if (!key) return { ok: false, error: 'missing DASHSCOPE_API_KEY' }
  let pcm
  if (event.fileID) {
    const dl = await cloud.downloadFile({ fileID: event.fileID })
    pcm = wavToPcm(dl.fileContent)
  } else if (event.audioBase64) {
    pcm = wavToPcm(Buffer.from(event.audioBase64, 'base64'))
  } else {
    return { ok: false, error: 'no audio input' }
  }
  if (!pcm || pcm.length < 3200) return { ok: false, error: 'audio too short' }
  try {
    const text = await transcribePcm(pcm, context)
    return { ok: true, text }
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200) }
  }
}
