// cloudfunctions/analyze/index.js
// 回忆分析：时间推断 + 海域建议（qwen4-max-preview，走 Token Plan 专属端点）
// key 从环境变量读取：DASHSCOPE_API_KEY / DASHSCOPE_BASE_URL / DASHSCOPE_MODEL
const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const BASE_URL = process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
const MODEL = process.env.DASHSCOPE_MODEL || 'qwen4-max-preview'

function chat (messages) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + '/chat/completions')
    const body = JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.3
    })
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (process.env.DASHSCOPE_API_KEY || ''),
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 20000
    }, (res) => {
      let buf = ''
      res.on('data', (c) => { buf += c })
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('LLM ' + res.statusCode + ' ' + buf.slice(0, 200)))
        try { resolve(JSON.parse(buf)) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.write(body)
    req.end()
  })
}

exports.main = async (event) => {
  const text = (event && event.text || '').trim()
  if (!text) return { timeOptions: [], zoneOptions: [], title: '' }

  const prompt = `你是一个温柔的记忆整理助手。用户（一位母亲）刚说了一段自己的人生回忆。
请分析这段话，严格按 JSON 输出，不要输出任何其他文字：
{
  "title": "不超过12字的标题，概括这段回忆",
  "timeOptions": ["按内容推断的1-3个可能时间，格式如：1965年前后、1980年代、孩子上小学时，最后一项加上：说不清了"],
  "zoneOptions": ["1-3个人生阶段，从这些词里选或组合：童年、少年、恋爱、结婚、孩子出生、孩子长大、工作、退休、晚年、旅行、新的开始"]
}

回忆内容：
${text.slice(0, 1200)}`

  try {
    const data = await chat([{ role: 'user', content: prompt }])
    let content = data.choices[0].message.content
    const m = content.match(/\{[\s\S]*\}/)
    if (m) content = m[0]
    const parsed = JSON.parse(content)
    return {
      title: parsed.title || '',
      timeOptions: (parsed.timeOptions || []).slice(0, 3),
      zoneOptions: (parsed.zoneOptions || []).slice(0, 3)
    }
  } catch (e) {
    console.error('analyze failed', e)
    // 降级：不阻塞发布，给默认选项
    return { title: '', timeOptions: ['说不清了'], zoneOptions: ['新的开始'] }
  }
}
