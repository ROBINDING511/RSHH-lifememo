#!/usr/bin/env bash
#
# 人生海海 · 小程序自动化脚本
#
# 用法：
#   ./scripts/mp.sh refresh          编译 + 刷新模拟器 + 终端打印预览二维码
#   ./scripts/mp.sh push             推送到手机真机（自动预览，免扫码刷新）
#   ./scripts/mp.sh watch            监听改动，自动刷新（可加 --push / --cloud）
#   ./scripts/mp.sh upload           上传体验版（版本号自动递增）
#   ./scripts/mp.sh cloud [名字...]  部署云函数（不指定则部署全部）
#   ./scripts/mp.sh status           环境体检
#
# 被 source 时（测试用）不改变调用方的 shell 选项
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  set -uo pipefail
fi

# ── 路径解析（相对脚本自身，项目再移动也不失效）─────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

CLI="${WXDEV_CLI:-/Applications/wechatwebdevtools.app/Contents/MacOS/cli}"
CLOUD_ENV="${MP_CLOUD_ENV:-lifememo-d7gopzprfc266a543}"
VERSION_FILE="$PROJECT_ROOT/.mp-version"

# node：优先系统 PATH，回退到 WorkBuddy 托管版本
if command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
elif [ -x "$HOME/.workbuddy/binaries/node/versions/22.22.2/bin/node" ]; then
  NODE="$HOME/.workbuddy/binaries/node/versions/22.22.2/bin/node"
else
  NODE=""
fi

# ── 输出配色 ───────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_R=$'\033[0;31m'; C_G=$'\033[0;32m'; C_Y=$'\033[0;33m'
  C_B=$'\033[0;34m'; C_D=$'\033[2m'; C_X=$'\033[0m'
else
  C_R=""; C_G=""; C_Y=""; C_B=""; C_D=""; C_X=""
fi
ok()   { printf '%s✔%s %s\n' "$C_G" "$C_X" "$*"; }
info() { printf '%s›%s %s\n' "$C_B" "$C_X" "$*"; }
# warn 走 stderr：避免被 $(...) 命令替换捕获而污染返回值
warn() { printf '%s!%s %s\n' "$C_Y" "$C_X" "$*" >&2; }
err()  { printf '%s✘%s %s\n' "$C_R" "$C_X" "$*" >&2; }
die()  { err "$*"; exit 1; }

# CLI 输出里混着 Electron 的弃用告警，统一滤掉
run_cli() {
  "$CLI" "$@" --lang zh 2>&1 | grep -v -E 'DeprecationWarning|trace-deprecation|--electron'
  return "${PIPESTATUS[0]}"
}

check_cli() {
  [ -x "$CLI" ] || die "找不到微信开发者工具 CLI：$CLI
  请确认已安装微信开发者工具，或设置环境变量 WXDEV_CLI 指向 cli 可执行文件。"
}

check_login() {
  info "检查登录态…"
  local out
  out="$(run_cli islogin)"
  if echo "$out" | grep -q '"login"[[:space:]]*:[[:space:]]*true'; then
    ok "已登录"
  else
    err "未登录微信开发者工具"
    echo "$out"
    die "请打开微信开发者工具扫码登录，然后重试。或运行：$CLI login"
  fi
}

# ── 版本号管理 ─────────────────────────────────────────────────────
# 读当前版本，缺省 0.0.0；bump 后写回文件
current_version() {
  if [ -f "$VERSION_FILE" ]; then
    cat "$VERSION_FILE" | tr -d '[:space:]'
  else
    echo "0.0.0"
  fi
}

bump_version() {
  local cur="${1:-$(current_version)}" maj min pat
  # 接受 1~3 段数字，缺失的段补 0：1 → 1.0.0，1.2 → 1.2.0
  if [[ "$cur" =~ ^([0-9]+)(\.([0-9]+))?(\.([0-9]+))?$ ]]; then
    maj="${BASH_REMATCH[1]}"
    min="${BASH_REMATCH[3]:-0}"
    pat="${BASH_REMATCH[5]:-0}"
  else
    warn "版本号 '$cur' 格式异常，回退为 0.0.1"
    echo "0.0.1"
    return 0
  fi
  pat=$((pat + 1))
  echo "$maj.$min.$pat"
}

