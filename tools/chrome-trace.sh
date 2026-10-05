#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# chrome-trace.sh —— 浏览器腿 Tracing 采集包装器（R164 对拍）
#
# 分工（安全扫描纪律，与 hm-pages.sh 同构）：
#   ① Chrome 的启停在 shell（python 只连已起的调试端口）
#   ② python 只算不写——@@TRACE 标记块 → 本壳落 build/<页>.chrome-trace.json
#      （bash 按白名单标记名建文件；文件名形态与内容均由 awk 字段 $2 决定，
#       页名已在 python 侧 PAGE_RE 白名单过）
#   ③ 全文留档 build/chrome-trace.log；透传 python 退出码
#
# 用法：bash tools/chrome-trace.sh [页名 ...]（默认 stress10k attrheavy）
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
mkdir -p build

# 调试端口（本机空闲端口探测）
CT_PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
CHROME_BIN=$(command -v google-chrome || command -v chrome || echo /opt/google/chrome/chrome)
CT_PROF="${TMPDIR:-/tmp}/chrome-trace-profile"
mkdir -p "$CT_PROF"

"$CHROME_BIN" --headless --disable-gpu --no-sandbox \
  --user-data-dir="$CT_PROF" --remote-debugging-port="$CT_PORT" \
  --remote-allow-origins=http://127.0.0.1 \
  --no-first-run --no-default-browser-check about:blank >/dev/null 2>&1 &
CHROME_PID=$!
sleep 3

LOG="build/chrome-trace.log"
python3 tools/chrome-trace.py "$CT_PORT" "$@" >"$LOG" 2>&1
rc=$?

kill "$CHROME_PID" 2>/dev/null || true
wait "$CHROME_PID" 2>/dev/null || true

# @@TRACE 标记块 → 逐页 trace 文件（块内即单行 JSON）
awk '/^@@TRACE_BEGIN /{f="build/" $2 ".chrome-trace.json"; next}
     /^@@TRACE_END /{f=""; next}
     f{print > f}' "$LOG"

cat "$LOG"
exit $rc
