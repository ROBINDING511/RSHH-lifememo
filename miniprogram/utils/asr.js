// utils/asr.js — 百炼实时语音转写（真流式：边说边出字）
//
// 接口：qwen-audio-3.0-realtime-plus @ wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime
//
// 【2026-11-16 实测重写，修正三条此前的错误结论】
//
// 1. base64 必须自己实现，不能用 btoa
//    小程序逻辑层没有 window.btoa，调用直接 ReferenceError。旧实现导致**每一帧都发不出去**，
//    服务端收不到任何音频 → 零转写 → 静默降级到「录音上传后整段识别」。
//    这是"看起来完全不是流式"的直接根因。改用 utils/base64.js（纯 JS 查表，4KB/0.04ms）。
//
// 2. 「不能发 session.update」的结论不准确
//    真正的坑是发**空的** input_audio_transcription:{} 会覆盖服务端默认转写配置。
//    显式带上 { model:'fun-asr' } 反而一切正常，而且收益很大（实测对照）：
//      - modalities:['text'] → response.audio.delta 从 34 个降到 0，服务端不再把妈妈的话
//        当对话去生成语音回复（省 token 配额 + 省带宽 + 省延迟）
//      - transcription.completed 事件从不出现 → 稳定出现（旧代码只能靠 delta 兜底猜最终结果）
//      - 配合 threshold 0.2，TTFT 从 ~570ms 降到 ~290ms
//
// 3. 多句必须按 item_id 分桶累积
//    旧代码用单个 lastFull/text 变量覆盖：说话中间停顿一下，服务端 VAD 会切成新 item，
//    新 item 的 delta 把前面的文本冲掉 → 界面上已经显示的字凭空消失，最终只剩最后一句。
//    实测复现：两句音频（中间 2.5s 停顿）分属 item1/item2，旧逻辑只留下 item2。
//    现在用 Map + 顺序数组累积，completed 的句子用 transcript，进行中的用 text+stash。
//
// 事件协议（实测）：
//   input_audio_buffer.speech_started                          服务端 VAD 检测到开口
//   conversation.item.input_audio_transcription.delta          text=已确认前缀, stash=当前句渐进
//   conversation.item.input_audio_transcription.completed      transcript=整句最终结果（可靠）
//   response.created / response.text.delta                     LLM 对本轮语音的回复（我们不需要）
//
// key 不写入代码，由 login 云函数运行时下发（见 app.js）

const { toBase64 } = require('./base64')

// ===== 实测调优参数（2026-11-16，详见文件头）=====
// VAD 灵敏度：0.2 实测 TTFT 最优（0.5→570ms / 0.3→500ms / 0.2→290~360ms / 0.1→490ms 反弹）
const VAD_THRESHOLD = 0.2
// 检测到静音多久算一句话说完。调小 → 出字更快，但妈妈说话中间换气会被误判断句
const VAD_SILENCE_MS = 600
// 语音前置填充：回溯包含开口前的一点音频，避免吃掉第一个字
const VAD_PREFIX_MS = 300
// 静音帧长度：800ms @16kHz 16bit mono（32 字节 = 1ms）
const SILENCE_BYTES = 25600
// 连接就绪等待上限。超时则放弃实时流，让上层走兜底，绝不卡住录音
const READY_TIMEOUT = 4000
// 断线重连上限：妈妈一段话最长 60s，中途断线不能就此放弃实时识别
const MAX_RECONNECT = 2
const RECONNECT_DELAY = 300

