// scripts/mp.js — 人生海海 · 小程序自动化（统一 JS 工具链；mp.sh 仅为 node 引导壳）
// 用法：node scripts/mp.js <refresh|push|watch|upload|cloud|status> [...]
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { spawnSync, spawn, execSync } = require('child_process')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const CLI = process.env.WXDEV_CLI || '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
const CLOUD_ENV = process.env.MP_CLOUD_ENV || 'lifememo-d7gopzprfc266a543'
const VERSION_FILE = path.join(PROJECT_ROOT, '.mp-version')

const tty = process.stdout.isTTY
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s)
const ok = (m) => console.log(`${c('0;32', '✔')} ${m}`)
const info = (m) => console.log(`${c('0;34', '›')} ${m}`)
const warn = (m) => console.error(`${c('0;33', '!')} ${m}`)
const err = (m) => console.error(`${c('0;31', '✘')} ${m}`)
const die = (m) => { err(m); process.exit(1) }

function runCli (args) {
  const r = spawnSync(CLI, [...args, '--lang', 'zh'], { cwd: PROJECT_ROOT, encoding: 'utf8' })
  const out = ((r.stdout || '') + (r.stderr || '')).split('\n')
    .filter((l) => !/DeprecationWarning|trace-deprecation|--electron/.test(l)).join('\n')
  return { code: r.status == null ? -1 : r.status, out }
}
function checkCli () {
  if (!fs.existsSync(CLI)) die(`找不到微信开发者工具 CLI：${CLI}\n请确认已安装微信开发者工具，或设置 WXDEV_CLI。`)
}
function checkLogin () {
  info('检查登录态…')
  const { out } = runCli(['islogin'])
  if (/"login"\s*:\s*true/.test(out)) ok('已登录')
  else { err('未登录微信开发者工具'); console.log(out); die(`请打开微信开发者工具扫码登录，或运行：${CLI} login`) }
}
function currentVersion () {
  return fs.existsSync(VERSION_FILE) ? fs.readFileSync(VERSION_FILE, 'utf8').trim() : '0.0.0'
}
function bumpVersion (cur) {
  const m = cur.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/)
  if (!m) { warn(`版本号 '${cur}' 格式异常，回退为 0.0.1`); return '0.0.1' }
  return `${m[1]}.${m[2] || 0}.${(parseInt(m[3] || '0', 10) + 1)}`
}
function buildDesc () {
  const sh = (cmd) => { try { return execSync(cmd, { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim() } catch (e) { return '' } }
  const subject = sh('git log -1 --pretty=%s') || '无提交记录'
  const hash = sh('git rev-parse --short HEAD') || '-------'
  const dirty = sh('git status --porcelain') ? '（含未提交改动）' : ''
  return `${subject} [${hash}]${dirty}`.slice(0, 180)
}

function cmdStatus () {
  console.log(`${c('0;34', '人生海海 · 环境体检')}\n`)
  console.log(`${c('2', '项目路径')}   ${PROJECT_ROOT}`)
  fs.existsSync(path.join(PROJECT_ROOT, '.git')) ? ok('git 仓库存在') : warn('非 git 仓库')
  console.log(`${c('2', '微信 CLI')}   ${CLI}`)
  checkCli(); ok('CLI 可执行')
  console.log(`${c('2', 'node')}       ${process.execPath} ${process.version}`)
  console.log(`${c('2', '云环境')}     ${CLOUD_ENV}`)
  console.log(`${c('2', '当前版本')}   ${currentVersion()}`)
  console.log(''); checkLogin(); console.log('')
  info('appid / libVersion：')
  const cfg = fs.readFileSync(path.join(PROJECT_ROOT, 'project.config.json'), 'utf8')
  for (const l of cfg.split('\n')) if (/"appid"|"libVersion"/.test(l)) console.log('  ' + l.trim())
}
function cmdRefresh () {
  checkCli()
  info('编译并刷新模拟器（生成预览二维码）…')
  const { code, out } = runCli(['preview', '--project', PROJECT_ROOT, '--qr-format', 'terminal'])
  console.log(out)
  if (code === 0) { ok('编译完成，模拟器已刷新'); info('用微信扫描上方二维码可在手机上打开预览版') }
  else err(`编译失败（退出码 ${code}）`)
  return code
}
function cmdPush () {
  checkCli()
  info('推送到手机真机（自动预览）…')
  const { code, out } = runCli(['auto-preview', '--project', PROJECT_ROOT])
  console.log(out)
  if (code === 0) { ok('已推送到真机'); info('之后每次改动运行本命令即可免扫码刷新手机端') }
  else {
    warn('自动预览未成功')
    console.log('\n首次使用需要在手机上授权一次：\n  1. 运行 ./scripts/mp.sh refresh\n  2. 微信扫码打开预览版\n  3. 手机端「自动预览」点允许/记住\n  4. 再运行 ./scripts/mp.sh push\n')
  }
  return code
}
function cmdUpload (explicit) {
  checkCli(); checkLogin()
  const cur = currentVersion()
  const next = explicit || bumpVersion(cur)
  info(explicit ? `使用指定版本号：${next}` : `版本号 ${cur} → ${next}`)
  const desc = process.env.MP_UPLOAD_DESC || buildDesc()
  info(`版本描述：${desc}`)
  const { code, out } = runCli(['upload', '--project', PROJECT_ROOT, '--version', next, '--desc', desc])
  console.log(out)
  if (code === 0) {
    fs.writeFileSync(VERSION_FILE, next)
    ok(`上传成功，版本号 ${next} 已记录到 .mp-version`)
    console.log(`\n${c('0;33', '下一步需要你在微信公众平台手动操作：')}\n  https://mp.weixin.qq.com → 版本管理 → 开发版本\n  找到「${next}」，点「提交审核」。审核通过后才能正式发布。\n\n上传体验版本身不影响线上用户，可以放心反复上传。`)
  } else err(`上传失败（退出码 ${code}），版本号未变更`)
  return code
}
function cmdCloud (names) {
  checkCli(); checkLogin()
  let list = names
  if (!list.length) {
    list = fs.readdirSync(path.join(PROJECT_ROOT, 'cloudfunctions'), { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => e.name)
  }
  if (!list.length) die('cloudfunctions/ 下没有找到任何云函数')
  console.log(`\n${c('0;31', '⚠️  云函数部署会立即生效于线上环境，没有预览缓冲。')}\n  环境：${CLOUD_ENV}\n  函数：${list.join(' ')}`)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.question(`${c('0;33', '确认部署？输入 yes 继续：')}`, (ans) => {
    rl.close()
    if (ans !== 'yes') { warn('已取消'); process.exit(1) }
    info('部署中（云端 npm install，可能需要 1-3 分钟）…')
    const { code, out } = runCli(['cloud', 'functions', 'deploy', '--project', PROJECT_ROOT, '--env', CLOUD_ENV, '--names', ...list, '--remote-npm-install'])
    console.log(out)
    if (code === 0) ok(`云函数部署完成：${list.join(' ')}`)
    else err(`部署失败（退出码 ${code}）`)
    process.exit(code)
  })
}
function cmdWatch (args) {
  checkCli()
  info('启动文件监听（Ctrl+C 退出）')
  const child = spawn(process.execPath, [path.join(__dirname, 'watch.js'), ...args], { cwd: PROJECT_ROOT, stdio: 'inherit' })
  child.on('close', (code) => process.exit(code == null ? 0 : code))
}
function usage () {
  console.log(`${c('0;34', '人生海海 · 小程序自动化')}

  ${c('0;32', 'refresh')}            编译 + 刷新模拟器 + 终端打印预览二维码
  ${c('0;32', 'push')}               推送到手机真机（自动预览，免扫码刷新）
  ${c('0;32', 'watch')}  [--push] [--cloud]
                     监听改动自动刷新；--push 同时推真机，--cloud 自动部署云函数
  ${c('0;32', 'upload')} [版本号]     上传体验版（默认自动递增 patch）
  ${c('0;32', 'cloud')}  [函数名...]  部署云函数（默认全部）
  ${c('0;32', 'status')}             环境体检

环境变量：WXDEV_CLI / MP_CLOUD_ENV / MP_UPLOAD_DESC
项目根：${PROJECT_ROOT}`)
}

const [sub, ...rest] = process.argv.slice(2)
switch (sub) {
  case 'refresh': process.exit(cmdRefresh()); break
  case 'push': case 'phone': process.exit(cmdPush()); break
  case 'upload': case 'release': process.exit(cmdUpload(rest[0])); break
  case 'cloud': case 'cloudfn': cmdCloud(rest); break
  case 'watch': cmdWatch(rest); break
  case 'status': case 'doctor': cmdStatus(); break
  case undefined: case '-h': case '--help': case 'help': usage(); break
  default: err(`未知命令：${sub}`); console.log(''); usage(); process.exit(1)
}