#!/usr/bin/env bash
# 在真 Electron 里跑与浏览器相同的断言页
#
#   bash electron/run.sh            # 默认 layout
#   bash electron/run.sh rich       # 换页面
#   bash electron/run.sh all        # layout + rich 都跑
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
ELECTRON="$HERE/runtime/electron"

if [ ! -x "$ELECTRON" ]; then
  echo "找不到 Electron：$ELECTRON"
  echo "（从 ~/.cache/electron/ 里的 zip 解包到 electron/runtime/ 即可）"
  exit 2
fi

NODE=/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools/tool/node/bin/node
FIXTURES="$ROOT/fixtures"

# 断言计数守门（与浏览器侧同构，为什么这么做见 run.sh 顶部那段说明）：
# 实测值由本脚本落盘，退出时交给 tools/assert-counts.mjs 与文档里手写的数字比对。
RUN_COUNTS="$ROOT/build/assert-counts-electron.tsv"
mkdir -p "$ROOT/build"
: > "$RUN_COUNTS"
finalize_counts() {
  local rc=$?
  if [ -s "$RUN_COUNTS" ]; then "$NODE" "$ROOT/tools/assert-counts.mjs" --electron "$RUN_COUNTS" || rc=1; fi
  exit $rc
}
trap finalize_counts EXIT

# 用例名 → 页面文件名（两者不同的必须映射；曾因用错导致加载 404 页、断言读到空串）
page_of() {
  case "$1" in
    widgets) printf 'components' ;;
    # 用例名与页面文件名不一定相同 —— 名字不一致就要在这里登记，否则会去加载不存在的
    # test/<用例名>.html（404 页没有 #result，断言读到空串，表现为"页面没输出"而不是报错）
    lazyvh) printf 'lazyvar' ;;
    *) printf '%s' "$1" ;;
  esac
}

