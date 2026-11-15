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
        // 只开文字模态 + 输入音频转写；VAD 用服务端默认（说停自动断句）
        this.socket.send({
          data: JSON.stringify({
            type: 'session.update',
            session: {
              modalities: ['text'],
              input_audio_format: 'pcm16',
              input_audio_transcription: {}
            }
          })
        })
        this.sessionReady = true
        resolve(this)
      })
      this.socket.onMessage((msg) => this.handleMessage(msg))
      this.socket.onError((e) => {
        if (!this.sessionReady) reject(new Error('语音服务连接异常'))
        else this.emit('error', e)
      })
      this.socket.onClose((e) => this.emit('close', e))
    })
  }

  handleMessage (msg) {
    let body
    try { body = JSON.parse(msg.data) } catch (e) { return }
    const t = body.type || ''
    if (t === 'error') {
      this.emit('error', new Error(body.error && body.error.message))
      return
    }
    if (t === 'conversation.item.input_audio_transcription.delta') {
      // stash = 渐进完整句；text = 已确认前缀
      const partial = (body.stash || body.text || '')
      if (partial) this.emit('partial', partial)
    } else if (t === 'conversation.item.input_audio_transcription.completed') {
      const final = body.transcript || ''
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

  // 提交音频（服务端 VAD 会自动断句；commit 提示输入结束）
  finish (timeoutMs = 3500) {
    return new Promise((resolve) => {
      if (!this.socket || !this.sessionReady) return resolve(this.text)
      let settled = false
      const done = (t) => { if (!settled) { settled = true; resolve(t) } }
      this.on('sentence', (finalText) => done(finalText))
      setTimeout(() => done(this.text), timeoutMs)
      try {
        this.socket.send({ data: JSON.stringify({ type: 'input_audio_buffer.commit' }) })
      } catch (e) { done(this.text) }
    })
  }

  close () {
    try { this.socket && this.socket.close({}) } catch (e) { /* 忽略 */ }
    this.socket = null
    this.sessionReady = false
  }
}

function arrayBufferToBase64 (buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return wx.arrayBufferToBase64 ? wx.arrayBufferToBase64(new Uint8Array(binary)) : btoa(binary)
}

module.exports = { AsrStream }

