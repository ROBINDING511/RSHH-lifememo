#!/usr/bin/env bash
# 人生海海 · 自动化入口（薄壳：仅解析 node 后转交 scripts/mp.js，全部逻辑在 JS）
# 用法见 node scripts/mp.js help
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
else
  NODE="$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node"
fi
exec "$NODE" "$SCRIPT_DIR/mp.js" "$@"