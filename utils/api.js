// utils/api.js — 数据层：云数据库 + 云函数
// 集合：icebergs（回忆冰山）、zones（海域）
// 安全规则：仅创建者可读写（云开发默认 _openid 隔离）

const db = () => wx.cloud.database()
const _ = () => wx.cloud.database().command

// 冰山大小映射：字数越多冰山越高
function icebergSizeOf (text) {
  const n = (text || '').length
  if (n <= 20) return 'small'
  if (n <= 60) return 'medium'
  return 'large'
}

const SIZE_FILE = {
  small: '/images/watercolor/iceberg-小型.png',
  medium: '/images/watercolor/iceberg-中型.png',
  large: '/images/watercolor/iceberg-大型.png'
}

// ---------- 海域 ----------
async function listZones () {
  const res = await db().collection('icebergs_zones').orderBy('sortIndex', 'asc').get()
  return res.data
}

async function ensureZone (name, color) {
  const exist = await db().collection('icebergs_zones').where({ name }).get()
  if (exist.data.length) return exist.data[0]
  const count = (await db().collection('icebergs_zones').count()).total
  const add = await db().collection('icebergs_zones').add({
    data: { name, color: color || '#4A9BD1', sortIndex: count, createdAt: Date.now() }
  })
  return { _id: add._id, name, color }
}

// ---------- 冰山（回忆） ----------
async function listIcebergs () {
  const res = await db().collection('icebergs').where({ deleted: db().command.neq(true) })
    .orderBy('memoryTime', 'desc').limit(200).get()
  return res.data
}

async function listRecycled () {
  const res = await db().collection('icebergs').where({ deleted: true })
    .orderBy('deletedAt', 'desc').limit(200).get()
  return res.data
}

async function createIceberg (payload) {
  // payload: { text, audioPath, photos, timeValue, zoneName, icon, title }
  let audioFileID = ''
  if (payload.audioPath) {
    const up = await wx.cloud.uploadFile({
      cloudPath: `voices/${Date.now()}_${Math.floor(Math.random() * 1000)}.wav`,
      filePath: payload.audioPath
    })
    audioFileID = up.fileID
  }
  const photoIDs = []
  for (const p of payload.photos || []) {
    const up = await wx.cloud.uploadFile({
      cloudPath: `photos/${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`,
      filePath: p
    })
    photoIDs.push(up.fileID)
  }
  const zone = await ensureZone(payload.zoneName)
  const size = icebergSizeOf(payload.text)
  const rec = {
    title: payload.title || payload.text.slice(0, 12),
    text: payload.text,
    audioFileID,
    photos: photoIDs,
    icon: payload.icon || '',
    size,
    zoneId: zone._id,
    zoneName: zone.name,
    memoryTime: payload.timeValue,
    deleted: false,
    createdAt: Date.now()
  }
  const add = await db().collection('icebergs').add({ data: rec })
  return Object.assign({ _id: add._id }, rec)
}

async function updateIceberg (id, patch) {
  return db().collection('icebergs').doc(id).update({ data: patch })
}

async function removeIceberg (id) {
  // 软删除：冰山融化成云
  return updateIceberg(id, { deleted: true, deletedAt: Date.now() })
}

async function restoreIceberg (id) {
  // 云下雨，冰山回到海面
  return updateIceberg(id, { deleted: false, restoredAt: Date.now() })
}

// ---------- 云函数 ----------
async function analyzeMemory (text) {
  const res = await wx.cloud.callFunction({
    name: 'analyze',
    data: { text }
  })
  return res.result
}

function getAsrConfig () {
  const app = getApp()
  return app.globalData.asrConfig
}

module.exports = {
  icebergSizeOf, SIZE_FILE,
  listZones, ensureZone,
  listIcebergs, listRecycled, createIceberg, updateIceberg, removeIceberg, restoreIceberg,
  analyzeMemory, getAsrConfig
}
