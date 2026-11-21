// 风格实验室：20 版差异化 UI 供挑选（v=1..20）
Page({
  data: { v: 1, stages: [{ name: '起点', color: '#6E9CC0' }, { name: '孩子出生', color: '#F94830' }], nodes: [{ date: '2017年9月22日', name: '加入阿里巴巴' }] },
  onLoad (q) { this.setData({ v: Number(q.v) || 1 }) }
})