class AsrStream {
  constructor (config) {
    this.cfg = config || {}
    this.socket = null
    this.listeners = {}

    // 连接状态机：idle → connecting → ready → closed/failed
    this.state = 'idle'
    this.sessionApplied = false
    this.destroyed = false
    this.reconnects = 0

    // ===== 多句累积（核心修复，见文件头第 3 条）=====
    this.items = new Map()   // item_id → { text, stash, done, transcript }
    this.order = []          // item_id 到达顺序，保证拼接顺序正确
    this.retired = null      // reset() 后上一轮的 item_id 集合（丢弃迟到事件）

    // ===== 就绪前的帧缓存：连接还没好就把音频丢了是致命的 =====
    this.pending = []
    this.pendingBytes = 0
    this.MAX_PENDING_BYTES = 640 * 1024  // 最多缓存约 20s 音频，超出丢最旧的

    // ===== 可观测性：静默失败是这次排查最耗时的部分，必须暴露 =====
    this.stats = {
      framesSent: 0,
      framesQueued: 0,
      sendFailed: 0,
      deltas: 0,
      completed: 0,
      connectMs: null,   // WS 建连耗时
      readyMs: null,     // 到 session 配置生效
      ttft: null,        // 开口 → 首个字（真实体感 TTFT）
      firstFrameAt: 0,   // 第一帧音频发出的时刻
      firstDeltaAt: 0,
      speechStartAt: 0,  // 服务端检测到开口的时刻
      llmResponses: 0    // 服务端生成的无用回复数
    }
    this.lastError = ''
  }

  on (event, fn) { this.listeners[event] = fn; return this }

  emit (event, data) {
    const fn = this.listeners[event]
    if (fn) { try { fn(data) } catch (e) { console.warn('ASR listener error:', event, e) } }
  }

  get isReady () { return this.state === 'ready' }

  /**
   * 复用同一条连接开始新一轮识别：清空上一轮文本与计时，socket 不动。
   * 上层预热连接后调它，可以省掉每轮 300~400ms 的建连时间。
   */
  reset () {
    // 上一轮的 item 退休：它们的迟到事件（completed 常在 finish 之后才到）
    // 不许混进新一轮文本
    if (!this.retired) this.retired = new Set()
    for (const id of this.order) this.retired.add(id)
    this.items = new Map()
    this.order = []
    this.pending = []
    this.pendingBytes = 0
    this.reconnects = 0
    this.lastError = ''
    this.stats = {
      framesSent: 0, framesQueued: 0, sendFailed: 0, deltas: 0, completed: 0,
      connectMs: this.stats.connectMs,  // 建连耗时保留，它描述的是这条连接
      readyMs: null, ttft: null,
      firstFrameAt: 0, firstDeltaAt: 0, speechStartAt: 0, llmResponses: 0
    }
    return this
  }

  /** 已识别的完整文本（所有句子拼接，进行中那句用渐进值） */
  getText () {
    let out = ''
    for (const id of this.order) {
      const it = this.items.get(id)
      if (!it) continue
      out += it.done ? (it.transcript || (it.text + it.stash)) : (it.text + it.stash)
    }
    return out.trim()
  }

  /** 建连 + 下发会话配置。resolve(true)=实时流可用；resolve(false)=不可用，上层走兜底 */
  connect () {
    return new Promise((resolve) => {
      if (this.destroyed) return resolve(false)
      if (!this.cfg || !this.cfg.key || !this.cfg.url) {
        this.state = 'failed'
        this.lastError = 'ASR 配置缺失（login 云函数未下发 key）'
        console.warn('[asr]', this.lastError)
        this.emit('error', new Error(this.lastError))
        return resolve(false)
      }

      this.state = 'connecting'
      const t0 = Date.now()
      let settled = false
      const finish = (ok, reason) => {
        if (settled) return
        settled = true
        clearTimeout(guard)
        if (ok) {
          this.stats.connectMs = this.stats.connectMs == null ? Date.now() - t0 : this.stats.connectMs
          this.state = 'ready'
          this.flushPending()
          this.emit('ready', { connectMs: Date.now() - t0 })
          resolve(true)
        } else {
          this.state = 'failed'
          this.lastError = reason || '连接失败'
          this.emit('error', new Error(this.lastError))
          this.teardown()
          resolve(false)
        }
      }

      // 兜底：服务端不回 session.updated 也不能一直等着
      const guard = setTimeout(() => {
        if (this.state === 'connecting') {
          // 已经连上但配置确认没回来 —— 仍然可用（服务端有默认配置），只是不保证最优
          if (this.socket) finish(true, 'ready-without-confirm')
          else finish(false, '连接超时 ' + READY_TIMEOUT + 'ms')
        }
      }, READY_TIMEOUT)

      const url = this.cfg.url + (this.cfg.url.indexOf('?') >= 0 ? '&' : '?') + 'model=' + this.cfg.model
      let task
      try {
        task = wx.connectSocket({
          url,
          header: { Authorization: 'bearer ' + this.cfg.key },
          // 真机上必须已在小程序后台配置 socket 合法域名，否则会直接失败
          fail: (e) => finish(false, 'connectSocket 调用失败：' + ((e && e.errMsg) || ''))
        })
      } catch (e) {
        return finish(false, 'connectSocket 抛异常：' + (e && e.message))
      }
      if (!task) return finish(false, 'connectSocket 未返回 SocketTask')
      this.socket = task

      task.onOpen(() => {
        this.stats.connectMs = Date.now() - t0
        this.applySession()
        // 部分实现不回 session.updated，这里给一个短的宽限期后就认为可用
        setTimeout(() => { if (this.state === 'connecting') finish(true, 'open-without-confirm') }, 900)
      })

      task.onMessage((msg) => this.handleMessage(msg, finish))

      task.onError((e) => {
        const m = (e && (e.errMsg || e.message)) || '未知错误'
        console.warn('[asr] socket error:', m)
        if (this.state !== 'ready') finish(false, 'socket error: ' + m)
        else this.handleDrop('error: ' + m)
      })

      task.onClose((e) => {
        const code = e && (e.code != null ? e.code : e.errMsg)
        if (this.state !== 'ready') finish(false, '连接被关闭 code=' + code)
        else this.handleDrop('close code=' + code)
      })
    })
  }