# 版本描述：最近提交信息 + 短 hash + 未提交改动提示
build_desc() {
  local subject hash dirty desc
  cd "$PROJECT_ROOT" || return 1
  subject="$(git log -1 --pretty=%s 2>/dev/null || echo '无提交记录')"
  hash="$(git rev-parse --short HEAD 2>/dev/null || echo '-------')"
  dirty=""
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    dirty="（含未提交改动）"
  fi
  desc="$subject [$hash]$dirty"
  # 微信版本描述长度上限 200，截断保护
  printf '%s' "${desc:0:180}"
}

# ── 子命令 ─────────────────────────────────────────────────────────

cmd_status() {
  printf '%s人生海海 · 环境体检%s\n\n' "$C_B" "$C_X"
  printf '%s项目路径%s   %s\n' "$C_D" "$C_X" "$PROJECT_ROOT"
  [ -d "$PROJECT_ROOT/.git" ] && ok "git 仓库存在" || warn "非 git 仓库"
  printf '%s微信 CLI%s   %s\n' "$C_D" "$C_X" "$CLI"
  check_cli && ok "CLI 可执行"
  printf '%snode%s       %s\n' "$C_D" "$C_X" "${NODE:-未找到（watch 功能不可用）}"
  [ -n "$NODE" ] && "$NODE" --version | sed "s/^/             /"
  printf '%s云环境%s     %s\n' "$C_D" "$C_X" "$CLOUD_ENV"
  printf '%s当前版本%s   %s\n' "$C_D" "$C_X" "$(current_version)"
  echo
  check_login
  echo
  info "appid / libVersion："
  cd "$PROJECT_ROOT" && grep -E '"appid"|"libVersion"' project.config.json | sed 's/^/  /'
}

cmd_refresh() {
  check_cli
  info "编译并刷新模拟器（生成预览二维码）…"
  local out rc
  out="$(run_cli preview --project "$PROJECT_ROOT" --qr-format terminal)"
  rc=$?
  # 二维码要原样打印，不能被过滤规则吃掉
  echo "$out"
  if [ $rc -eq 0 ]; then
    ok "编译完成，模拟器已刷新"
    info "用微信扫描上方二维码可在手机上打开预览版"
  else
    err "编译失败（退出码 ${rc}）"
  fi
  return $rc
}

cmd_push() {
  check_cli
  info "推送到手机真机（自动预览）…"
  local out rc
  out="$(run_cli auto-preview --project "$PROJECT_ROOT")"
  rc=$?
  echo "$out"
  if [ $rc -eq 0 ]; then
    ok "已推送到真机"
    info "之后每次改动运行本命令即可免扫码刷新手机端"
  else
    warn "自动预览未成功"
    cat <<EOF

首次使用需要在手机上授权一次：
  1. 运行 ./scripts/mp.sh refresh
  2. 用微信扫描终端里的二维码，在手机上打开预览版
  3. 在手机端弹出的「自动预览」提示里点允许 / 勾选记住
  4. 再运行 ./scripts/mp.sh push

若仍失败，可退回用 refresh 扫码方式，效果一样只是要扫一次。
EOF
  fi
  return $rc
}

cmd_upload() {
  check_cli
  check_login

  local cur next desc explicit="${1:-}"
  cur="$(current_version)"
  if [ -n "$explicit" ]; then
    next="$explicit"
    info "使用指定版本号：$next"
  else
    next="$(bump_version "$cur")"
    info "版本号 $cur → $next"
  fi

  desc="${MP_UPLOAD_DESC:-$(build_desc)}"
  info "版本描述：$desc"

  cd "$PROJECT_ROOT" || die "无法进入项目目录"
  local out rc
  out="$(run_cli upload --project "$PROJECT_ROOT" --version "$next" --desc "$desc")"
  rc=$?
  echo "$out"

  if [ $rc -eq 0 ]; then
    echo "$next" > "$VERSION_FILE"
    ok "上传成功，版本号 $next 已记录到 .mp-version"
    cat <<EOF

${C_Y}下一步需要你在微信公众平台手动操作：${C_X}
  https://mp.weixin.qq.com  →  版本管理  →  开发版本
  找到「${next}」，点「提交审核」。审核通过后才能正式发布。

上传体验版本身不影响线上用户，可以放心反复上传。
EOF
  else
    err "上传失败（退出码 ${rc}），版本号未变更"
  fi
  return $rc
}

