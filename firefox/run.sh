#!/usr/bin/env bash
# Firefox(Gecko) 全矩阵驱动（R144）—— 第三验证端
#
#   bash firefox/run.sh            # 全部用例（用例表 = run.sh all 块，单一事实来源）
#   bash firefox/run.sh <用例名>   # 只跑名字含该子串的用例
#
# 与 run.sh（Chrome）的关系：同一批测试页、同一批用例名、同一套断言计数守门；
# 驱动不同——geckodriver + W3C WebDriver（Fx 156 的 BiDi 未实现 script.*，
# 而页面判定通道是 document.title / #result 文本，经典 WebDriver 恰好覆盖）。
# geckodriver 不入库（~3MB 二进制）：按 FF_GECKODRIVER → PATH → ~/.local/bin
# → /data/tmp 顺序定位；缺席则显式跳过并声明原因（绝不冒充通过——同 supply 步纪律）。
# 计数覆盖：firefox/assert-overrides.tsv（互斥条件分支的分端期望值，带理由）。
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
cd "$ROOT"

mkdir -p /data/tmp
export TMPDIR=/data/tmp   # /tmp tmpfs inode 打满曾致门禁假红（R113），全仓库统一

NODE=/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools/tool/node/bin/node
GD_PORT=9555
target="${1:-all}"

# ── 环境定位：firefox 与 geckodriver 缺一即显式跳过 ──
FIREFOX_BIN="${FF_FIREFOX:-$(command -v firefox 2>/dev/null || true)}"
GECKODRIVER="${FF_GECKODRIVER:-$(command -v geckodriver 2>/dev/null || true)}"
if [ -z "$GECKODRIVER" ] && [ -x "$HOME/.local/bin/geckodriver" ]; then
  GECKODRIVER="$HOME/.local/bin/geckodriver"
fi
if [ -z "$GECKODRIVER" ] && [ -x /data/tmp/geckodriver ]; then
  GECKODRIVER=/data/tmp/geckodriver
fi
if [ -z "$FIREFOX_BIN" ] || [ -z "$GECKODRIVER" ]; then
  printf '════ firefox (firefox/run.sh %s) ════\n' "$target"
  printf '  ⏭  跳过（原因：本机缺 %s；\n' "$([ -z "$FIREFOX_BIN" ] && echo firefox || echo geckodriver)"
  printf '      Firefox/Gecko 是兼容性加分端（主验收基准=Electron/Chromium，见 docs/ARCHITECTURE §1）。\n'
  printf '      补齐：装 firefox + geckodriver（或 export FF_GECKODRIVER=<路径>）后本步自动转真）\n'
  exit 0
fi

# ── 用例计划：解析 run.sh all 块（run.sh 增删用例，本矩阵自动跟随）──
mkdir -p build
python3 tools/ff-plan.py > build/ff-plan.jsonl || exit 1

# 解析漂移守卫（自包含，不依赖浏览器 TSV 的新鲜度）：计划用例数必须等于
# 用"另一套解析法"（逐行数 run_one 行）数出来的 all 块用例数——
# ff-plan 用 shlex 分词，这里用行计数；块边界锚或分词任一漂移都会红。
# 注意 assert-counts 对"没跑到的用例"只跳过不报红，所以这道哨兵不能省。
plan_n="$(grep -c '^{' build/ff-plan.jsonl 2>/dev/null || true)"
plan_n="${plan_n:-0}"
raw_n="$(sed -n '/^  all)/,/^    exit \$rc ;;/p' run.sh | grep -cE '^[[:space:]]*(VTBUDGET=[0-9]+[[:space:]]+)?run_one ' || true)"
raw_n="${raw_n:-0}"
if [ "$plan_n" -ne "$raw_n" ]; then
  printf '  ❌ 计划用例数(%d) ≠ all 块 run_one 行数(%d)——ff-plan 解析漂移\n' "$plan_n" "$raw_n"
  exit 1
fi

# ── geckodriver 生命周期：固定端口 9555，先清残留 ──
pkill -f "geckodriver --port $GD_PORT" 2>/dev/null && sleep 0.5
"$GECKODRIVER" --port "$GD_PORT" >build/ff-geckodriver.log 2>&1 &
GD_PID=$!
cleanup() {
  kill "$GD_PID" 2>/dev/null
  pkill -P "$GD_PID" 2>/dev/null   # geckodriver 的 firefox 子进程
  wait "$GD_PID" 2>/dev/null
}
trap cleanup EXIT

for _ in $(seq 1 25); do
  (exec 3<>"/dev/tcp/127.0.0.1/$GD_PORT") 2>/dev/null && { exec 3>&- 3<&-; break; }
  sleep 0.2
done

# ── 跑矩阵（python 只做环回 HTTP；TSV/判定再加工在本文件）──
if [ "$target" = "all" ]; then
  python3 tools/ff-matrix.py >build/ff-matrix.log
else
  python3 tools/ff-matrix.py "$target" >build/ff-matrix.log
fi
rc=$?
grep '^CASE' build/ff-matrix.log | awk -F'\t' '{print $2 "\t" $4}' > build/assert-counts-firefox.tsv
grep -E '^(SUMMARY|CASE|----|  )' build/ff-matrix.log | sed 's/^/  /'

# ── 判定：有任何非 PASS 用例即红 ──
badcases="$(grep -E $'\t(FAIL|TIMEOUT|ERROR)\t' build/ff-matrix.log || true)"
if [ -n "$badcases" ]; then
  printf '  ❌ Firefox 矩阵有非 PASS 用例：\n'
  printf '  %s\n' "$badcases"
  rc=1
fi

# ── 断言计数守门（Firefox 端：分端覆盖表见 firefox/assert-overrides.tsv）──
if ! "$NODE" tools/assert-counts.mjs --browser build/assert-counts-firefox.tsv \
    --overrides firefox/assert-overrides.tsv --label "Firefox"; then
  rc=1
fi

if [ "$rc" -eq 0 ]; then
  printf '  ✅ firefox 全矩阵通过（%s）\n' "$("$FIREFOX_BIN" --version 2>/dev/null | head -1)"
fi
exit $rc
