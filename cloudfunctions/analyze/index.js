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
  const blanks = (event && event.blanks) || []
  if (!text) return { four: '', title: '', timeOptions: [], zoneOptions: [] }

  // 人生节点批量提取：一次说多个年份+事件，反复/重复的合并
  if (event.action === 'milestones') {
    const prompt = `从这段话里提取所有人生节点(年份+事件名2-8字)。同一件事反复说/改口的合并为一条(以最后清楚的为准)；只说年份没事件名的忽略。只输出JSON{"nodes":[{"name":"毕业","year":2011}]}，最多8条；没有则{"nodes":[]}。话：${text}`
    try {
      const r = await chat([{ role: 'user', content: prompt }])
      const m = String(r.choices[0].message.content).match(/\{[\s\S]*\}/)
      const j = JSON.parse(m ? m[0] : '{}')
      return { nodes: Array.isArray(j.nodes) ? j.nodes.slice(0, 8) : [] }
    } catch (e) { return { nodes: [] } }
  }

  // 引导对话提取（称呼/出生年/重要事件/事件时间）
  if (event.onboard) {
    const P = {
      nickname: `从这句话提炼用户希望被怎么称呼（如"陈阿姨"/"妈妈"/"老李"）。只输出JSON{"nickname":"..."}；没提到则{"nickname":""}。话：${text}`,
      birth: `提取出生年份。两位年份按常理补全世纪（如"87的"/"我87"→1987，长辈多为19xx；若明显是近年则20xx）。只输出JSON{"year":1987}；完全无法判断则{"year":null,"ask":true}。话：${text}`,
      event: `用户被问"人生中一个重要的时间是什么"。提取事件名(2-8字,如结婚/孩子出生/离婚/退休)。若表示没有/不想说/跳过→{"event":"","none":true}；否则{"event":"...","none":false}。话：${text}`,
      eventTime: `提取该事件发生的年份(4位)或当时岁数。只输出JSON{"year":1990,"age":null}或{"year":null,"age":30}；都没有{"year":null,"age":null}。话：${text}`
    }
    try {
      const r = await chat([{ role: 'user', content: P[event.onboard] || P.nickname }])
      const m = String(r.choices[0].message.content).match(/\{[\s\S]*\}/)
      return JSON.parse(m ? m[0] : '{}')
    } catch (e) { return {} }
  }
  // A3/A4：留白话题禁提；只读已发生转写，零新增（A5）
  const blankLine = blanks.length ? `\n【禁提话题（本人已跳过，绝不提起/追问）】：${blanks.join('、')}` : ''

  const prompt = `你是一个温柔的记忆整理助手。用户（一位母亲）刚说了一段自己的人生回忆。
请分析这段话，严格按 JSON 输出，不要输出任何其他文字：
{
  "four": "恰好4个汉字的凝练标题，基于内容意境、有画面感，不照抄原文开头。例：第一次去肯德基→初尝快餐；操场奔跑→操场追风；母亲煮粥→母爱温粥；离家求学→初离家门；站台送别→站台送别",
  "title": "不超过12字的标题，概括这段回忆",
  "timeOptions": ["按内容推断的1-3个可能时间，格式如：1965年前后、1980年代、孩子上小学时，最后一项加上：说不清了"],
  "zoneOptions": ["1-3个人生阶段，从这些词里选或组合：童年、少年、恋爱、结婚、孩子出生、孩子长大、工作、退休、晚年、旅行、新的开始"]
}

${blankLine}
回忆内容：
${text.slice(0, 1200)}`

  try {
    const data = await chat([{ role: 'user', content: prompt }])
    let content = data.choices[0].message.content
    const m = content.match(/\{[\s\S]*\}/)
    if (m) content = m[0]
    const parsed = JSON.parse(content)
    const fourRaw = String(parsed.four || '').replace(/[^一-鿿]/g, '')
    const four = fourRaw.slice(0, 4) || String(parsed.title || '').replace(/[^一-鿿]/g, '').slice(0, 4)
    return {
      four,
      title: parsed.title || '',
      timeOptions: (parsed.timeOptions || []).slice(0, 3),
      zoneOptions: (parsed.zoneOptions || []).slice(0, 3)
    }
  } catch (e) {
    console.error('analyze failed', e)
    // 降级：不阻塞发布，给默认选项
    return { four: '', title: '', timeOptions: ['说不清了'], zoneOptions: ['新的开始'] }
  }
}
