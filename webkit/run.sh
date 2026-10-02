#!/usr/bin/env bash
# WebKit 第四端全矩阵驱动（R148）—— 同用例表 × playwright WebKit
#
#   bash webkit/run.sh            # 全部用例（用例表 = run.sh all 块，与 Firefox 同源）
#   bash webkit/run.sh <用例名>   # 只跑名字含该子串的用例
#
# 依赖两件套都不入库：① 有 playwright 的 python（本机 /data/tmp/wk-venv；可用
# WK_PYTHON 覆盖）② WebKit 二进制（playwright install webkit → ~/.cache/ms-playwright）。
# 任一缺席则显式跳过并声明原因（同 supply/firefox 步纪律，绝不冒充通过）。
# 判定：#result 单通道逐拍轮询（坑 115 教训，见 tools/wk-matrix.py 头注）。
# 计数覆盖：webkit/assert-overrides.tsv（引擎/时序敏感分支的分端期望值，带理由）。
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
cd "$ROOT"

# R159.3：/data 不可写（CI runner）回退系统 mktemp（set -u 兜底，同 run.sh）
if [ -z "${TMPDIR:-}" ]; then
  if mkdir -p /data/tmp 2>/dev/null; then
    export TMPDIR=/data/tmp
  else
    TMPDIR="$(mktemp -d)"
    export TMPDIR
  fi
fi

NODE="${NODE:-/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools/tool/node/bin/node}"
target="${1:-all}"

WK_PY="${WK_PYTHON:-/data/tmp/wk-venv/bin/python}"
if [ ! -x "$WK_PY" ] || ! "$WK_PY" -c "import playwright" 2>/dev/null; then
  printf '════ webkit (webkit/run.sh %s) ════\n' "$target"
  printf '  ⏭  跳过（原因：本机缺带 playwright 的 python（找 %s 失败；\n' "$WK_PY"
  printf '      可 export WK_PYTHON=<python> 覆盖）或 playwright 包未装。\n'
  printf '      WebKit 是兼容性加分第四端（主验收基准=Electron/Chromium）；补齐后本步自动转真）\n'
  exit 0
fi

# ── 用例计划：与 Firefox 同一份解析产物（run.sh all 块 = 单一事实来源）──
mkdir -p build
python3 tools/ff-plan.py > build/ff-plan.jsonl || exit 1

# 解析漂移哨兵（同 firefox/run.sh）：计划数 vs 独立行计数法，防 ff-plan 静默漏案例
plan_n="$(grep -c '^{' build/ff-plan.jsonl 2>/dev/null || true)"
plan_n="${plan_n:-0}"
raw_n="$(sed -n '/^  all)/,/^    exit \$rc ;;/p' run.sh | grep -cE '^[[:space:]]*(VTBUDGET=[0-9]+[[:space:]]+)?run_one ' || true)"
raw_n="${raw_n:-0}"
if [ "$plan_n" -ne "$raw_n" ]; then
  printf '  ❌ 计划用例数(%d) ≠ all 块 run_one 行数(%d)——ff-plan 解析漂移\n' "$plan_n" "$raw_n"
  exit 1
fi

# ── 跑矩阵 ──
if [ "$target" = "all" ]; then
  "$WK_PY" tools/wk-matrix.py >build/wk-matrix.log
else
  "$WK_PY" tools/wk-matrix.py "$target" >build/wk-matrix.log
fi
rc=$?
grep -E '^(SUMMARY|CASE|----|  )' build/wk-matrix.log | sed 's/^/  /'
grep '^CASE' build/wk-matrix.log | awk -F'\t' '{print $2 "\t" $4}' > build/assert-counts-webkit.tsv

# ── 判定：有任何非 PASS 用例即红 ──
badcases="$(grep -E $'\t(FAIL|TIMEOUT|ERROR)\t' build/wk-matrix.log || true)"
if [ -n "$badcases" ]; then
  printf '  ❌ WebKit 矩阵有非 PASS 用例：\n'
  printf '  %s\n' "$badcases"
  rc=1
fi

# ── 断言计数守门（WebKit 端：分端覆盖表见 webkit/assert-overrides.tsv）──
if ! "$NODE" tools/assert-counts.mjs --browser build/assert-counts-webkit.tsv \
    --overrides webkit/assert-overrides.tsv --label "WebKit"; then
  rc=1
fi

if [ "$rc" -eq 0 ]; then
  printf '  ✅ webkit 全矩阵通过（playwright WebKit，python=%s）\n' "$WK_PY"
fi
exit $rc
