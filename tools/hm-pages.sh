#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# hm-pages.sh —— 第六端逐页对拍的落盘包装器（R163）
#
# 分工（安全纪律）：python 只算不写（派生路径写会被安全扫描判死）；本壳负责
#   ① 全文留档 build/hm-pages.log（含 @@TEXT 双侧流——DIFF 审计凭据）
#   ② @@TSV 标记块 → build/assert-counts-hm.tsv（对拍清单，与五端 tsv 同名域）
#   ③ 透传 python 退出码（INFRA>0 → 1；DIFF 是产出物不算失败）
#
# 用法：bash tools/hm-pages.sh [pages/X ...]（与 tools/hm-pages.py 同参）
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
mkdir -p build

# Chrome 启停在本壳（python 只连已起的调试端口——真实时钟 rootdump 化，
# R165 B0 实证 --dump-dom 虚拟时钟终态树不完整不可信）
CT_PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
CHROME_BIN=$(command -v google-chrome || command -v chrome || echo /opt/google/chrome/chrome)
HM_PROF="${TMPDIR:-/tmp}/hm-pages-profile"
mkdir -p "$HM_PROF"
"$CHROME_BIN" --headless --disable-gpu --no-sandbox \
  --user-data-dir="$HM_PROF" --remote-debugging-port="$CT_PORT" \
  --remote-allow-origins=http://127.0.0.1 \
  --no-first-run --no-default-browser-check about:blank >/dev/null 2>&1 &
CHROME_PID=$!
sleep 3

LOG="build/hm-pages.log"
HM_CHROME_DEBUG_PORT="$CT_PORT" python3 tools/hm-pages.py "$@" >"$LOG" 2>&1
rc=$?
kill "$CHROME_PID" 2>/dev/null || true
wait "$CHROME_PID" 2>/dev/null || true

# @@TSV 标记块抽取（块内容即 tsv 表；无块则 rc 已非 0，留空文件防陈旧误读）
awk '/^@@TSV-BEGIN/{f=1;next} /^@@TSV-END/{f=0} f' "$LOG" > build/assert-counts-hm.tsv
[ -s build/assert-counts-hm.tsv ] || printf 'PAGE\tVERDICT\tDEV\tBRW\n' > build/assert-counts-hm.tsv

cat "$LOG"
exit $rc