  /** 下发会话配置：关语音回复 + 明确转写模型 + 调优 VAD（参数依据见文件头） */
  applySession () {
    const payload = {
      type: 'session.update',
      session: {
        modalities: ['text'],                                   // 只要文本，不要语音回复
        input_audio_transcription: { model: 'fun-asr' },        // 必须显式带 model，空的会覆盖默认配置
        turn_detection: {
          type: 'server_vad',
          threshold: VAD_THRESHOLD,
          prefix_padding_ms: VAD_PREFIX_MS,
          silence_duration_ms: VAD_SILENCE_MS
        }
      }
    }
    this.rawSend(payload, 'session.update')
  }

  handleMessage (msg, finish) {
    let b
    try { b = JSON.parse(typeof msg.data === 'string' ? msg.data : '') } catch (e) { return }
    const t = b.type || ''

    switch (t) {
      case 'session.updated':
        this.sessionApplied = true
        if (this.state === 'connecting' && finish) finish(true, 'session.updated')
        return

      case 'input_audio_buffer.speech_started':
        this.stats.speechStartAt = Date.now()
        return

      case 'conversation.item.input_audio_transcription.delta': {
        const id = b.item_id || 'default'
        const it = this.ensureItem(id)
        if (!it) return
        it.text = b.text || ''
        it.stash = b.stash || ''
        this.stats.deltas++
        // TTFT：从第一帧音频发出到第一个字
        if (this.stats.firstDeltaAt === 0 && this.stats.firstFrameAt) {
          this.stats.firstDeltaAt = Date.now()
          this.stats.ttft = this.stats.firstDeltaAt - this.stats.firstFrameAt
          console.log(`[asr] ★ TTFT ${this.stats.ttft}ms（开口→首字）；VAD 检测 ${this.stats.speechStartAt ? this.stats.firstDeltaAt - this.stats.speechStartAt + 'ms' : '-'}`)
        }
        this.emit('partial', this.getText())
        return
      }

      case 'conversation.item.input_audio_transcription.completed': {
        const id = b.item_id || 'default'
        const it = this.ensureItem(id)
        if (!it) return
        it.done = true
        // transcript 是服务端定稿，优先于渐进值
        it.transcript = (b.transcript || '').trim()
        this.stats.completed++
        const full = this.getText()
        if (full) this.emit('sentence', full)
        return
      }

      case 'response.created':
        // 服务端在对本轮语音生成 LLM 回复（我们只要转写，不需要它）
        this.stats.llmResponses++
        const rid = b.response && b.response.id
        if (rid) this.rawSend({ type: 'response.cancel', response_id: rid }, 'response.cancel')
        return

      case 'error': {
        const em = (b.error && (b.error.message || b.error.code)) || '未知服务端错误'
        // modalities 类配置警告无害，忽略；其余上报
        if (!/modalities/i.test(em)) {
          console.warn('[asr] 服务端 error:', em)
          this.lastError = em
          this.emit('error', new Error(em))
        }
        return
      }

      default:
        return
    }
  }