# 自备产物：Electron 侧不隐式依赖"浏览器侧先跑过"——缺什么就现生成什么
prepare() {
  case "$1" in
    index|ability) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/Index.ts" "$ROOT/build/app.js" >/dev/null || return 1 ;;
  esac
  case "$1" in
    ability) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/entryability/EntryAbility.ts" "$ROOT/build/ability-module.js" --cjs --register EntryAbility >/dev/null || return 1 ;;
    router)
      "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/Detail.ts" "$ROOT/build/detail-module.js" --cjs --register Detail >/dev/null || return 1
      "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/Home.ts" "$ROOT/build/home-module.js" --cjs --register Home >/dev/null || return 1 ;;
    rich|leak) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/Rich.ts" "$ROOT/build/rich.js" >/dev/null || return 1 ;;
    layout) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/Layout.ts" "$ROOT/build/layout.js" >/dev/null || return 1 ;;
    widgets) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/Widgets.ts" "$ROOT/build/widgets.js" >/dev/null || return 1 ;;
    tabgrid) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/TabsGrid.ts" "$ROOT/build/tabsgrid.js" >/dev/null || return 1 ;;
    swiper) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/SwiperDemo.ts" "$ROOT/build/swiperdemo.js" >/dev/null || return 1 ;;
    navdemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/NavDemo.ts" "$ROOT/build/navdemo.js" >/dev/null || return 1 ;;
    reldemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/RelDemo.ts" "$ROOT/build/reldemo.js" >/dev/null || return 1 ;;
    drawdemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/DrawDemo.ts" "$ROOT/build/drawdemo.js" >/dev/null || return 1 ;;
    textmeasure) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/TextMeasure.ts" "$ROOT/build/textmeasure-module.js" --cjs --register TextMeasure >/dev/null || return 1 ;;
    measure) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/Measure.ts" "$ROOT/build/measure.js" >/dev/null || return 1 ;;
    lazy) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/Lazy.ts" "$ROOT/build/lazy.js" >/dev/null || return 1 ;;
    lazyvh) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/LazyVar.ts" "$ROOT/build/lazyvar.js" >/dev/null || return 1 ;;
    measarea) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/MeasArea.ts" "$ROOT/build/measarea.js" >/dev/null || return 1 ;;
    measimage) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/MeasImage.ts" "$ROOT/build/measimage-module.js" --cjs --register MeasImage >/dev/null || return 1 ;;
    measnotify) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/MeasNotify.ts" "$ROOT/build/measnotify-module.js" --cjs --register MeasNotify >/dev/null || return 1 ;;
    promptaction)
      # R20：三个模块（调用方页面 / 被启动方页面 / ability 类）
      "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/Callee.ts" "$ROOT/build/callee-module.js" --cjs --register Callee >/dev/null || return 1
      "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/PromptAct.ts" "$ROOT/build/promptact-module.js" --cjs --register PromptAct >/dev/null || return 1
      "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/entryability/PromptAbility.ts" "$ROOT/build/promptability-module.js" --cjs --register PromptAbility >/dev/null || return 1 ;;
    provide) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/Provide.ts" "$ROOT/build/provide.js" >/dev/null || return 1 ;;
    async) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/AsyncIO.ts" "$ROOT/build/asyncio-module.js" --cjs --register AsyncIO >/dev/null || return 1 ;;
    netfile) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/NetFile.ts" "$ROOT/build/netfile-module.js" --cjs --register NetFile >/dev/null || return 1 ;;
    realfs) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/NetFile.ts" "$ROOT/build/netfile-module.js" --cjs --register NetFile >/dev/null || return 1 ;;
    animdemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/AnimDemo.ts" "$ROOT/build/animdemo-module.js" --cjs --register AnimDemo >/dev/null || return 1 ;;
    gesturedemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/GestureDemo.ts" "$ROOT/build/gesturedemo-module.js" --cjs --register GestureDemo >/dev/null || return 1 ;;
    transitiondemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/TransitionDemo.ts" "$ROOT/build/transitiondemo-module.js" --cjs --register TransitionDemo >/dev/null || return 1 ;;
    gesturegroupdemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/GestureGroupDemo.ts" "$ROOT/build/gesturegroupdemo-module.js" --cjs --register GestureGroupDemo >/dev/null || return 1 ;;
    navbardemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/NavBarDemo.ts" "$ROOT/build/navbardemo-module.js" --cjs --register NavBarDemo >/dev/null || return 1 ;;
    navtransdemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/NavTransDemo.ts" "$ROOT/build/navtransdemo-module.js" --cjs --register NavTransDemo >/dev/null || return 1 ;;
    shapedemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/ShapeDemo.ts" "$ROOT/build/shapedemo-module.js" --cjs --register ShapeDemo >/dev/null || return 1 ;;
    inputdemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/InputDemo.ts" "$ROOT/build/inputdemo-module.js" --cjs --register InputDemo >/dev/null || return 1 ;;
    showdemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/ShowDemo.ts" "$ROOT/build/showdemo-module.js" --cjs --register ShowDemo >/dev/null || return 1 ;;
    popdemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/PopDemo.ts" "$ROOT/build/popdemo-module.js" --cjs --register PopDemo >/dev/null || return 1 ;;
    uictxdemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/UiContextDemo.ts" "$ROOT/build/uictxdemo-module.js" --cjs --register UiContextDemo >/dev/null || return 1 ;;
    canvasedemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/CanvasDemo.ts" "$ROOT/build/canvasedemo-module.js" --cjs --register CanvasDemo >/dev/null || return 1 ;;
    xcompdemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/XCompDemo.ts" "$ROOT/build/xcompdemo-module.js" --cjs --register XCompDemo >/dev/null || return 1 ;;
    qrdemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/QrDemo.ts" "$ROOT/build/qrdemo-module.js" --cjs --register QrDemo >/dev/null || return 1 ;;
    textdemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/TextDemo.ts" "$ROOT/build/textdemo-module.js" --cjs --register TextDemo >/dev/null || return 1 ;;
    mediademo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/MediaDemo.ts" "$ROOT/build/mediademo-module.js" --cjs --register MediaDemo >/dev/null || return 1 ;;
    smalldemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/SmallDemo.ts" "$ROOT/build/smalldemo-module.js" --cjs --register SmallDemo >/dev/null || return 1 ;;
    imagedemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/ImageDemo.ts" "$ROOT/build/imagedemo-module.js" --cjs --register ImageDemo >/dev/null || return 1 ;;
    scrolldemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/ScrollDemo.ts" "$ROOT/build/scrolldemo-module.js" --cjs --register ScrollDemo >/dev/null || return 1 ;;
    animatordemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/AnimatorDemo.ts" "$ROOT/build/animatordemo-module.js" --cjs --register AnimatorDemo >/dev/null || return 1 ;;
    listitemgroup) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/ListGroupDemo.ts" "$ROOT/build/listitemgroup-module.js" --cjs --register ListGroupDemo >/dev/null || return 1 ;;
    refreshdemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/RefreshDemo.ts" "$ROOT/build/refreshdemo-module.js" --cjs --register RefreshDemo >/dev/null || return 1 ;;
    datepickerdemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/DatePickerDemo.ts" "$ROOT/build/datepickerdemo-module.js" --cjs --register DatePickerDemo >/dev/null || return 1 ;;
    timepickerdemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/TimePickerDemo.ts" "$ROOT/build/timepickerdemo-module.js" --cjs --register TimePickerDemo >/dev/null || return 1 ;;
    waterflowdemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/WaterFlowDemo.ts" "$ROOT/build/waterflowdemo-module.js" --cjs --register WaterFlowDemo >/dev/null || return 1 ;;
    calendarpickerdemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/CalendarPickerDemo.ts" "$ROOT/build/calendarpickerdemo-module.js" --cjs --register CalendarPickerDemo >/dev/null || return 1 ;;
    textpickerdemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/TextPickerDemo.ts" "$ROOT/build/textpickerdemo-module.js" --cjs --register TextPickerDemo >/dev/null || return 1 ;;
    griddemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/GridDemo.ts" "$ROOT/build/griddemo-module.js" --cjs --register GridDemo >/dev/null || return 1 ;;
    texttimedemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/TextTimeDemo.ts" "$ROOT/build/texttimedemo-module.js" --cjs --register TextTimeDemo >/dev/null || return 1 ;;
    alphabetindexerdemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/AlphabetIndexerDemo.ts" "$ROOT/build/alphabetindexerdemo-module.js" --cjs --register AlphabetIndexerDemo >/dev/null || return 1 ;;
    stepdemo) "$NODE" "$ROOT/tools/extract.mjs" "$FIXTURES/pages/StepDemo.ts" "$ROOT/build/stepdemo-module.js" --cjs --register StepDemo >/dev/null || return 1 ;;
  esac
  return 0
}

