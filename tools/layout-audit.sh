#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# layout-audit.sh —— B0 可坍缩性量化驱动（R165 · B 档起步）
#
# 分工（安全扫描纪律，同 chrome-trace 先例）：Chrome 启停在本壳；采集走
# chrome-trace.py rootdump 模式（真实时钟渲完 → #root.outerHTML → stdout）——
# **不用 --dump-dom 虚拟时钟**：实测该路径终态树不完整（textdemo 3/3 ALL PASS
# 却 root 少 3 控件；真实时钟探针 4 控件齐），B0 只信真实时钟通道。
# serve 由 chrome-trace.py 自管（其内部固定三元组+守卫）。
# 分析端 layout-audit.py 只读固定路径，零 subprocess/网络/写盘。
#
# 用法：bash tools/layout-audit.sh [页名 ...]（默认 6 个代表页）
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
mkdir -p build

PAGES=("$@")
[ ${#PAGES[@]} -gt 0 ] || PAGES=(stress10k attrheavy reldemo batchlayout textdemo lazyvar)

for pg in "${PAGES[@]}"; do
  if ! [[ "$pg" =~ ^[A-Za-z][A-Za-z0-9_]*$ ]]; then
    echo "❌ 非法页名: $pg"; exit 2
  fi
  [ -f "test/$pg.html" ] || { echo "❌ 无测试页 test/$pg.html"; exit 2; }
done

# 调试端口（本机空闲端口探测）
CT_PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
CHROME_BIN=$(command -v google-chrome || command -v chrome || echo /opt/google/chrome/chrome)
LA_PROF="${TMPDIR:-/tmp}/layout-audit-profile"
mkdir -p "$LA_PROF"

"$CHROME_BIN" --headless --disable-gpu --no-sandbox \
  --user-data-dir="$LA_PROF" --remote-debugging-port="$CT_PORT" \
  --remote-allow-origins=http://127.0.0.1 \
  --no-first-run --no-default-browser-check about:blank >/dev/null 2>&1 &
CHROME_PID=$!
sleep 3

echo "══ B0 可坍缩性量化（真实时钟 CDP rootdump；T0=contents透传层 T1=同向白名单层 宽档=带几何也删的假上限）══"
rc=0
for pg in "${PAGES[@]}"; do
  printf '%-14s ' "$pg"
  python3 tools/chrome-trace.py "$CT_PORT" rootdump "$pg" \
    > build/layout-audit.html 2>/dev/null || rc=1
  python3 tools/layout-audit.py || rc=1
done

kill "$CHROME_PID" 2>/dev/null || true
wait "$CHROME_PID" 2>/dev/null || true
exit $rc