cmd_cloud() {
  check_cli
  check_login

  cd "$PROJECT_ROOT" || die "无法进入项目目录"
  local names=()
  if [ "$#" -gt 0 ]; then
    names=("$@")
  else
    for d in cloudfunctions/*/; do
      [ -d "$d" ] || continue
      names+=("$(basename "$d")")
    done
  fi

  [ "${#names[@]}" -gt 0 ] || die "cloudfunctions/ 下没有找到任何云函数"

  cat <<EOF

${C_R}⚠️  云函数部署会立即生效于线上环境，没有预览缓冲。${C_X}
  环境：$CLOUD_ENV
  函数：${names[*]}
EOF
  printf '%s确认部署？输入 yes 继续：%s' "$C_Y" "$C_X"
  read -r ans
  [ "$ans" = "yes" ] || { warn "已取消"; return 1; }

  # 依赖只有 wx-server-sdk / ws，用云端安装避免上传 200M+ node_modules
  info "部署中（云端 npm install，可能需要 1-3 分钟）…"
  local out rc
  out="$(run_cli cloud functions deploy \
        --project "$PROJECT_ROOT" \
        --env "$CLOUD_ENV" \
        --names "${names[@]}" \
        --remote-npm-install)"
  rc=$?
  echo "$out"
  if [ $rc -eq 0 ]; then
    ok "云函数部署完成：${names[*]}"
  else
    err "部署失败（退出码 ${rc}）"
  fi
  return $rc
}

cmd_watch() {
  [ -n "$NODE" ] || die "找不到 node，无法启动文件监听。
  请安装 Node.js，或设置环境变量指向 node 可执行文件。"
  check_cli
  info "启动文件监听（Ctrl+C 退出）"
  exec "$NODE" "$SCRIPT_DIR/watch.mjs" "$@"
}

usage() {
  cat <<EOF
${C_B}人生海海 · 小程序自动化${C_X}

  ${C_G}refresh${C_X}            编译 + 刷新模拟器 + 终端打印预览二维码
  ${C_G}push${C_X}               推送到手机真机（自动预览，免扫码刷新）
  ${C_G}watch${C_X}  [--push] [--cloud]
                     监听改动自动刷新；--push 同时推真机，--cloud 自动部署云函数
  ${C_G}upload${C_X} [版本号]     上传体验版（默认自动递增 patch）
  ${C_G}cloud${C_X}  [函数名...]  部署云函数（默认全部）
  ${C_G}status${C_X}             环境体检

环境变量：
  WXDEV_CLI       微信开发者工具 cli 路径
  MP_CLOUD_ENV    云环境 ID（当前 ${CLOUD_ENV}）
  MP_UPLOAD_DESC  覆盖上传时的版本描述

项目根：$PROJECT_ROOT
EOF
}

# ── 入口 ───────────────────────────────────────────────────────────
# 被 source 时只加载函数、不执行（便于测试与二次开发）
MP_SOURCED=0
if [ "${BASH_SOURCE[0]}" != "${0}" ]; then MP_SOURCED=1; fi
[ "$MP_SOURCED" = "1" ] && return 0 2>/dev/null

sub="${1:-}"
[ -n "$sub" ] || { usage; exit 0; }
shift || true

case "$sub" in
  refresh)          cmd_refresh ;;
  push|phone)       cmd_push ;;
  upload|release)   cmd_upload "$@" ;;
  cloud|cloudfn)    cmd_cloud "$@" ;;
  watch)            cmd_watch "$@" ;;
  status|doctor)    cmd_status ;;
  -h|--help|help)   usage ;;
  *) err "未知命令：$sub"; echo; usage; exit 1 ;;
esac
