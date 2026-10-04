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

LOG="build/hm-pages.log"
python3 tools/hm-pages.py "$@" >"$LOG" 2>&1
rc=$?

# @@TSV 标记块抽取（块内容即 tsv 表；无块则 rc 已非 0，留空文件防陈旧误读）
awk '/^@@TSV-BEGIN/{f=1;next} /^@@TSV-END/{f=0} f' "$LOG" > build/assert-counts-hm.tsv
[ -s build/assert-counts-hm.tsv ] || printf 'PAGE\tVERDICT\tDEV\tBRW\n' > build/assert-counts-hm.tsv

cat "$LOG"
exit $rc
