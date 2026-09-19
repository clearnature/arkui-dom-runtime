#!/usr/bin/env bash
# 一条命令做完所有可自动化的验收。
#
#   bash tools/check-all.sh            # 全部
#   bash tools/check-all.sh --quick    # 跳过 Electron（只跑 preflight + 生成物 + 浏览器）
#
# 设计约定：
#   1) 成败一律看【被调用命令的退出码】，绝不用 grep/wc 数日志行。
#      本项目已经出现过 4 次"测试通过但结论是假的"（grep 'ALL PASS' 匹配到 <script>
#      源码里的字符串、纯白图被判非空、404 页面读空串全通过、负向断言被后续实现
#      静默失效）。用文本搜索判成败会把这类问题重新引进来。
#   2) 每步都留下日志，失败时打印到终端，成功时只说 OK——便于在 CI 里翻。
#   3) 最后一步不改变退出码：统计只是给文档用的数字，不是验收条件。
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
cd "$ROOT"

LOGDIR="$ROOT/build/check-logs"
mkdir -p "$LOGDIR"

QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1

STEPS=()
FAILED=()

step() {
  local name="$1"; shift
  local log="$LOGDIR/$(printf '%s' "$name" | tr -c 'a-zA-Z0-9._-' '_').log"
  printf '════ %s ════\n' "$name"
  if "$@" >"$log" 2>&1; then
    printf '  ✅ %s\n' "$name"
    STEPS+=("$name")
  else
    local rc=$?
    printf '  ❌ %s  (exit %d)\n' "$name" "$rc"
    printf '  ── 输出尾部 ──\n'
    tail -30 "$log" | sed 's/^/    /'
    printf '  （完整日志: %s）\n' "$log"
    FAILED+=("$name")
  fi
}

# ── 1. 环境 preflight：缺什么都别继续了 ──
step "preflight" node tools/preflight.mjs

# ── 2. 生成物与生成器一致（防手改生成物 / 防规则变了没重生成）──
# 放在测试前：如果生成物漂移，后面所有测试跑的都不是仓库里那份代码。
step "gen-components --check" node tools/gen-components.mjs --check

# ── 3. 文档里的实测数字与代码一致 ──
# ARCHITECTURE.md §6 整块嵌了 `stats.mjs` 的输出（94 行数字）。历史上靠人肉同步，
# R5a 提交就漏了一行（THIRD-PARTY-NOTICES.md）—— 所以给它加守卫，与上一步同构。
# 触发了怎么修： npm run stats:write-doc
step "stats --check-doc" node tools/stats.mjs --check-doc

# ── 4. 浏览器用例 ──
step "browser (run.sh all)" bash run.sh all

# ── 5. Electron 用例 + 磁盘落盘验证 ──
if [ "$QUICK" = "1" ]; then
  printf '════ electron ════\n  ⏭  跳过（--quick）\n'
else
  step "electron (electron/run.sh all)" bash electron/run.sh all
fi

# ── 6. 统计（不是验收条件，只留档给文档引用）──
printf '════ 统计（留档，不影响退出码）════\n'
node tools/stats.mjs | tee "$LOGDIR/stats.txt" | sed 's/^/  /'

# ── 汇总 ──
printf '\n════ 汇总 ════\n'
printf '  通过 %d 步：%s\n' "${#STEPS[@]}" "${STEPS[*]:-（无）}"
if [ "${#FAILED[@]}" -eq 0 ]; then
  printf '  ✅ 全部通过\n'
  exit 0
fi
printf '  ❌ 失败 %d 步：%s\n' "${#FAILED[@]}" "${FAILED[*]}"
printf '  （日志目录: %s）\n' "$LOGDIR"
exit 1
