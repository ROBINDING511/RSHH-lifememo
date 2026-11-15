// utils/assets.js — 素材加载器
// 本地包内有默认素材（可立即渲染）；海域色变体冰山等更多素材走云存储 CDN，
// 首次下载后缓存到本地，之后离线可用。
// CDN_PREFIX 在部署后替换为云存储下载地址前缀（见 docs/DEPLOY.md）

const CDN_PREFIX = '' // 例：https://xxx.tcb.qcloud.la/assets/
const CACHE_DIR = `${wx.env.USER_DATA_PATH}/assets`
const fsm = wx.getFileSystemManager()

// 本地兜底（包内）
const LOCAL = {
  small: '/images/watercolor/iceberg-小型.png',
  medium: '/images/watercolor/iceberg-中型.png',
  large: '/images/watercolor/iceberg-大型.png',
  peak: '/images/watercolor/iceberg-尖峰型.png',
  platform: '/images/watercolor/iceberg-平台型.png'
}

// CDN 命名（上传 cdn-upload 目录后自动对应）
function cdnName (size, zone) {
  const typeMap = { small: '小型', medium: '中型', large: '大型' }
  const zoneMap = { 童年: '童年', 结婚: '结婚', 孩子: '孩子', 工作: '工作', 晚年: '晚年' }
  const z = zoneMap[zone]
  if (z && typeMap[size]) return `watercolor/iceberg-${typeMap[size]}-${z}.png`
  return null
}

const cache = {}

function loadIceberg (size, zone) {
  // 1) CDN 命中且已缓存 → 本地缓存路径
  const name = CDN_PREFIX ? cdnName(size, zone) : null
  if (name && cache[name]) return cache[name]
  if (name) {
    const local = `${CACHE_DIR}/${name}`
    try {
      fsm.accessSync(local)
      cache[name] = local
      return local
    } catch (e) { /* 未缓存 */ }
  }
  // 2) 兜底：包内默认冰山
  return LOCAL[size] || LOCAL.medium
}

// 后台预下载当前海域的冰山素材（非阻塞，失败静默）
function prefetch (zones) {
  if (!CDN_PREFIX) return
  try { fsm.mkdirSync(CACHE_DIR, true) } catch (e) {}
  zones.forEach((z) => {
    ;['small', 'medium', 'large'].forEach((s) => {
      const name = cdnName(s, z.name)
      if (!name) return
      const local = `${CACHE_DIR}/${name}`
      try { fsm.accessSync(local); return } catch (e) {}
      wx.downloadFile({
        url: `${CDN_PREFIX}/${name}`,
        success: (res) => {
          try { fsm.saveFileSync(local, res.tempFilePath) ; cache[name] = local } catch (e) {}
        }
      })
    })
  })
}

module.exports = { loadIceberg, prefetch, LOCAL }