run_one() {
  local page="$1" query="${2:-}" label="${3:-$1}"
  echo "════════════ electron: $label ════════════"
  prepare "$page" || { echo "  ❌ 生成产物失败"; return 1; }

  # 起本地服务，让 Electron 走 http:// 而非 file://：
  # 这样页面内的 fetch 是同源（net.http 用例需要），也与浏览器侧跑的是同一份页面
  local logf port server_pid
  logf="$(mktemp)"
  python3 "$ROOT/tools/serve.py" 0 >"$logf" 2>&1 &
  server_pid=$!
  port=""
  for _ in $(seq 1 25); do
    port="$(grep -oE 'http://127\.0\.0\.1:[0-9]+' "$logf" 2>/dev/null | head -1 | grep -oE '[0-9]+$')"
    [ -n "$port" ] && break
    sleep 0.2
  done
  if [ -z "$port" ]; then
    echo "  ❌ 本地服务未启动："; sed 's/^/     /' "$logf"
    kill $server_pid 2>/dev/null; rm -f "$logf"; return 1
  fi

  # --no-sandbox：chrome-sandbox 需要 root:4755，本机未设
  # --disable-gpu：本机 Mesa 被 ROCm 修改，Electron GPU 进程易崩（见 memory）
  # ARKUI_OFFSCREEN=1：隐藏窗口的合成器不产帧，capturePage 会挂；offscreen 模式用 paint 帧截图
  # 让输出既实时透出（sed 缩进显示）、又留一份**没有缩进**的原文用于数 PASS 行：
  # 断言计数守门要的是运行期实测值，不能靠 grep test/*.html（realfs 有 28 处 check( 但只跑 21 条）。
  local outf; outf="$(mktemp /tmp/arkui-electron-out-XXXXXX)"
  ARKUI_TEST="$label" \
  ARKUI_PAGE_URL="http://127.0.0.1:$port/test/$(page_of "$page").html$query" \
  ARKUI_OFFSCREEN="${ARKUI_OFFSCREEN:-1}" \
    timeout 180 "$ELECTRON" --no-sandbox --disable-gpu "$HERE" 2>&1 \
    | grep -v -E 'Fontconfig|libva|GLX|dbus|MESA|Mesa|vulkan|Vulkan|gbm|DRM|drm' \
    | tee "$outf" \
    | sed 's/^/  /'
  local rc=${PIPESTATUS[0]}
  printf '%s\t%s\n' "$label" "$(grep -cE '^[[:space:]]*PASS ' "$outf")" >> "$RUN_COUNTS"
  rm -f "$outf"
  kill $server_pid 2>/dev/null; wait $server_pid 2>/dev/null; rm -f "$logf"
  return $rc
}

