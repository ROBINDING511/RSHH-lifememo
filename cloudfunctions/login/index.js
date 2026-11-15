// cloudfunctions/login/index.js
// 静默登录：返回 openid + 流式 ASR 配置
// key 从云函数环境变量读取（部署后在云开发控制台配置，绝不写进代码）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  return {
    openid: OPENID,
    asrKey: process.env.DASHSCOPE_API_KEY || '',
    asrUrl: process.env.ASR_WS_URL || 'wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime',
    asrModel: process.env.ASR_MODEL || 'qwen-audio-3.0-realtime-plus'
  }
}
