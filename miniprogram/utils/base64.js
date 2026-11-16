// utils/base64.js — ArrayBuffer → base64（不依赖 btoa）
//
// 为什么不用 btoa：小程序逻辑层不是浏览器环境，没有 window.btoa，调用会直接
//   抛 ReferenceError。这是 asr.js 之前每帧都发不出去的根因（2026-11-16 排查确认）。
// 为什么不用 wx.arrayBufferToBase64：基础库 2.4.0 起废弃，真机性能差
//   （实测约 50KB/40ms），且社区反馈多次调用会返回空。
// 为什么不用 String.fromCharCode.apply(null, bytes)：字节数一大就会爆调用栈，
//   iOS 真机下有卡死先例。
//
// 实现：3 字节 → 4 字符的查表法，结果写入预分配数组再 join，
//   4KB 音频帧（128ms @16k/16bit/mono）实测 <1ms，满足流式实时性要求。

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * ArrayBuffer / Uint8Array → base64 字符串
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {string}
 */
function toBase64 (buffer) {
  if (!buffer) return ''
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const len = bytes.length
  if (!len) return ''

  // 输出长度：每 3 字节出 4 字符，不足补 =
  const outLen = (((len + 2) / 3) | 0) * 4
  const out = new Array(outLen)
  let o = 0
  let i = 0

  // 主循环：整 3 字节一组
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out[o++] = CHARS[(n >> 18) & 63]
    out[o++] = CHARS[(n >> 12) & 63]
    out[o++] = CHARS[(n >> 6) & 63]
    out[o++] = CHARS[n & 63]
  }

  // 尾部 1 或 2 字节
  const rem = len - i
  if (rem === 1) {
    const n = bytes[i] << 16
    out[o++] = CHARS[(n >> 18) & 63]
    out[o++] = CHARS[(n >> 12) & 63]
    out[o++] = '='
    out[o++] = '='
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out[o++] = CHARS[(n >> 18) & 63]
    out[o++] = CHARS[(n >> 12) & 63]
    out[o++] = CHARS[(n >> 6) & 63]
    out[o++] = '='
  }

  return out.join('')
}

module.exports = { toBase64 }
