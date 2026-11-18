// utils/prompts.js — 回忆提示脚手架：一次一个问题，替代空白页（借鉴 Storyworth/Meminto/Storii）
const BANK = {
  童年: ['小时候最香的味道是什么？', '小时候最好玩的游戏是什么？', '小时候最怕什么？', '第一件记得清楚的事是什么？', '小时候谁最疼你？'],
  少年: ['上学时最好的朋友是谁？', '学生时代最得意的一件事？', '第一次离开家是什么时候？', '上学路上印象最深的是什么？'],
  青年: ['第一份工资买了什么？', '第一次出远门去了哪？', '年轻时最拼的一件事？', '和爱人第一次见面是什么样？'],
  中年: ['孩子出生那天你在想什么？', '家里最难的那段日子怎么过来的？', '最骄傲的一件家事？', '有没有一句一直想对家人说的话？'],
  晚年: ['现在最想念谁？', '这辈子最庆幸的一个决定？', '想给当年的自己说句什么？', '最近一次开心是因为什么？'],
  通用: ['今天有什么想记下来的？', '最近想起的一件旧事？', '有没有一张老照片想讲讲？', '此刻最想对谁说句话？']
}
function pick (stageKey, exclude) {
  const pool = (BANK[stageKey] || []).concat(BANK.通用)
  const fresh = pool.filter((q) => q !== exclude)
  const list = fresh.length ? fresh : pool
  return list[Math.floor(Math.random() * list.length)]
}
module.exports = { BANK, pick }