// utils/asr.js — 百炼实时语音转写（流式，边说边出字）
// 接口：qwen-audio-3.0-realtime-plus（已用本 key 实测调通，2026-11-15）
// 协议（Realtime 风格）：
//   session.update（开转写）→ input_audio_buffer.append（base64 PCM 帧）
//   → input_audio_buffer.commit → delta 事件逐字回传
//   transcript 在 delta 的 stash 字段（渐进完整句），最终 text+stash 合成
// key 不写入代码，由 login 云函数运行时下发（见 app.js）

class AsrStream {
  constructor (config) {
    this.cfg = config
    this.socket = null
    this.text = ''      // 已确认文本
    this.listeners = {}
    this.sessionReady = false
  }

  on (event, fn) { this.listeners[event] = fn; return this }

  emit (event, data) { if (this.listeners[event]) this.listeners[event](data) }

  // 建连 + 开会话
  connect () {
    return new Promise((resolve, reject) => {
      const url = this.cfg.url + '?model=' + this.cfg.model
      this.socket = wx.connectSocket({
        url,
        header: { Authorization: 'bearer ' + this.cfg.key },
        success: () => {},
        fail: (e) => reject(new Error('无法连接语音服务：' + (e.errMsg || '')))
      })
      this.socket.onOpen(() => {
        // 重要（2026-11-15 实测）：不要发 session.update！
        // 服务端默认已配好转写（fun-asr）+ VAD 自动断句；
        // 发 input_audio_transcription:{} 会覆盖默认配置，导致收不到任何转写事件。
        this.sessionReady = true
        resolve(this)
      })
      this.socket.onMessage((msg) => this.handleMessage(msg))
      this.socket.onError((e) => {
        console.error('ASR socket error:', e)
        if (!this.sessionReady) reject(new Error('连接异常 ' + (e.errMsg || '')))
        else this.emit('error', e)
      })
      this.socket.onClose((e) => {
        console.warn('ASR socket closed:', e && (e.code || e.errMsg))
        if (!this.sessionReady) reject(new Error('连接被关闭 ' + ((e && (e.code || e.errMsg)) || '')))
        else this.emit('close', e)
      })
    })
  }

  handleMessage (msg) {
    let body
    try { body = JSON.parse(msg.data) } catch (e) { return }
    const t = body.type || ''
    if (t === 'error') {
      // modalities 类配置错误直接忽略（session 仍可用）；其他错误抛出
      const em = (body.error && body.error.message) || ''
      if (!/modalities/.test(em)) this.emit('error', new Error(em))
      return
    }
    if (t === 'conversation.item.input_audio_transcription.delta') {
      // 实测协议（2026-11-15）：text=已确认前缀，stash=当前句渐进全文
      // 完整文本 = text + stash
      const confirmed = body.text || ''
      const growing = body.stash || ''
      const full = (confirmed + growing).trim()
      if (full) {
        this.lastFull = full
        this.emit('partial', full)
      }
    } else if (t === 'conversation.item.input_audio_transcription.completed') {
      // 部分实现会发 completed；不发时由 finish() 用最后一次 delta 兜底
      const final = body.transcript || this.lastFull || ''
      if (final) {
        this.text = final
        this.emit('sentence', final)
      }
    }
  }

  // 发送一帧 PCM（ArrayBuffer）→ base64 append
  sendFrame (buffer) {
    if (!this.socket || !this.sessionReady) return
    const b64 = arrayBufferToBase64(buffer)
    this.socket.send({
      data: JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 })
    })
  }

  // 提交音频并取最终文本（completed 可能不来，用最后一次 delta 兜底）
  finish (timeoutMs = 4000) {
    return new Promise((resolve) => {
      const best = () => (this.text && this.text.trim()) || (this.lastFull || '').trim()
      if (!this.socket || !this.sessionReady) return resolve(best())
      let settled = false
      const done = () => { if (!settled) { settled = true; resolve(best()) } }
      this.on('sentence', done)
      setTimeout(done, timeoutMs)
      try {
        // 补 0.8s 静音触发服务端 VAD 断句，再 commit（实测有效顺序）
        const silence = new ArrayBuffer(25600)
        this.socket.send({
          data: JSON.stringify({ type: 'input_audio_buffer.append', audio: arrayBufferToBase64(silence) })
        })
        setTimeout(() => {
          try { this.socket.send({ data: JSON.stringify({ type: 'input_audio_buffer.commit' }) }) } catch (e) { /* 忽略 */ }
        }, 600)
      } catch (e) { done() }
    })
  }

  close () {
    try { this.socket && this.socket.close({}) } catch (e) { /* 忽略 */ }
    this.socket = null
    this.sessionReady = false
  }
}

function arrayBufferToBase64 (buffer) {
  // 修复（2026-11-15）：旧实现 new Uint8Array(binary字符串) 得到空数组，发出去的帧全是空的。
  // 正确做法：字节 → 二进制字符串 → btoa。分块避免超长参数栈溢出。
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

module.exports = { AsrStream }

