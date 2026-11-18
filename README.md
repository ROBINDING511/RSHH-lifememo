# 人生海海 · LifeSea

一个面向长辈（妈妈辈）的**语音回忆记录**微信小程序。核心隐喻：**海洋 = 人生，冰山 = 一段回忆，鲸鱼「杭航」= 孩子**。
长辈按住说话，语音实时转文字，确认后"化成冰山"落进属于自己的人生之海；回忆可回听原声、可补录、可拖拽换海、删掉的化成云（5 天后飘散）。

> 适老化优先：大字号、高对比、大触控目标、微信式按住说话、失败必落草稿、尊重隐私（年纪可只给年龄/年份）。

## 功能
- **按住说话 + 流式转写**：0 延迟弹出实时字幕，松手发送、上滑取消；录音保留原声。
- **人生之海（2D 滚地球）**：海向四面八方扩展，拖动如滚球；人生阶段（童年/少年/…可自定义片数/名字/边界）放射分布，海色随区域晕染；浪轻轻动。
- **冰山 = 回忆**：不限数量追加；长按拖拽换海；点按进详情；详情可听原声、放标记、化成云、**继续说/补录**。
- **人生节点 = 海的开端**：加节点=开新海，删节点=合并海；支持语音设置（"童年到18岁"/"30岁孩子出生"）。
- **复核卡**：改字、配照片、选海（什么时候==哪片海，只选一次）、没说完按住继续说。
- **云朵回收站**：5 天后飘散（永久删除），倒计时明示，可提前落回海面。
- **引导页**：微信式分步 + 年纪三选一（生日/年龄/出生年，可跳过）。

## 技术栈
- 微信小程序原生（WXML/WXSS/JS），云开发（云函数 + 云存储 + 云数据库）。
- 实时 ASR：阿里百炼 Realtime（`qwen-audio-3.0-realtime-plus`，WebSocket）；兜底转写云函数同模型。
- AI 建议（时间/海域/标题）：百炼 `qwen4-max`。
- 美术：image 模型生成的水彩插画（海/冰山/鲸鱼）+ CSS 动画（摆尾、浪、落下）。

## 目录
```
miniprogram/        小程序前端（pages: ocean/iceberg/timeline/recycle/stages + packageGuide 分包）
cloudfunctions/     analyze / login / transcribe
cloudrun/asr-relay/ 云托管 ASR 中转（可选）
scripts/            mp.sh（开发者工具联动）/ watch.mjs
docs/               设计稿与评审记录
```

## 快速开始
1. 微信开发者工具导入本目录（`project.config.json`，appid 需换成你自己的）。
2. 开通云开发，替换 `miniprogram/app.js` 与 `scripts/mp.sh` 中的云环境 ID。
3. 部署云函数 `login/analyze/transcribe`，并在云函数**环境变量**配置：
   - `DASHSCOPE_API_KEY`（百炼 key，**不要写进代码**）
   - `ASR_WS_URL`、`ASR_MODEL`（可选，默认百炼 Realtime）
4. 真机预览需在 mp 后台配置 **socket 合法域名** `wss://token-plan.cn-beijing.maas.aliyuncs.com`（或开调试模式）。
5. `./scripts/mp.sh status / refresh / watch --push / upload / cloud` 详见 `scripts/README.md`。

## 设计约定（适老化）
- 设计 token 集中在 `miniprogram/app.wxss`（CSS 变量），页面只引用变量。
- 正文 ≥34rpx、转写 48rpx+；触控 ≥88rpx；可点元素必有按压反馈。
- 关键信息用原生 view/text（随微信字体放大、读屏可达），不用 Canvas 画文字。
- 破坏性操作给"存下来"退路 + 二次确认；任何失败路径落草稿（`utils/draft.js`）。
- 校验：`node --check`、`docs/tools/xcheck_wxml_js.js`、`docs/tools/a11y_check.js`（WCAG 2.2 AA）。

## 开源
MIT License（见 LICENSE）。欢迎 issue / PR。
**注意**：仓库不含任何密钥；key 仅存在于云函数环境变量 / 本机环境变量。