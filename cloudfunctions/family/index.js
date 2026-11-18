// cloudfunctions/family/index.js — 家人协作：邀请码绑定 + 家人读海 + 反应回流 + 投喂问题
// 客户端 db 为创建者私有；家人访问一律经本函数校验绑定关系后放行。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function boundOwner (child) {
  const r = await db.collection('family_binds').where({ child }).limit(1).get()
  return r.data.length ? r.data[0].owner : null
}

// 首次使用自动建集合（云开发集合需存在才能读写）
async function ensureCols () {
  for (const c of ['family_invites', 'family_binds', 'family_reactions', 'family_questions']) {
    try { await db.createCollection(c) } catch (e) { /* 已存在 */ }
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const a = event.action
  try {
    await ensureCols()
    if (a === 'invite') {
      const code = String(Math.floor(100000 + Math.random() * 900000))
      await db.collection('family_invites').add({ data: { code, owner: OPENID, createdAt: Date.now() } })
      return { ok: true, code }
    }
    if (a === 'bind') {
      const r = await db.collection('family_invites').where({ code: String(event.code) }).limit(1).get()
      if (!r.data.length) return { ok: false, error: '邀请码不对' }
      const owner = r.data[0].owner
      if (owner === OPENID) return { ok: false, error: '不能绑定自己' }
      const exist = await db.collection('family_binds').where({ child: OPENID, owner }).count()
      if (!exist.total) await db.collection('family_binds').add({ data: { child: OPENID, owner, createdAt: Date.now() } })
      return { ok: true, owner }
    }
    if (a === 'list') {
      const owner = await boundOwner(OPENID)
      if (!owner || owner !== event.owner) return { ok: false, error: '未绑定' }
      const r = await db.collection('icebergs').where({ _openid: owner, deleted: _.neq(true) }).orderBy('createdAt', 'desc').limit(200).get()
      return { ok: true, data: r.data }
    }
    if (a === 'get') {
      const doc = await db.collection('icebergs').doc(event.id).get().catch(() => null)
      if (!doc || !doc.data) return { ok: false, error: '不存在' }
      const owner = await boundOwner(OPENID)
      if (doc.data._openid !== OPENID && owner !== doc.data._openid) return { ok: false, error: '无权' }
      return { ok: true, data: doc.data }
    }
    if (a === 'react') {
      const doc = await db.collection('icebergs').doc(event.id).get().catch(() => null)
      if (!doc || !doc.data) return { ok: false, error: '不存在' }
      const owner = await boundOwner(OPENID)
      if (owner !== doc.data._openid) return { ok: false, error: '未绑定' }
      await db.collection('family_reactions').add({ data: { owner, iceberg: event.id, child: OPENID, type: event.type, createdAt: Date.now() } })
      return { ok: true }
    }
    if (a === 'addQuestion') {
      const owner = await boundOwner(OPENID)
      if (!owner) return { ok: false, error: '未绑定' }
      await db.collection('family_questions').add({ data: { owner, child: OPENID, text: String(event.text).slice(0, 60), used: false, createdAt: Date.now() } })
      return { ok: true }
    }
    if (a === 'questions') {
      const r = await db.collection('family_questions').where({ owner: OPENID, used: false }).orderBy('createdAt', 'asc').limit(5).get()
      return { ok: true, data: r.data }
    }
    if (a === 'useQuestion') {
      await db.collection('family_questions').doc(event.id).update({ data: { used: true } })
      return { ok: true }
    }
    if (a === 'myReactions') {
      const r = await db.collection('family_reactions').where({ owner: OPENID }).orderBy('createdAt', 'desc').limit(20).get()
      return { ok: true, count: r.data.length, data: r.data }
    }
    return { ok: false, error: 'unknown action' }
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200) }
  }
}