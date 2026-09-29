#!/usr/bin/env bash
# E0-4 长跑稳态（soak）——非门禁脚本：稳态泄漏与稳定性的手动验收
#   bash tools/soak.sh [轮数] [输出 CSV]
# 形态：Electron offscreen 驱动 errbounddemo（该页是 runtime 级、含错误边界/焦点/资源全链路），
# 由 ARKUI_SOAK_ROUNDS 让页面自跑"路由切换 × 组件 churn"循环；主进程每轮上报 heapUsed 到
# stdout（E0-2 的 crashlog 通道独立于此），脚本采样到 CSV 供趋势判断。
# 判据（人工看 CSV/汇总行）：heapUsed 无单调增长趋势；PASS 行数 = 预期。
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROUNDS="${1:-200}"
OUT="${2:-$HERE/build/soak.csv}"
PORT=""
LOG="$(mktemp)"

cleanup() { [ -n "$PORT" ] && kill "$PORT" 2>/dev/null; }
trap cleanup EXIT

python3 "$HERE/tools/serve.py" 0 >"$LOG" 2>&1 &
sleep 1
PORT="$(grep -oE '127\.0\.0\.1:[0-9]+' "$LOG" | head -1 | grep -oE '[0-9]+$')"
if [ -z "$PORT" ]; then echo "❌ 服务未启动"; exit 1; fi
echo "serve=$PORT rounds=$ROUNDS out=$OUT"

echo "round,heapUsedMB,domNodes,elmtRecords" > "$OUT"
ARKUI_TEST=errbounddemo \
ARKUI_PAGE_URL="http://127.0.0.1:$PORT/test/errbounddemo.html" \
ARKUI_OFFSCREEN=1 \
ARKUI_SOAK_ROUNDS="$ROUNDS" \
ARKUI_SOAK_OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")" \
  timeout 3600 "$HERE/electron/runtime/electron" --no-sandbox --disable-gpu --ozone-platform=x11 \
  "$HERE/electron" 2>&1 | grep -E "SOAK|ALL PASS|FAIL|ELECTRON_RESULT" | sed 's/^/  /'