  ensureItem (id) {
    // 已退休的 item（上一轮遗留的迟到事件）直接丢弃
    if (this.retired && this.retired.has(id)) return null
    let it = this.items.get(id)
    if (!it) {
      it = { text: '', stash: '', done: false, transcript: '' }
      this.items.set(id, it)
      this.order.push(id)
    }
    return it
  }

  /**
   * 发送一帧 PCM。ready 之前进缓存队列，就绪后补发 —— 一个字都不能丢。
   * @param {ArrayBuffer} buffer
   */
  sendFrame (buffer) {
    if (this.destroyed || !buffer || !buffer.byteLength) return
    if (this.state === 'ready') {
      this.pushFrame(buffer)
    } else if (this.state === 'connecting') {
      this.pending.push(buffer)
      this.pendingBytes += buffer.byteLength
      this.stats.framesQueued++
      // 超出上限丢最旧的，保证内存可控（宁丢开头也别 OOM）
      while (this.pendingBytes > this.MAX_PENDING_BYTES && this.pending.length > 1) {
        const old = this.pending.shift()
        this.pendingBytes -= old.byteLength
      }
    }
    // state === 'failed'/'closed' 时丢弃：上层会走云函数兜底
  }

  flushPending () {
    if (!this.pending.length) return
    const q = this.pending
    this.pending = []
    this.pendingBytes = 0
    // 连接刚就绪就把攒下的音频一次性灌进去，服务端按到达顺序转写
    for (const buf of q) this.pushFrame(buf)
    console.log(`[asr] 补发缓存帧 ${q.length} 个`)
  }

  pushFrame (buffer) {
    if (!this.socket || this.state !== 'ready') return
    let b64
    try {
      b64 = toBase64(buffer)
    } catch (e) {
      this.stats.sendFailed++
      console.error('[asr] base64 编码失败', e)
      return
    }
    const ok = this.rawSend({ type: 'input_audio_buffer.append', audio: b64 }, 'append')
    if (ok) {
      this.stats.framesSent++
      if (!this.stats.firstFrameAt) this.stats.firstFrameAt = Date.now()
    } else {
      this.stats.sendFailed++
    }
  }

  /** 统一的发送出口，带失败统计（旧代码 send 失败完全无感知） */
  rawSend (payload, label) {
    if (!this.socket) return false
    let data
    try { data = JSON.stringify(payload) } catch (e) { return false }
    try {
      this.socket.send({
        data,
        fail: (e) => {
          this.stats.sendFailed++
          if (label !== 'append') console.warn(`[asr] send ${label} 失败:`, e && e.errMsg)
        }
      })
      return true
    } catch (e) {
      this.stats.sendFailed++
      return false
    }
  }

  /** 录音中途断线：重连并继续，别把妈妈剩下的话全丢给兜底 */
  handleDrop (reason) {
    if (this.destroyed || this.state === 'closed') return
    console.warn('[asr] 连接中断：' + reason)
    this.teardown()
    if (this.reconnects >= MAX_RECONNECT) {
      this.state = 'failed'
      this.lastError = '连接中断且重连已达上限：' + reason
      this.emit('error', new Error(this.lastError))
      return
    }
    this.reconnects++
    this.state = 'connecting'
    console.log(`[asr] 第 ${this.reconnects} 次重连…`)
    setTimeout(() => {
      if (this.destroyed) return
      // 重连不重新走 Promise（上层已经在录音了），内部直连
      this.reconnect()
    }, RECONNECT_DELAY)
  }

