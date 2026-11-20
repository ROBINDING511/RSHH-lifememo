// cloudfunctions/refine/index.js — 单冰山证据链流水线（B2）
// adapted from yitan (MIT) prompts/writing/grounding/redact + memoir-product (MIT) manuscript 原则
// 总纲：老人的话是史料不是素材；AI 只有裱糊权没有创作权；一切修改可见、可还原、由本人拍板。
// 四步：事件+疑点提取 → 轻整理写稿 → 独立审查 → 修订。短句降级；异步不阻塞；≤4 次 LLM；按 rawText 哈希缓存。
const cloud = require('wx-server-sdk')
const https = require('https')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const BASE_URL = process.env.DASHSCOPE_BASE_URL || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
const MODEL = process.env.DASHSCOPE_MODEL || 'qwen4-max-preview'
const KEY = () => process.env.DASHSCOPE_API_KEY || ''

function chat (messages, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + '/chat/completions')
    const body = JSON.stringify({ model: MODEL, messages, temperature: 0.2 })
    const req = https.request({
      hostname: url.hostname, path: url.pathname + url.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY(), 'Content-Length': Buffer.byteLength(body) },
      timeout: timeoutMs
    }, (res) => {
      let buf = ''
      res.on('data', (c) => { buf += c })
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('LLM ' + res.statusCode))
        try { resolve(JSON.parse(buf)) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.write(body); req.end()
  })
}
function parseJSON (content) {
  const m = String(content || '').match(/\{[\s\S]*\}/)
  return JSON.parse(m ? m[0] : content)
}
const norm = (s) => String(s || '').replace(/\s+/g, '')

// B3 银行卡脱敏（adapted from yitan redact.py, MIT）：13~19 位 + Luhn 通过才移除；录音不动；年份/短号码不动
function luhn (num) {
  let sum = 0, alt = false
  for (let i = num.length - 1; i >= 0; i--) {
    let d = +num[i]
    if (alt) { d *= 2; if (d > 9) d -= 9 }
    sum += d; alt = !alt
  }
  return sum % 10 === 0
}
function redact (text) {
  return String(text || '').replace(/\d{13,19}/g, (m) => (luhn(m) ? '[卡号已隐藏]' : m))
}

// B3 硬校验：quote 必须是 lines[line].text 的连续子串；[AI补充] 零容忍
function validate (sentences, lines) {
  let rejected = false
  const out = sentences.map((s) => {
    if (/\[AI补充\]/.test(s.text || '')) { rejected = true; return null }
    const ev = (s.evidence || []).filter((e) => {
      const lt = norm((lines[e.line] || {}).text)
      return lt && lt.includes(norm(e.quote))
    })
    if (!ev.length) return { ...s, text: redact((lines[(s.evidence || [{}])[0].line] || {}).text || s.text), evidence: [], source: 'raw' }
    return { ...s, evidence: ev, text: redact(s.text) }
  }).filter(Boolean)
  return { rejected, sentences: out }
}

