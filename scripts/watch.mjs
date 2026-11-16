#!/usr/bin/env node
/**
 * 人生海海 · 文件监听自动刷新
 *
 * 监听 miniprogram/ 与 cloudfunctions/ 的源码改动，防抖后触发编译刷新。
 * 由 scripts/mp.sh watch 调用，也可直接 node scripts/watch.mjs 运行。
 *
 * 参数：
 *   --push     改动后同时推送到手机真机（auto-preview）
 *   --cloud    cloudfunctions/ 改动后自动部署对应云函数（慎用，直接影响线上）
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const MP_SH = path.join(__dirname, 'mp.sh');

const CLI = process.env.WXDEV_CLI || '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const CLOUD_ENV = process.env.MP_CLOUD_ENV || 'lifememo-d7gopzprfc266a543';

const argv = new Set(process.argv.slice(2));
const DO_PUSH = argv.has('--push');
const DO_CLOUD = argv.has('--cloud');

// 防抖窗口：编辑器保存常触发多次事件，等安静下来再编译
const DEBOUNCE_MS = Number(process.env.WATCH_DEBOUNCE || 900);

// ── 监听范围 ───────────────────────────────────────────────────────
const WATCH_DIRS = ['miniprogram', 'cloudfunctions'].filter((d) =>
  fs.existsSync(path.join(PROJECT_ROOT, d))
);

// 只关心源码；node_modules 与构建产物一律忽略
const SOURCE_EXT = new Set([
  '.js', '.ts', '.json', '.wxml', '.wxss', '.wxs',
  '.scss', '.less', '.css', '.png', '.jpg', '.jpeg',
  '.gif', '.svg', '.webp',
]);

const IGNORE_SEGMENTS = [
  'node_modules', '.git', 'miniprogram_npm',
  'dist', 'build', '.DS_Store', '__tests__',
];

function shouldHandle(relPath) {
  if (!relPath) return false;
  const parts = relPath.split(path.sep);
  if (parts.some((p) => IGNORE_SEGMENTS.includes(p))) return false;
  const ext = path.extname(relPath).toLowerCase();
  if (!SOURCE_EXT.has(ext)) return false;
  // 忽略隐藏文件与编辑器临时文件
  const base = path.basename(relPath);
  if (base.startsWith('.') || base.endsWith('~')) return false;
  return true;
}

function whichCloudFn(relPath) {
  const parts = relPath.split(path.sep);
  if (parts[0] === 'cloudfunctions' && parts[1]) return parts[1];
  return null;
}

// ── 终端输出 ───────────────────────────────────────────────────────
const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const log = {
  ok:   (m) => console.log(`${c('0;32', '✔')} ${m}`),
  info: (m) => console.log(`${c('0;34', '›')} ${m}`),
  warn: (m) => console.log(`${c('0;33', '!')} ${m}`),
  err:  (m) => console.error(`${c('0;31', '✘')} ${m}`),
  dim:  (m) => console.log(c('2', m)),
};

const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

// ── 执行 CLI / 脚本 ────────────────────────────────────────────────
function run(args, { stream = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(args[0], args.slice(1), {
      cwd: PROJECT_ROOT,
      stdio: stream ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    if (!stream) {
      const collect = (d) => { out += d.toString(); };
      child.stdout?.on('data', collect);
      child.stderr?.on('data', collect);
    }
    child.on('error', (e) => {
      resolve({ code: -1, out: `${out}\n启动失败：${e.message}` });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? -1, out });
    });
  });
}

// 编译刷新：走 preview，让 IDE 重新构建并刷新模拟器
async function refresh(reason) {
  const t0 = Date.now();
  log.info(`[${ts()}] 编译刷新中… ${c('2', reason)}`);
  const r = await run([CLI, 'preview', '--project', PROJECT_ROOT, '--lang', 'zh']);
  const text = r.out || '';
  // 过滤 Electron 弃用告警
  const cleaned = text.split('\n').filter(
    (l) => !/DeprecationWarning|trace-deprecation|--electron/.test(l)
  ).join('\n');

  if (r.code === 0) {
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    // 提取包体积表，便于发现体积异常
    const sizeLine = cleaned.match(/TOTAL.*$/m);
    log.ok(`[${ts()}] 刷新完成（${sec}s）${sizeLine ? ' · ' + sizeLine[0].replace(/\s+/g, ' ').trim() : ''}`);
    const warn = cleaned.match(/(超过|exceed|警告|error|失败)/i);
    if (warn) log.warn(`CLI 输出中检测到关键字「${warn[0]}」，详情：\n${cleaned.trim().split('\n').slice(-12).join('\n')}`);
    return true;
  }
  log.err(`[${ts()}] 编译失败（退出码 ${r.code}）`);
  const tail = cleaned.trim().split('\n').slice(-20).join('\n');
  if (tail) console.log(c('2', tail));
  return false;
}

async function pushToPhone() {
  log.info(`[${ts()}] 推送真机…`);
  const r = await run([CLI, 'auto-preview', '--project', PROJECT_ROOT, '--lang', 'zh']);
  if (r.code === 0) {
    log.ok(`[${ts()}] 真机已刷新`);
    return true;
  }
  log.warn(`[${ts()}] 真机推送失败（首次需在手机端授权，详见 mp.sh push 提示）`);
  return false;
}

async function deployCloud(names) {
  const list = [...new Set(names)];
  log.warn(`[${ts()}] 部署云函数：${list.join(', ')} → ${CLOUD_ENV}`);
  const r = await run([
    CLI, 'cloud', 'functions', 'deploy',
    '--project', PROJECT_ROOT,
    '--env', CLOUD_ENV,
    '--names', ...list,
    '--remote-npm-install',
    '--lang', 'zh',
  ], { stream: true });
  if (r.code === 0) log.ok(`[${ts()}] 云函数部署完成`);
  else log.err(`[${ts()}] 云函数部署失败（退出码 ${r.code}）`);
}

// ── 防抖调度 ───────────────────────────────────────────────────────
let timer = null;
let pending = new Set();
let busy = false;
let queued = false;

function schedule(relPath) {
  pending.add(relPath);
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, DEBOUNCE_MS);
}

async function flush() {
  timer = null;
  const batch = [...pending];
  pending = new Set();
  if (batch.length === 0) return;

  if (busy) { queued = true; return; }
  busy = true;

  const cloudFns = batch.map(whichCloudFn).filter(Boolean);
  const summary = batch.length <= 3
    ? batch.map((p) => path.basename(p)).join(', ')
    : `${batch.length} 个文件（${batch.map((p) => path.basename(p)).slice(0, 3).join(', ')} …）`;

  const okRefresh = await refresh(summary);

  if (okRefresh && DO_PUSH) await pushToPhone();
  if (okRefresh && DO_CLOUD && cloudFns.length) await deployCloud(cloudFns);

  busy = false;
  if (queued) { queued = false; flush(); }
}

// ── 启动 ───────────────────────────────────────────────────────────
if (!fs.existsSync(CLI)) {
  log.err(`找不到微信开发者工具 CLI：${CLI}`);
  process.exit(1);
}

console.log('');
console.log(`${c('1', '人生海海 · 监听中')}`);
log.dim(`项目：${PROJECT_ROOT}`);
log.dim(`监听：${WATCH_DIRS.join(', ')}`);
log.dim(`防抖：${DEBOUNCE_MS}ms${DO_PUSH ? ' · 推送真机：开' : ''}${DO_CLOUD ? ' · 云函数自动部署：开' : ''}`);
if (DO_CLOUD) log.warn('云函数自动部署已开启：改动会直接作用于线上环境');
log.dim('按 Ctrl+C 停止');
console.log('');

const watchers = [];
for (const dir of WATCH_DIRS) {
  const abs = path.join(PROJECT_ROOT, dir);
  try {
    const w = fs.watch(abs, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = path.join(dir, filename);
      if (!shouldHandle(rel)) return;
      schedule(rel);
    });
    w.on('error', (e) => log.warn(`监听 ${dir} 出错：${e.message}`));
    watchers.push(w);
  } catch (e) {
    log.err(`无法监听 ${dir}：${e.message}`);
  }
}

if (watchers.length === 0) {
  log.err('没有任何目录可监听，退出');
  process.exit(1);
}

const shutdown = () => {
  console.log('');
  log.info('停止监听');
  if (timer) clearTimeout(timer);
  watchers.forEach((w) => w.close());
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
