# 小程序自动化脚本

让「和 WorkBuddy 一起改的代码」自动同步到小程序：改完即刷新，一条命令上传体验版。

依赖微信开发者工具自带的 CLI，无需额外安装任何工具。

---

## 快速开始

```bash
cd ~/Projects/人生海海

# 一次性体检：确认登录态、CLI、node、云环境都正常
./scripts/mp.sh status

# 日常开发：启动监听，改代码自动刷新
./scripts/mp.sh watch --push
```

`watch --push` 跑起来后保持终端不动，你在任何编辑器（或让我）改代码，
保存后约 1 秒自动编译，模拟器与手机真机同时刷新，全程不用扫码。
按 `Ctrl+C` 停止。

### 更省事：让 AI 代你开关

`watch` 是「开发时段」的前台进程，不是常驻服务——该在改代码时启动、改完关掉，
让它 7×24 挂着没意义（会一直占着微信 IDE、空耗资源）。

既然你是和 AI 一起改代码，这个进程完全可以由 AI 代开，你一个字都不用敲：

- 跟 AI 说**「开始改小程序」** → AI 在后台拉起 `watch --push`
- 跟 AI 说**「停」**或**「改完了」** → AI 关掉它

上面的命令行方式仍然保留，想自己开的时候随时可用。

---

## 命令一览

| 命令 | 作用 |
|---|---|
| `./scripts/mp.sh status` | 环境体检：项目路径、git、CLI、node、登录态、appid |
| `./scripts/mp.sh refresh` | 编译 + 刷新模拟器 + 终端打印预览二维码 |
| `./scripts/mp.sh push` | 推送到手机真机（自动预览，免扫码） |
| `./scripts/mp.sh watch [--push] [--cloud]` | 监听改动自动刷新 |
| `./scripts/mp.sh upload [版本号]` | 上传体验版，版本号默认自动递增 |
| `./scripts/mp.sh cloud [函数名...]` | 部署云函数，默认全部 |

---

## 各命令说明

### watch — 日常开发主力

```bash
./scripts/mp.sh watch          # 只刷新电脑模拟器
./scripts/mp.sh watch --push   # 模拟器 + 手机真机一起刷新（推荐）
./scripts/mp.sh watch --cloud  # 另外自动部署改动的云函数（慎用，见下）
```

行为细节：

- 监听 `miniprogram/` 与 `cloudfunctions/` 下的源码文件
- 自动忽略 `node_modules`、`.git`、`miniprogram_npm`、`dist`、隐藏文件、编辑器临时文件
- 防抖 900ms：连续保存多个文件只触发一次编译，不会编译风暴
- 编译期间的新改动会排队，等当前编译结束后再处理一次，不会丢改动
- 编译失败时会把 CLI 输出的最后 20 行打出来，方便定位语法错误

`--cloud` 会直接部署到线上云环境，没有预览缓冲，改坏了立即影响真实用户。
除非你明确知道自己在做什么，建议云函数仍用 `cloud` 命令手动部署。

### refresh — 手动刷新一次

```bash
./scripts/mp.sh refresh
```

除了刷新模拟器，还会在终端画出预览二维码，用微信扫一下就能在手机上打开。
二维码有时效，过期重跑一次即可。

### push — 真机免扫码刷新

```bash
./scripts/mp.sh push
```

把当前代码推送到手机上已打开的预览版并自动重载。
适合反复调真机效果（滚动、录音、字体渲染这类模拟器看不准的东西）。

**首次使用需要授权一次**：先跑 `refresh`，扫码在手机上打开预览版，
在手机端弹出的自动预览提示里点允许，之后 `push` 就能一直用了。
如果 `push` 失败，脚本会打印这段引导。

### upload — 上传体验版

```bash
./scripts/mp.sh upload            # 版本号自动递增：0.0.1 → 0.0.2
./scripts/mp.sh upload 1.2.0      # 指定版本号
```

版本描述自动取自最近一次 git 提交信息，形如：

```
适老化：app.wxss 建立 WCAG 2.2 AA 设计 token 体系 [ad0dada]（含未提交改动）
```

所以**上传前先 commit**，版本记录里才有可读的说明。
版本号存在 `.mp-version`（已 gitignore，各机器独立计数），只有上传成功才递增。

上传成功后，还需要你在微信公众平台手动提交审核：

> https://mp.weixin.qq.com → 版本管理 → 开发版本 → 找到该版本 → 提交审核

上传体验版不影响线上用户，可以放心反复上传。
想临时改描述：`MP_UPLOAD_DESC="修复录音权限问题" ./scripts/mp.sh upload`

### cloud — 部署云函数

```bash
./scripts/mp.sh cloud                 # 部署全部三个：analyze / login / transcribe
./scripts/mp.sh cloud login           # 只部署 login
./scripts/mp.sh cloud login analyze   # 部署多个
```

执行前会显示环境与函数名，要求输入 `yes` 确认 —— 因为部署立即生效于线上。

用了 `--remote-npm-install`：依赖在云端安装，不上传本地 `node_modules`。
你的三个云函数本地依赖合计 226MB，但只有 `wx-server-sdk` 和 `ws` 两个包，
云端安装既快又避免了微信云函数的体积上限问题。
首次部署或新增依赖时约需 1-3 分钟。

---

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `WXDEV_CLI` | `/Applications/wechatwebdevtools.app/Contents/MacOS/cli` | 微信开发者工具 CLI 路径 |
| `MP_CLOUD_ENV` | `lifememo-d7gopzprfc266a543` | 云环境 ID |
| `MP_UPLOAD_DESC` | 自动取 git 提交信息 | 覆盖上传时的版本描述 |
| `WATCH_DEBOUNCE` | `900` | 监听防抖毫秒数 |

---

## 常见问题

**编译失败 / 报语法错误**
`watch` 会打印 CLI 输出的尾部。也可以直接跑 `./scripts/mp.sh refresh` 看完整报错。
最常见的是 wxml 标签未闭合、json 多逗号。

**`未登录微信开发者工具`**
打开微信开发者工具扫码登录，或运行：
`/Applications/wechatwebdevtools.app/Contents/MacOS/cli login`

**`push` 一直失败**
首次需要手机端授权，见上文 `push` 一节。急用可以先 `refresh` 扫码，效果一样。

**改了文件但没触发刷新**
确认改的是 `miniprogram/` 或 `cloudfunctions/` 下的源码文件。
`.md`、`.txt`、`docs/` 里的文件被有意忽略，改文档不该触发编译。
如果确实漏了某种扩展名，在 `scripts/watch.mjs` 的 `SOURCE_EXT` 里补上。

**端口冲突 / IDE 未启动**
脚本会自动拉起 IDE。若 IDE 已用不同端口启动，先完全退出微信开发者工具再跑命令。

**主包体积**
当前 main 785 KB、packageGuide 254 KB，总 1.0 MB。微信主包上限 2 MB，
`refresh` 输出里能看到实时体积，接近上限时考虑拆分包。

---

## 实现说明

- `mp.sh` — Bash 入口，封装 CLI 调用；路径相对脚本自身解析，项目再移动也不失效
- `watch.mjs` — Node 文件监听，用内置 `fs.watch` 递归监听，不依赖 fswatch/watchman
- CLI 输出里的 Electron `DeprecationWarning` 已统一过滤
- `mp.sh` 被 `source` 时只加载函数不执行，便于单独测试内部逻辑