exports.main = async (event) => {
  const lines = (event.lines || []).map((l, i) => ({ n: i, t: l.t, seg: l.seg || '初录', text: redact(l.text) }))
  const rawText = lines.map((l) => l.text).join('')
  if (!rawText || rawText.length < 8) return { refineState: 'done', sentences: [], doubts: [] }
  const hash = crypto.createHash('md5').update(rawText).digest('hex')
  // 缓存：补录追加后 rawText 变 → 哈希变 → 增量重跑
  try {
    const c = await db.collection('refine_cache').doc(hash).get()
    if (c && c.data) return c.data
  } catch (e) {}

  const blanks = event.blanks || []
  const blankLine = blanks.length ? `禁提话题：${blanks.join('、')}。` : ''
  const peopleLine = ((event && event.people) || []).length ? `熟人名字（优先用这些写法）：${event.people.join('、')}。` : ''
  const ctx = `已知冰山标题（不重复追问）：${(event.knownTitles || []).join('、') || '无'}。${blankLine}${peopleLine}`
  const linesText = lines.map((l) => `[${l.n}] ${l.text}`).join('\n')
  const sentenceCount = rawText.split(/[。！？!?；;]/).filter(Boolean).length
  const short = sentenceCount < 3 || rawText.length < 40

  let doubts = []
  let sentences = []
  try {
    // step1 事件+疑点提取（不猜词/不算新数/不仲裁）
    const r1 = await chat([{ role: 'user', content: `你是史料核对员。只读下面转写原文，零新增信息。逐行归置不许漏行；每个事实带 evidence{line,quote}（quote 必须是该行连续原文）；听写不通的词/算术矛盾/年份冲突 → doubts{kind:word|number|year,line,original,candidates}，不猜词不算新数。${ctx}\n严格JSON：{"events":[{"line":0,"quote":"","certainty":"confirmed|uncertain"}],"doubts":[]}\n转写：\n${linesText}` }])
    const p1 = parseJSON(r1.choices[0].message.content)
    doubts = (p1.doubts || []).map((d, i) => ({ id: 'd' + i, kind: d.kind || 'word', line: d.line || 0, original: d.original || '', candidates: d.candidates || [], status: 'open', at: Date.now() }))

    // step2 按用户选的"AI文字梳理风格"写稿（鲸鱼主菜单设置）
    const style = event.style || 'light'
    if (style === 'verbatim') {
      // 忠实原文：不整理，逐字成句
      sentences = lines.map((l, i) => ({ id: 's' + i, text: l.text, evidence: [{ line: l.n, quote: l.text }], dialect: [], state: 'unset', source: 'raw' }))
    } else {
      const rule = style === 'written'
        ? '在保留全部事实与第一人称的前提下，调整语序、把口语顺成书面语；仍禁止补全未说内容、禁止替换方言词（方言保留列入 dialect）。'
        : '只允许去赘词/顺语序/断句；禁止替换方言词、删口头禅、补全未说内容、书面腔改写。方言/口头禅保留并列入 dialect。'
      const r2 = await chat([{ role: 'user', content: `你是裱糊匠不是作者。${rule}留白处标"[此处留白]"。年份双说法照原话保留。第一人称妈妈口吻。逐句 evidence{line,quote}。${ctx}\n严格JSON：{"sentences":[{"text":"","evidence":[{"line":0,"quote":""}],"dialect":[]}]}\n转写：\n${linesText}` }])
      const p2 = parseJSON(r2.choices[0].message.content)
      sentences = (p2.sentences || []).map((s, i) => ({ id: 's' + i, text: s.text || '', evidence: s.evidence || [], dialect: s.dialect || [], state: 'unset', source: 'ai-light' }))
    }

    // 短句跳过审查修订
    if (!short && sentences.length) {
      // step3 独立审查（只挑错不改写）
      const r3 = await chat([{ role: 'user', content: `你是独立审查员，只挑错不改写。逐句四字段 supported/readable/attribution_correct/evidence_complete + issues。引用存在≠事实被支持；不得要求编造原文没有的背景。\n严格JSON：{"issues":[{"index":0,"problem":""}]}\n原文：\n${linesText}\n成稿：${sentences.map((s, i) => `[${i}] ${s.text}`).join('\n')}` }])
      const p3 = parseJSON(r3.choices[0].message.content)
      const bad = (p3.issues || []).map((x) => x.index)
      if (bad.length) {
        // step4 修订（只输出有问题的句子）
        const r4 = await chat([{ role: 'user', content: `只修订被指出问题的句子，其余原样。问题：${JSON.stringify(p3.issues)}。零新增信息。\n严格JSON：{"edits":[{"index":0,"text":""}]}\n原文：\n${linesText}\n成稿：${sentences.map((s, i) => `[${i}] ${s.text}`).join('\n')}` }])
        const p4 = parseJSON(r4.choices[0].message.content)
        for (const e of (p4.edits || [])) if (sentences[e.index]) sentences[e.index].text = e.text
      }
    }
  } catch (e) {
    console.error('refine failed', e)
    return { refineState: 'failed', sentences: [], doubts: [] }   // 失败不阻塞，逐字照常用；不自动重试收费调用
  }

  const v = validate(sentences, lines)
  if (v.rejected) return { refineState: 'failed', sentences: [], doubts: [] }   // [AI补充] 整稿拒绝
  const result = { refineState: 'done', sentences: v.sentences, doubts }
  try { await db.collection('refine_cache').doc(hash).set({ data: result }) } catch (e) {}
  return result
}