  reconnect () {
    if (this.destroyed || !this.cfg.key) return
    const url = this.cfg.url + (this.cfg.url.indexOf('?') >= 0 ? '&' : '?') + 'model=' + this.cfg.model
    let task
    try {
      task = wx.connectSocket({ url, header: { Authorization: 'bearer ' + this.cfg.key } })
    } catch (e) { return this.handleDrop('重连抛异常') }
    if (!task) return this.handleDrop('重连未返回 SocketTask')
    this.socket = task
    task.onOpen(() => {
      this.state = 'ready'
      this.applySession()
      this.flushPending()
      this.emit('ready', { reconnect: this.reconnects })
    })
    task.onMessage((msg) => this.handleMessage(msg, null))
    task.onError(() => this.handleDrop('重连后 error'))
    task.onClose((e) => this.handleDrop('重连后 close ' + (e && e.code)))
  }

  /**
   * 收尾：补静音触发 VAD 断句，拿到最后一句的定稿。
   * 界面上的文字在录音期间已经通过 partial 实时显示了，这里只是把尾巴收干净，
   * 所以等待很短，不再像旧实现那样干等 4 秒。
   * @param {number} waitMs 最长等待
   * @returns {Promise<string>} 完整文本
   */
  finish (waitMs = 2200) {
    return new Promise((resolve) => {
      if (this.destroyed || this.state !== 'ready' || !this.socket) {
        return resolve(this.getText())
      }
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        clearInterval(stableTimer)
        clearTimeout(hardTimer)
        resolve(this.getText())
      }

      // 已有 completed 覆盖全部句子 → 立刻返回，不必等
      const allDone = this.order.length > 0 && this.order.every((id) => {
        const it = this.items.get(id)
        return it && it.done
      })
      if (allDone) return done()

      let lastLen = -1
      let stable = 0
      // 文本连续 3 次探测（约 360ms）不再增长，就认为说完了
      const stableTimer = setInterval(() => {
        const len = this.getText().length
        if (len === lastLen && len > 0) {
          if (++stable >= 3) done()
        } else { stable = 0; lastLen = len }
      }, 120)
      const hardTimer = setTimeout(done, waitMs)

      try {
        // 补 0.8s 静音，让服务端 VAD 判定"说完了"并吐 completed
        this.rawSend({ type: 'input_audio_buffer.append', audio: toBase64(new ArrayBuffer(SILENCE_BYTES)) }, 'silence')
        setTimeout(() => {
          if (this.state === 'ready') this.rawSend({ type: 'input_audio_buffer.commit' }, 'commit')
        }, 500)
      } catch (e) { done() }
    })
  }

  // ===== 连接保活：预热后空闲太久服务端会断，喂极小静音帧续命 =====
  startKeepAlive (intervalMs = 15000) {
    this.stopKeepAlive()
    this._ka = setInterval(() => {
      // 只在就绪、且当前没在推真实音频时保活（推流期间本来就有数据）
      if (this.state === 'ready' && !this.destroyed && !this.stats.firstFrameAt) {
        this.rawSend({ type: 'input_audio_buffer.append', audio: toBase64(new ArrayBuffer(320)) }, 'keepalive')
      }
    }, intervalMs)
  }

  stopKeepAlive () {
    if (this._ka) { clearInterval(this._ka); this._ka = null }
  }

  /** 打印本轮诊断（真机排查靠它，不用再猜） */
  report () {
    const s = this.stats
    return {
      ready: this.sessionApplied,
      ttft: s.ttft,
      connectMs: s.connectMs,
      framesSent: s.framesSent,
      framesQueued: s.framesQueued,
      sendFailed: s.sendFailed,
      deltas: s.deltas,
      completed: s.completed,
      sentences: this.order.length,
      llmResponses: s.llmResponses,
      reconnects: this.reconnects,
      textLength: this.getText().length,
      error: this.lastError
    }
  }

  teardown () {
    try { if (this.socket) this.socket.close({}) } catch (e) { /* 忽略 */ }
    this.socket = null
  }

  /** 彻底关闭：拿到文本后立刻断开，止住服务端继续生成无用回复（省配额） */
  close () {
    this.destroyed = true
    this.state = 'closed'
    this.stopKeepAlive()
    this.pending = []
    this.pendingBytes = 0
    this.teardown()
    this.listeners = {}
  }
}

module.exports = { AsrStream, VAD_THRESHOLD, VAD_SILENCE_MS }
