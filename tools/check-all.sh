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
SKIPPED=()   # 显式跳过的步骤（必须当场声明原因，汇总时单列，绝不冒充"通过"）

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

# ── 3. runtime 产物与分片一致（防手改拼接产物 / 防改了分片没重拼）──
# runtime/arkui-dom-runtime.js 现在是 runtime/src/ 的拼接产物（tools/build-runtime.mjs）。
# 它与 gen-components 同构：产物入库、靠 --check 守"产物 = 源"。放在测试前 —— 否则后面
# 所有测试跑的都不是仓库里那份源拼出来的代码。
# 触发了怎么修： npm run build:runtime
step "build-runtime --check" node tools/build-runtime.mjs --check

# ── 4. 文档里的实测数字与代码一致 ──
# ARCHITECTURE.md §6 整块嵌了 `stats.mjs` 的输出（94 行数字）。历史上靠人肉同步，
# R5a 提交就漏了一行（THIRD-PARTY-NOTICES.md）—— 所以给它加守卫，与上一步同构。
# 触发了怎么修： npm run stats:write-doc
step "stats --check-doc" node tools/stats.mjs --check-doc

# ── 4b. 类型检查（R38：tsc --checkJs 检查拼接产物 + runtime.d.ts 词汇表）──
# 红线 0 错误。曾挖出 2 个真 bug（onSubmit 的 value 未定义 / v2 Event 遮蔽 DOM Event）。
# 触发了怎么修：按报错的 文件:行 修源分片（JSDoc 断言优先，零运行时改动），别用 @ts-ignore。
step "typecheck" node tools/typecheck.mjs

# ── 5. 浏览器用例 ──
step "browser (run.sh all)" bash run.sh all

# ── 6. Electron 用例 + 磁盘落盘验证 ──
if [ "$QUICK" = "1" ]; then
  printf '════ electron ════\n  ⏭  跳过（--quick）\n'
  SKIPPED+=("electron (--quick)")
else
  step "electron (electron/run.sh all)" bash electron/run.sh all
fi

# ── 6b. Firefox(Gecko) 用例（R144 第三验证端：同用例表跨引擎复跑）──
# 兼容性加分端：主验收基准是 Electron/Chromium（docs/ARCHITECTURE §1 三层一致性）。
# firefox 或 geckodriver 缺席时显式跳过并声明原因（同 supply 步纪律，绝不冒充通过）；
# 驱动就位时本步自动转真（geckodriver ~3MB 二进制不入库，定位顺序见 firefox/run.sh）。
if command -v firefox >/dev/null 2>&1 \
   && { [ -n "${FF_GECKODRIVER:-}" ] || command -v geckodriver >/dev/null 2>&1 \
        || [ -x "$HOME/.local/bin/geckodriver" ] || [ -x /data/tmp/geckodriver ]; }; then
  step "firefox (firefox/run.sh all)" bash firefox/run.sh all
else
  printf '════ firefox (firefox/run.sh all) ════\n'
  printf '  ⏭  跳过（原因：本机缺 firefox 或 geckodriver —— Firefox/Gecko 为兼容性加分端，\n'
  printf '      主验收基准=Electron/Chromium；补齐后本步自动转真）\n'
  SKIPPED+=("firefox (矩阵)")
fi

# ── 6c. WebKit 用例（R148 第四验证端：同用例表 × playwright WebKit）──
# 兼容性加分端：主验收基准是 Electron/Chromium（docs/ARCHITECTURE §1 三层一致性）。
# 依赖两件套都不入库（带 playwright 的 python + ~/.cache/ms-playwright 的 WebKit
# 二进制），缺席时显式跳过并声明原因；就位时本步自动转真（见 webkit/run.sh）。
WK_PY="${WK_PYTHON:-/data/tmp/wk-venv/bin/python}"
if [ -x "$WK_PY" ] && "$WK_PY" -c "import playwright" 2>/dev/null; then
  step "webkit (webkit/run.sh all)" bash webkit/run.sh all