# 外部核验：不依赖页面自报，直接在 shell 里看真实磁盘文件
verify_disk() {
  local d="$HERE/data/files"
  echo "──── 外部核验：真实磁盘上的文件（不依赖页面自报）────"
  if [ -d "$d" ]; then ls -la "$d" | sed 's/^/  /'; else echo "  ❌ 目录不存在: $d"; return 1; fi
  if [ -f "$d/demo.txt" ]; then
    printf '  ✅ demo.txt 内容 = '; cat "$d/demo.txt"; echo
  else
    echo '  ❌ 真实磁盘上不存在 demo.txt —— 数据没有落盘'; return 1
  fi
  if [ -f "$d/pref_persist_probe.json" ]; then
    printf '  ✅ preferences 落盘 = '; cat "$d/pref_persist_probe.json"; echo
  else
    echo '  ❌ preferences 未落盘'; return 1
  fi
  return 0
}

case "${1:-layout}" in
  all)
    rc=0
    # 全矩阵：每个用例都是独立 Electron 进程
    for t in index rich layout widgets tabgrid swiper navdemo reldemo drawdemo textmeasure lazyvh measarea measimage measnotify promptaction realfs animdemo gesturedemo transitiondemo gesturegroupdemo navbardemo navtransdemo shapedemo inputdemo showdemo popdemo uictxdemo canvasedemo xcompdemo qrdemo textdemo mediademo smalldemo stepdemo imagedemo scrolldemo animatordemo listitemgroup refreshdemo datepickerdemo timepickerdemo waterflowdemo calendarpickerdemo textpickerdemo griddemo texttimedemo alphabetindexerdemo measure lazy provide v2 observe ability router async; do
      run_one "$t" || rc=1
      echo
    done
    # 两阶段持久化（真 fs）
    rm -rf "$HERE/data"
    run_one netfile "?phase=1" netfile-1 || rc=1
    echo
    run_one netfile "?phase=2" netfile-2 || rc=1
    echo
    verify_disk || rc=1
    exit $rc ;;
  netfile)
    # 两阶段：进程 A 写盘 → 进程 B 读回（真文件系统，跨进程 = 跨"断电"）
    rm -rf "$HERE/data"        # 从干净状态开始，否则"持久化成立"可能是上次残留
    run_one netfile "?phase=1" netfile-1 || exit 1
    echo
    run_one netfile "?phase=2" netfile-2 || exit 1
    echo
    verify_disk ;;
  layout|rich|index|leak|ability|router|widgets|tabgrid|swiper|navdemo|reldemo|drawdemo|textmeasure|lazyvh|measarea|measimage|measnotify|promptaction|realfs|animdemo|gesturedemo|transitiondemo|gesturegroupdemo|navbardemo|navtransdemo|shapedemo|inputdemo|showdemo|popdemo|uictxdemo|canvasedemo|xcompdemo|qrdemo|textdemo|mediademo|smalldemo|stepdemo|imagedemo|scrolldemo|animatordemo|listitemgroup|refreshdemo|datepickerdemo|timepickerdemo|waterflowdemo|calendarpickerdemo|textpickerdemo|griddemo|texttimedemo|alphabetindexerdemo|measure|lazy|provide|async|v2|observe) run_one "$1" ;;
  *) echo "用法: bash electron/run.sh [layout|rich|index|leak|ability|router|widgets|tabgrid|swiper|navdemo|reldemo|drawdemo|textmeasure|lazyvh|measarea|measimage|measnotify|promptaction|realfs|animdemo|gesturedemo|transitiondemo|gesturegroupdemo|navbardemo|navtransdemo|shapedemo|inputdemo|showdemo|popdemo|uictxdemo|canvasedemo|xcompdemo|qrdemo|textdemo|mediademo|smalldemo|stepdemo|imagedemo|scrolldemo|animatordemo|listitemgroup|refreshdemo|datepickerdemo|timepickerdemo|waterflowdemo|calendarpickerdemo|textpickerdemo|griddemo|texttimedemo|alphabetindexerdemo|measure|lazy|provide|async|v2|observe|netfile|all]"; exit 2 ;;
esac
