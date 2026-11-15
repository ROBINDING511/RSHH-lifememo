# 人生海海 · 部署上线指南

> 一次完整的部署约 30–60 分钟。按顺序做，每步都有检查点。

## 0. 你需要准备的东西

- [ ] 微信小程序 **AppID**（个人主体即可，mp.weixin.qq.com 注册）
- [ ] 微信开发者工具（已登录）
- [ ] 百炼 **Token Plan API Key**（`sk-sp-` 开头）——用你已有的那个即可

## 1. 导入项目

1. 打开微信开发者工具 → 导入项目 → 选择本目录（`人生海海/`）
2. AppID 填你的（同时把 `project.config.json` 里的 `wx0000000000000000` 替换掉）
3. 后端服务选择「微信·云开发」

## 2. 开通云开发

1. 工具栏「云开发」→ 开通 → 创建环境（按量付费，家庭用量几乎为 0）
2. 记下**环境 ID**（形如 `cloud1-2gxxxx`）
3. 替换 `miniprogram/app.js` 里的 `YOUR-CLOUD-ENV-ID`

### 2.1 创建数据库集合（云开发控制台 → 数据库）

| 集合名 | 用途 | 权限 |
|---|---|---|
| `icebergs` | 回忆冰山 | **仅创建者可读写** |
| `icebergs_zones` | 海域 | 仅创建者可读写 |

## 3. 部署云函数（含 key 配置，重点）

对 `login`、`analyze`、`transcribe` 各执行一次：

1. 右键云函数目录 → **上传并部署：所有文件**（node_modules 已在本地装好，全量上传最稳）
2. 部署完成后，在 **云开发控制台 → 云函数 → 配置 → 环境变量** 添加：

**login 函数：**
```
DASHSCOPE_API_KEY = sk-sp-你的TokenPlanKey
ASR_WS_URL = wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime
ASR_MODEL = qwen-audio-3.0-realtime-plus
```

**analyze 函数：**
```
DASHSCOPE_API_KEY = sk-sp-你的TokenPlanKey
DASHSCOPE_BASE_URL = https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
DASHSCOPE_MODEL = qwen4-max-preview
```

**transcribe 函数（兜底转写，真机流式连不上时用）：**
```
DASHSCOPE_API_KEY = sk-sp-你的TokenPlanKey
```
> ⚠️ **超时设置**：云开发控制台 → 云函数 → transcribe → 函数配置 → 超时时间。
> - 代码已改为**按平台真实剩余时间自适应**（`context.getRemainingTimeInMillis()`），
>   超时设多少都不会被平台在收尾前强杀；建议仍设 **120 秒**以支持最长 55s 音频从容转写。
> - 实测坑：微信开发者工具的 `cli cloud functions deploy` **只上传代码，不应用 `config.json`
>   里的 `timeout`**（部署后云端超时不变）。所以超时**必须在控制台手动设**，`config.json`
>   仅作为版本控制里的意图记录，不要指望它自动生效。

> ⚠️ key 只存在于环境变量里，源代码中没有任何密钥。泄露时在控制台一键换掉即可。

## 4. 上传美术素材到云存储（可选但推荐）

包内已带默认冰山素材（可直接跑）。想要 5 个海域的彩色冰山变体：

1. 云开发控制台 → 存储 → 新建文件夹 `assets/`
2. 把本项目 `cdn-upload/` 目录下的 `watercolor/`、`misc/` 整个拖进去上传
3. 拿到下载地址前缀（形如 `https://xxx.tcb.qcloud.la/assets`）
4. 替换 `miniprogram/utils/assets.js` 里的 `CDN_PREFIX`

## 5. 域名白名单（正式版需要）

微信公众平台 → 开发管理 → 开发设置 → 服务器域名：

- **socket 合法域名**：`wss://token-plan.cn-beijing.maas.aliyuncs.com`

（开发阶段可在开发者工具勾选「不校验合法域名」先跑通）

## 6. 真机测试清单

- [ ] 首次进入出现 4 步引导
- [ ] 长按鲸鱼 → 授权麦克风 → 说话 → **文字边说边跳出来**
- [ ] 60 秒到点自动停 / 最后 10 秒倒计时
- [ ] 松开 → 预览卡片 → 时间/海域选项正确出现（AI 分析生效）
- [ ] 发布 → 冰山入海 → 点击冰山能看详情、听原声
- [ ] 详情页放标记（icon）、化成云
- [ ] 云朵页 → 落回海面（恢复）
- [ ] 时间轴按年份展示

## 7. 提审与发布

1. 完善小程序信息（名称：人生海海；类目与隐私指引见 `docs/审核材料.md`）
2. 开发者工具 → 上传 → 填版本号 1.0.0
3. 公众平台 → 版本管理 → 提交审核（审核话术也在 `docs/审核材料.md`）
4. 审核通过 → 发布 → 搜索「人生海海」→ 发给妈妈 🌊

## 常见问题

| 现象 | 处理 |
|---|---|
| 说话没有字跳出来 | 开发版：确认手机已开调试模式；正式版：检查 socket 域名白名单。流式失败会自动走 transcribe 云函数兜底（松手后显示"正在整理您说的话…"） |
| 提示"语音服务未就绪" | login 函数没部署成功或 key 无效 |
| 兜底转写也没文字 | transcribe 函数未部署 / 环境变量没配 / 超时时间没改成 120 秒 |
| 发布时选不到海域 | analyze 函数环境变量未配置（有降级默认值，不阻塞） |
| 语音识别报 401 | key 与端点不匹配：sk-sp- 前缀必须配 token-plan 专属 URL |
