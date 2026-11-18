// cloudfunctions/voiceclone/index.js — 妈妈声音克隆生命周期
// 状态机：collecting(自动克隆中) → review(克隆完成请妈妈试听) → frozen(像,固化锁定) → delete → collecting
// 固化后不再自动克隆；删除后恢复自动克隆。key 存私有集合 secrets，绝不入代码/git。
const cloud = require('wx-server-sdk')
const https = require('https')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const HOST = 'https://dashscope.aliyuncs.com'

function post (path, body, key) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = https.request(HOST + path, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let buf = ''
      res.on('data', (c) => { buf += c })
      res.on('end', () => { try { resolve(JSON.parse(buf)) } catch (e) { reject(new Error('bad json')) } })
    })
    req.on('error', reject)
    req.setTimeout(60000, () => { req.destroy(new Error('timeout')) })
    req.write(data); req.end()
  })
}
async function getKey () {
  if (process.env.VOICECLONE_API_KEY) return process.env.VOICECLONE_API_KEY
  const r = await db.collection('secrets').doc('voiceclone').get().catch(() => null)
  return r && r.data ? r.data.key : ''
}
async function profile (owner) {
  const r = await db.collection('voice_profile').doc(owner).get().catch(() => null)
  return r && r.data ? r.data : { owner, state: 'collecting', voiceId: '', samples: [], sampleUrl: '' }
}
async function saveProfile (p) { await db.collection('voice_profile').doc(p.owner).set({ data: p }) }

async function enroll (p, key) {
  // 取最近一条足够长的样本做参考音频
  const fid = p.samples[p.samples.length - 1]
  const tmp = await cloud.getTempFileURL({ fileList: [fid] })
  const url = tmp.fileList[0].tempFileURL
  const r = await post('/api/v1/services/audio/tts/customization', {
    model: 'voice-enrollment',
    input: { action: 'create_voice', target_model: 'cosyvoice-v3.5-plus', prefix: 'mama', url }
  }, key)
  const voiceId = r.output && r.output.voice_id
  if (!voiceId) throw new Error((r.message || 'enroll failed').slice(0, 120))
  p.voiceId = voiceId
  // 生成试听样本
  const t = await post('/api/v1/services/aigc/multimodal-generation/generation', {
    model: 'cosyvoice-v3.5-plus',
    input: { text: '我是妈妈，听听这个声音像我吗？', voice: voiceId }
  }, key)
  p.sampleUrl = (t.output && t.output.audio && t.output.audio.url) || ''
  p.state = 'review'
  return p
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const a = event.action
  try {
    if (a === 'speak') {
      // 杭航"说"出来（TTS），不是画面弹窗
      const key = await getKey()
      if (!key) return { ok: false, error: 'no key' }
      const voice = event.voice || 'Cherry'
      const r = await post('/api/v1/services/aigc/multimodal-generation/generation', {
        model: 'qwen3-tts-flash',
        input: { text: String(event.text || '').slice(0, 200), voice }
      }, key).catch(() => null)
      let url = r && r.output && r.output.audio && r.output.audio.url
      if (!url) {
        const r2 = await post('/api/v1/services/aigc/multimodal-generation/generation', {
          model: 'qwen3-tts-flash', input: { text: String(event.text || '').slice(0, 200), voice: 'Serena' }
        }, key).catch(() => null)
        url = r2 && r2.output && r2.output.audio && r2.output.audio.url
      }
      return url ? { ok: true, url } : { ok: false, error: 'tts failed' }
    }
    if (a === 'setKey') {
      await db.collection('secrets').doc('voiceclone').set({ data: { key: event.key } }).catch(async () => {
        await db.createCollection('secrets').catch(() => {})
        await db.collection('secrets').doc('voiceclone').set({ data: { key: event.key } })
      })
      return { ok: true }
    }
    const key = await getKey()
    const p = await profile(OPENID)
    if (a === 'status') return { ok: true, state: p.state, voiceId: p.voiceId, sampleUrl: p.sampleUrl, samples: p.samples.length, hasKey: !!key }
    if (a === 'addSample') {
      if (event.fileID) p.samples = p.samples.concat([event.fileID]).slice(-8)
      // 固化后不再自动克隆；收集态且样本足够长→自动克隆
      if (p.state === 'collecting' && key && (event.durationMs || 0) >= 10000) {
        try { await enroll(p, key) } catch (e) { p.state = 'collecting'; p.err = String(e.message).slice(0, 120) }
      }
      await saveProfile(p)
      return { ok: true, state: p.state, sampleUrl: p.sampleUrl }
    }
    if (a === 'confirm') {
      if (event.like) { p.state = 'frozen' }
      else {
        if (p.voiceId) await post('/api/v1/services/audio/tts/customization', { model: 'voice-enrollment', input: { action: 'delete_voice', voice_id: p.voiceId } }, key).catch(() => {})
        p.voiceId = ''; p.sampleUrl = ''; p.state = 'collecting'
      }
      await saveProfile(p)
      return { ok: true, state: p.state }
    }
    if (a === 'delete') {
      if (p.voiceId) await post('/api/v1/services/audio/tts/customization', { model: 'voice-enrollment', input: { action: 'delete_voice', voice_id: p.voiceId } }, key).catch(() => {})
      p.voiceId = ''; p.sampleUrl = ''; p.state = 'collecting'
      await saveProfile(p)
      return { ok: true, state: p.state }
    }
    return { ok: false, error: 'unknown action' }
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200) }
  }
}