else
  printf '════ webkit (webkit/run.sh all) ════\n'
  printf '  ⏭  跳过（原因：本机缺带 playwright 的 python（找 %s 失败）——\n' "$WK_PY"
  printf '      WebKit 为兼容性加分第四端，主验收基准=Electron/Chromium；补齐后本步自动转真）\n'
  SKIPPED+=("webkit (矩阵)")
fi

# ── 6d. Android(System WebView) 用例（R149 第五验证端：同用例表 × 移动 Blink）──
# 兼容性加分端：Android SDK（/data/android-sdk）+ AVD arkui_test + venv 缺一即显式跳过；
# 就位时自动转真（模拟器起停/socket 发现/转发全在 android/run.sh）。
if [ -x /data/android-sdk/platform-tools/adb ] && [ -x /data/android-sdk/emulator/emulator ] \
   && [ -x /data/tmp/wk-venv/bin/python ]; then
  step "android (android/run.sh all)" bash android/run.sh all
else
  printf '════ android (android/run.sh all) ════\n'
  printf '  ⏭  跳过（原因：Android SDK 或 AVD/venv 不齐——Android 为移动 Blink 兼容性\n'
  printf '      加分第五端，主验收基准=Electron/Chromium；补齐后本步自动转真）\n'
  SKIPPED+=("android (矩阵)")
fi

# ── 7. 统计（不是验收条件，只留档给文档引用）──
printf '════ 统计（留档，不影响退出码）════\n'
node tools/stats.mjs | tee "$LOGDIR/stats.txt" | sed 's/^/  /'

# ── 8. 供应链安全：生产依赖已知高危漏洞审计（E0-5）──
# npm audit 必须有 package-lock.json 才有确定的依赖树可审（实测：无 lock 时以 ENOLOCK 退出 1）。
# 本仓库根目录没有 lock 文件，package.json 的 "//" 字段声明"本项目没有 npm 依赖"，
# Electron 也是解包 electron/runtime/ 使用、不经 npm 安装 —— 此时【显式跳过并声明原因】，
# 绝不静默跳过、更不伪造 ✅。一旦将来引入 lock 文件，本步自动变成真审计：
#   --omit=dev         只审生产依赖（devDependencies 的漏洞不算红）
#   --audit-level=high 发现 high/critical 漏洞即退出非 0 → 按 step() 记败，门禁变红
# （R144 起 gate 共 9 步：本步序号不变，前面 6b 插入了 firefox 矩阵步。）
if [ -f "$ROOT/package-lock.json" ]; then
  step "supply (npm audit)" npm audit --omit=dev --audit-level=high
else
  printf '════ supply (npm audit) ════\n'
  printf '  ⏭  跳过（原因：无 package-lock.json，npm audit 没有依赖树可审；\n'
  printf '      本仓库 package.json 声明零 npm 依赖，无可审计面。引入 lock 后本步自动转真审计）\n'
  SKIPPED+=("supply (npm audit)")
fi

# ── 汇总 ──
printf '\n════ 汇总 ════\n'
printf '  通过 %d 步：%s\n' "${#STEPS[@]}" "${STEPS[*]:-（无）}"
if [ "${#SKIPPED[@]}" -gt 0 ]; then
  printf '  ⏭  跳过 %d 步（不计入通过数）：%s\n' "${#SKIPPED[@]}" "${SKIPPED[*]:-}"
fi
if [ "${#FAILED[@]}" -eq 0 ]; then
  if [ "${#SKIPPED[@]}" -eq 0 ]; then
    printf '  ✅ 全部通过\n'
  else
    printf '  ✅ 已执行步骤全部通过（另有 %d 步显式跳过，原因见上）\n' "${#SKIPPED[@]}"
  fi
  exit 0
fi
printf '  ❌ 失败 %d 步：%s\n' "${#FAILED[@]}" "${FAILED[*]}"
printf '  （日志目录: %s）\n' "$LOGDIR"
exit 1
