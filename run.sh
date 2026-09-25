#!/usr/bin/env bash
# ArkUI → DOM 验证驱动
#
#   bash run.sh          # index 页面（第①步基线：@State + Text）
#   bash run.sh rich     # Rich 页面（② 五个机制：自定义组件/@Prop/@Link/If/ForEach）
#   bash run.sh all      # 两个都跑
#
# 每个用例：抽取 ets-loader 转换产物 → 去 TS 类型 → 起本地服务 → headless Chrome 断言 → 截图
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

NODE=/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools/tool/node/bin/node
CHROME=/opt/google/chrome/chrome
CACHE="$HERE/harmony-proj/entry/build/default/cache/default/default@CompileArkTS/esmodule/debug/entry/src/main/ets"
FIXTURES="$HERE/fixtures"

# 断言计数守门：把本次实测的「每用例 emit 了多少条 PASS」与文档里手写的「（N 条断言）」比对。
#  · 为什么用 EXIT trap：这样**单个用例**也受守门（`bash run.sh gesturedemo` 也会核 24 条）；
#  · 为什么数字由 runner 落盘、而不是 grep test/*.html 里的 check(：
#    realfs.html 有 28 处 check(，两端各只执行 21 条（7 处在互斥分支里没走到）——
#    静态计数会把"没跑到的断言"也算进去。唯一权威是运行期真的 emit 出来的 PASS 行。
RUN_COUNTS="$HERE/build/assert-counts-browser.tsv"
mkdir -p "$HERE/build"
: > "$RUN_COUNTS"          # 每次调用都重开，避免旧记录冒充本次实测
finalize_counts() {
  local rc=$?
  if [ -s "$RUN_COUNTS" ]; then "$NODE" tools/assert-counts.mjs --browser "$RUN_COUNTS" || rc=1; fi
  exit $rc
}
trap finalize_counts EXIT

# 优先用项目内固化的转换产物（fixtures/），没有才回落到 hvigor 的 cache。
# fixtures 是 ets-loader 的输出快照——固化它是为了让本项目不依赖 /tmp 与 HarmonyOS 工具链即可复现。
src_of() {
  local rel="$1"
  if [ -f "$FIXTURES/$rel" ]; then printf '%s' "$FIXTURES/$rel"
  elif [ -f "$CACHE/$rel" ]; then printf '%s' "$CACHE/$rel"
  else printf ''; fi
}

# 选一个当前空闲的端口（用于需要"同一 origin"的持久化用例）。
# 先探测再固定：既避免占用冲突，又保证两次运行端口一致（随机端口会变成不同 origin）。
pick_free_port() {
  local p
  for p in 41789 41790 41791 41792 41793; do
    if python3 -c "
import socket, sys
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(('127.0.0.1', $p)); s.close()
except OSError:
    sys.exit(1)
" 2>/dev/null; then printf '%s' "$p"; return 0; fi
  done
  return 1
}

run_one() {
  local name="$1" src="$2" out="$3" page="$4" extra="${5:-}" query="${6:-}" prof="${7:-}" fixed_port="${8:-}"
  local logf server_pid port result dom profdir
  profdir="${prof:-$(mktemp -d /tmp/arkui-chrome-XXXX)}"

  echo "════════════ $name ════════════"
  if [ -z "$src" ] || [ ! -f "$src" ]; then
    echo "  ❌ 找不到输入文件"
    echo "     期望：$FIXTURES/<相对路径>  或  $CACHE/<相对路径>"
    echo "     重新生成：export DEVECO_CLI_CLT_PATH=/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools; unset DEVECO_NODE_HOME"
    echo "               (cd harmony-proj && \"\$DEVECO_CLI_CLT_PATH/bin/hvigorw\" --no-daemon assembleHap)   # 本机没有 devecocli，用官方 hvigorw"
    echo "     （工程在仓库内 harmony-proj/，页面源码 harmony-proj/entry/src/main/ets/pages/*.ets；"
    echo "       转换产物落在 hvigor 的 cache，即上面的 \$CACHE）"
    echo "     再固化：cp <cache>/pages/X.ts fixtures/pages/"
    return 2
  fi
  "$NODE" tools/extract.mjs "$src" "$out" $extra || return 1

  logf="$(mktemp)"
  # fixed_port 非空时用指定端口：localStorage 按 origin 隔离，而 origin 含端口，
  # 所以"跨进程持久化"用例必须让两次运行落在同一端口上（否则是两个不同 origin）。
  python3 tools/serve.py "${fixed_port:-0}" >"$logf" 2>&1 &
  server_pid=$!
  port=""
  for _ in $(seq 1 25); do
    port="$(grep -oE 'http://127\.0\.0\.1:[0-9]+' "$logf" 2>/dev/null | head -1 | grep -oE '[0-9]+$')"
    [ -n "$port" ] && break
    sleep 0.2
  done
  if [ -z "$port" ]; then
    echo '  ❌ 服务未启动：'; sed 's/^/     /' "$logf"; kill $server_pid 2>/dev/null; rm -f "$logf"; return 1
  fi

  dom="$(timeout 60 "$CHROME" --headless --disable-gpu --no-sandbox \
    --user-data-dir="$profdir" \
    --virtual-time-budget=8000 --dump-dom "http://127.0.0.1:$port/$page$query" 2>/dev/null)"

  # 只解析 #result 节点文本再判定：整页 DOM 里含脚本源码（'=== ALL PASS ===' 字面量），
  # 直接对 DOM grep 会永远"通过"——这个假阳性陷阱必须避免。
  result="$(printf '%s' "$dom" | python3 -c "
import sys, re, html
d = sys.stdin.read()
m = re.search(r'<div id=\"result\"[^>]*>(.*?)</div>', d, re.S)
print(html.unescape(m.group(1)) if m else '（未取到 result 节点）')
")"
  echo "$result" | sed 's/^/  /'
  # 记下本用例实测 emit 的 PASS 条数（断言计数守门的输入；退出时统一比对，见文件头 finalize_counts）
  printf '%s\t%s\n' "$name" "$(printf '%s\n' "$result" | grep -cE '^[[:space:]]*PASS ')" >> "$RUN_COUNTS"

  mkdir -p build
  timeout 60 "$CHROME" --headless --disable-gpu --no-sandbox \
    --user-data-dir="$profdir" \
    --window-size=440,340 --virtual-time-budget=8000 \
    --screenshot="$HERE/build/$name.png" "http://127.0.0.1:$port/$page$query" 2>/dev/null

  kill $server_pid 2>/dev/null; wait $server_pid 2>/dev/null; rm -f "$logf"

  if printf '%s' "$result" | grep -q 'ALL PASS'; then
    echo "  ✅ $name 通过"
    return 0
  fi
  echo "  ❌ $name 失败"
  return 1
}

case "${1:-index}" in
  all)
    rc=0
    run_one index "$(src_of pages/Index.ts)"  build/app.js    test/index.html  || rc=1
    echo
    run_one rich  "$(src_of pages/Rich.ts)"   build/rich.js   test/rich.html   || rc=1
    echo
    run_one leak  "$(src_of pages/Rich.ts)"   build/rich.js   test/leak.html   || rc=1
    echo
    run_one layout "$(src_of pages/Layout.ts)" build/layout.js test/layout.html || rc=1
    echo
    run_one widgets "$(src_of pages/Widgets.ts)" build/widgets.js test/components.html || rc=1
    echo
    run_one tabgrid "$(src_of pages/TabsGrid.ts)" build/tabsgrid.js test/tabgrid.html || rc=1
    echo
    run_one swiper "$(src_of pages/SwiperDemo.ts)" build/swiperdemo.js test/swiper.html || rc=1
    echo
    run_one navdemo "$(src_of pages/NavDemo.ts)" build/navdemo.js test/navdemo.html || rc=1
    echo
    run_one reldemo "$(src_of pages/RelDemo.ts)" build/reldemo.js test/reldemo.html || rc=1
    echo
    run_one drawdemo "$(src_of pages/DrawDemo.ts)" build/drawdemo.js test/drawdemo.html || rc=1
    echo
    run_one textmeasure "$(src_of pages/TextMeasure.ts)" build/textmeasure-module.js test/textmeasure.html \
      "--cjs --register TextMeasure" || rc=1
    echo
    run_one lazyvh "$(src_of pages/LazyVar.ts)" build/lazyvar.js test/lazyvar.html || rc=1
    echo
    run_one measarea "$(src_of pages/MeasArea.ts)" build/measarea.js test/measarea.html || rc=1
    echo
    run_one measimage "$(src_of pages/MeasImage.ts)" build/measimage-module.js test/measimage.html \
      "--cjs --register MeasImage" || rc=1
    echo
    run_one measnotify "$(src_of pages/MeasNotify.ts)" build/measnotify-module.js test/measnotify.html \
      "--cjs --register MeasNotify" || rc=1
    echo
    # R20：三个模块（调用方页面 / 被启动方页面 / ability 类）
    "$NODE" tools/extract.mjs "$(src_of pages/Callee.ts)" build/callee-module.js --cjs --register Callee >/dev/null || rc=1
    "$NODE" tools/extract.mjs "$(src_of pages/PromptAct.ts)" build/promptact-module.js --cjs --register PromptAct >/dev/null || rc=1
    run_one promptaction "$(src_of entryability/PromptAbility.ts)" build/promptability-module.js test/promptaction.html \
      "--cjs --register PromptAbility" || rc=1
    echo
    run_one realfs "$(src_of pages/NetFile.ts)" build/netfile-module.js test/realfs.html \
      "--cjs --register NetFile" || rc=1
    echo
    run_one animdemo "$(src_of pages/AnimDemo.ts)" build/animdemo-module.js test/animdemo.html \
      "--cjs --register AnimDemo" || rc=1
    echo
    run_one gesturedemo "$(src_of pages/GestureDemo.ts)" build/gesturedemo-module.js test/gesturedemo.html \
      "--cjs --register GestureDemo" || rc=1
    echo
    # R22 收口：transition（组件出现/消失动画）
    run_one transitiondemo "$(src_of pages/TransitionDemo.ts)" build/transitiondemo-module.js test/transitiondemo.html \
      "--cjs --register TransitionDemo" || rc=1
    echo
    # R23 收口：手势分组 / 旋转 / 优先级仲裁
    run_one gesturegroupdemo "$(src_of pages/GestureGroupDemo.ts)" build/gesturegroupdemo-module.js test/gesturegroupdemo.html \
      "--cjs --register GestureGroupDemo" || rc=1
    echo
    # R12 收口：Navigation 标题栏 / 工具栏 / 分栏
    run_one navbardemo "$(src_of pages/NavBarDemo.ts)" build/navbardemo-module.js test/navbardemo.html \
      "--cjs --register NavBarDemo" || rc=1
    echo
    # R25 收口：Navigation push/pop 转场 + onTitleModeChange 滚动联动
    run_one navtransdemo "$(src_of pages/NavTransDemo.ts)" build/navtransdemo-module.js test/navtransdemo.html \
      "--cjs --register NavTransDemo" || rc=1
    echo
    # R26：SVG 形状族 Circle/Ellipse/Rect/Line/Path/Polygon/Polyline/Shape
    run_one shapedemo "$(src_of pages/ShapeDemo.ts)" build/shapedemo-module.js test/shapedemo.html \
      "--cjs --register ShapeDemo" || rc=1
    echo
    # R27：输入类 Checkbox/Radio/Toggle/Slider
    run_one inputdemo "$(src_of pages/InputDemo.ts)" build/inputdemo-module.js test/inputdemo.html \
      "--cjs --register InputDemo" || rc=1
    echo
    # R28：信息展示类 Badge/Counter/Divider/Marquee
    run_one showdemo "$(src_of pages/ShowDemo.ts)" build/showdemo-module.js test/showdemo.html \
      "--cjs --register ShowDemo" || rc=1
    echo
    # R29：弹出类 Select/Menu/MenuItem
    run_one popdemo "$(src_of pages/PopDemo.ts)" build/popdemo-module.js test/popdemo.html \
      "--cjs --register PopDemo" || rc=1
    echo
    # R30：UIContext
    run_one uictxdemo "$(src_of pages/UiContextDemo.ts)" build/uictxdemo-module.js test/uictxdemo.html \
      "--cjs --register UiContextDemo" || rc=1
    echo
    # R31：表层类 Canvas
    run_one canvasedemo "$(src_of pages/CanvasDemo.ts)" build/canvasedemo-module.js test/canvasedemo.html \
      "--cjs --register CanvasDemo" || rc=1
    echo
    # R32：表层类另一半 XComponent
    run_one xcompdemo "$(src_of pages/XCompDemo.ts)" build/xcompdemo-module.js test/xcompdemo.html \
      "--cjs --register XCompDemo" || rc=1
    echo
    # R33：信息展示收官 QRCode
    run_one qrdemo "$(src_of pages/QrDemo.ts)" build/qrdemo-module.js test/qrdemo.html \
      "--cjs --register QrDemo" || rc=1
    echo
    # R34：输入收官 TextInput/TextArea/Search + Hyperlink
    run_one textdemo "$(src_of pages/TextDemo.ts)" build/textdemo-module.js test/textdemo.html \
      "--cjs --register TextDemo" || rc=1
    echo
    # R35：平台模块收官 @ohos.multimedia.media
    run_one mediademo "$(src_of pages/MediaDemo.ts)" build/mediademo-module.js test/mediademo.html \
      "--cjs --register MediaDemo" || rc=1
    echo
    # R36：小件收官 Flex/Span/LoadingProgress/Blank
    run_one smalldemo "$(src_of pages/SmallDemo.ts)" build/smalldemo-module.js test/smalldemo.html \
      "--cjs --register SmallDemo" || rc=1
    echo
    # R37：分步器 Stepper/StepperItem
    run_one stepdemo "$(src_of pages/StepDemo.ts)" build/stepdemo-module.js test/stepdemo.html \
      "--cjs --register StepDemo" || rc=1
    echo
    # R45：Image 组件
    run_one imagedemo "$(src_of pages/ImageDemo.ts)" build/imagedemo-module.js test/imagedemo.html \
      "--cjs --register ImageDemo" || rc=1
    echo
    # R46：Scroll 滚动容器
    run_one scrolldemo "$(src_of pages/ScrollDemo.ts)" build/scrolldemo-module.js test/scrolldemo.html \
      "--cjs --register ScrollDemo" || rc=1
    echo
    # R47：ImageAnimator 帧动画
    run_one animatordemo "$(src_of pages/AnimatorDemo.ts)" build/animatordemo-module.js test/animatordemo.html \
      "--cjs --register AnimatorDemo" || rc=1
    echo
    # R49：ListItemGroup 分组容器
    run_one listitemgroup "$(src_of pages/ListGroupDemo.ts)" build/listitemgroup-module.js test/listitemgroup.html \
      "--cjs --register ListGroupDemo" || rc=1
    echo
    # R50：Refresh 下拉刷新
    run_one refreshdemo "$(src_of pages/RefreshDemo.ts)" build/refreshdemo-module.js test/refreshdemo.html \
      "--cjs --register RefreshDemo" || rc=1
    echo
    # R51：DatePicker 三列滚轮选择器
    run_one datepickerdemo "$(src_of pages/DatePickerDemo.ts)" build/datepickerdemo-module.js test/datepickerdemo.html \
      "--cjs --register DatePickerDemo" || rc=1
    echo
    # R52：TimePicker 时间选择器
    run_one timepickerdemo "$(src_of pages/TimePickerDemo.ts)" build/timepickerdemo-module.js test/timepickerdemo.html \
      "--cjs --register TimePickerDemo" || rc=1
    echo
    # R53：WaterFlow 瀑布流
    run_one waterflowdemo "$(src_of pages/WaterFlowDemo.ts)" build/waterflowdemo-module.js test/waterflowdemo.html \
      "--cjs --register WaterFlowDemo" || rc=1
    echo
    # R54：CalendarPicker 日期选择入口
    run_one calendarpickerdemo "$(src_of pages/CalendarPickerDemo.ts)" build/calendarpickerdemo-module.js test/calendarpickerdemo.html \
      "--cjs --register CalendarPickerDemo" || rc=1
    echo
    # R56：TextPicker 文本选择器
    run_one textpickerdemo "$(src_of pages/TextPickerDemo.ts)" build/textpickerdemo-module.js test/textpickerdemo.html \
      "--cjs --register TextPickerDemo" || rc=1
    echo
    # R57：Grid 网格
    run_one griddemo "$(src_of pages/GridDemo.ts)" build/griddemo-module.js test/griddemo.html \
      "--cjs --register GridDemo" || rc=1
    echo
    # R59：TextClock/TextTimer 时间文本双件
    run_one texttimedemo "$(src_of pages/TextTimeDemo.ts)" build/texttimedemo-module.js test/texttimedemo.html \
      "--cjs --register TextTimeDemo" || rc=1
    echo
    # R60：AlphabetIndexer 字母索引条
    run_one alphabetindexerdemo "$(src_of pages/AlphabetIndexerDemo.ts)" build/alphabetindexerdemo-module.js test/alphabetindexerdemo.html \
      "--cjs --register AlphabetIndexerDemo" || rc=1
    echo
    # R61：SideBarContainer 侧边栏容器
    run_one sidebardemo "$(src_of pages/SideBarDemo.ts)" build/sidebardemo-module.js test/sidebardemo.html \
      "--cjs --register SideBarDemo" || rc=1
    echo
    run_one measure "$(src_of pages/Measure.ts)" build/measure.js test/measure.html || rc=1
    echo
    run_one lazy "$(src_of pages/Lazy.ts)" build/lazy.js test/lazy.html || rc=1
    echo
    run_one provide "$(src_of pages/Provide.ts)" build/provide.js test/provide.html || rc=1
    echo
    run_one v2 "$(src_of pages/V2.ts)" build/v2.js test/v2.html || rc=1
    echo
    run_one observe "$(src_of pages/Observe.ts)" build/observe.js test/observe.html || rc=1
    echo
    run_one async "$(src_of pages/AsyncIO.ts)" build/asyncio-module.js test/async.html \
      "--cjs --register AsyncIO" || rc=1
    echo
    "$NODE" tools/extract.mjs "$(src_of pages/Index.ts)" build/app.js >/dev/null || rc=1
    run_one ability "$(src_of entryability/EntryAbility.ts)" build/ability-module.js test/ability.html \
      "--cjs --register EntryAbility" || rc=1
    echo
    "$NODE" tools/extract.mjs "$(src_of pages/Detail.ts)" build/detail-module.js --cjs --register Detail >/dev/null || rc=1
    run_one router "$(src_of pages/Home.ts)" build/home-module.js test/router.html "--cjs --register Home" || rc=1
    echo
    PERSIST_PROFILE="$HERE/build/chrome-profile-persist"
    rm -rf "$PERSIST_PROFILE"; mkdir -p "$PERSIST_PROFILE"   # 从干净状态开始，否则"持久化"可能是上次残留
    PERSIST_PORT="$(pick_free_port)" || { echo "  ❌ 找不到空闲端口"; rc=1; }
    run_one netfile-1 "$(src_of pages/NetFile.ts)" build/netfile-module.js test/netfile.html \
      "--cjs --register NetFile" "?phase=1" "$PERSIST_PROFILE" "$PERSIST_PORT" || rc=1
    echo
    run_one netfile-2 "$(src_of pages/NetFile.ts)" build/netfile-module.js test/netfile.html \
      "--cjs --register NetFile" "?phase=2" "$PERSIST_PROFILE" "$PERSIST_PORT" || rc=1
    exit $rc ;;
  index) run_one index "$(src_of pages/Index.ts)"  build/app.js    test/index.html ;;
  rich)  run_one rich  "$(src_of pages/Rich.ts)"   build/rich.js   test/rich.html ;;
  leak)  run_one leak  "$(src_of pages/Rich.ts)"   build/rich.js   test/leak.html ;;
  layout) run_one layout "$(src_of pages/Layout.ts)" build/layout.js test/layout.html ;;
  widgets) run_one widgets "$(src_of pages/Widgets.ts)" build/widgets.js test/components.html ;;
  tabgrid) run_one tabgrid "$(src_of pages/TabsGrid.ts)" build/tabsgrid.js test/tabgrid.html ;;
  swiper) run_one swiper "$(src_of pages/SwiperDemo.ts)" build/swiperdemo.js test/swiper.html ;;
  navdemo) run_one navdemo "$(src_of pages/NavDemo.ts)" build/navdemo.js test/navdemo.html ;;
  reldemo) run_one reldemo "$(src_of pages/RelDemo.ts)" build/reldemo.js test/reldemo.html ;;
  drawdemo) run_one drawdemo "$(src_of pages/DrawDemo.ts)" build/drawdemo.js test/drawdemo.html ;;
  textmeasure) run_one textmeasure "$(src_of pages/TextMeasure.ts)" build/textmeasure-module.js test/textmeasure.html \
      "--cjs --register TextMeasure" ;;
  lazyvh) run_one lazyvh "$(src_of pages/LazyVar.ts)" build/lazyvar.js test/lazyvar.html ;;
  measarea) run_one measarea "$(src_of pages/MeasArea.ts)" build/measarea.js test/measarea.html ;;
  measimage) run_one measimage "$(src_of pages/MeasImage.ts)" build/measimage-module.js test/measimage.html \
      "--cjs --register MeasImage" ;;
  measnotify) run_one measnotify "$(src_of pages/MeasNotify.ts)" build/measnotify-module.js test/measnotify.html \
      "--cjs --register MeasNotify" ;;
  measure) run_one measure "$(src_of pages/Measure.ts)" build/measure.js test/measure.html ;;
  lazy) run_one lazy "$(src_of pages/Lazy.ts)" build/lazy.js test/lazy.html ;;
  provide) run_one provide "$(src_of pages/Provide.ts)" build/provide.js test/provide.html ;;
  v2) run_one v2 "$(src_of pages/V2.ts)" build/v2.js test/v2.html ;;
  observe) run_one observe "$(src_of pages/Observe.ts)" build/observe.js test/observe.html ;;
  async)
    run_one async "$(src_of pages/AsyncIO.ts)" build/asyncio-module.js test/async.html \
      "--cjs --register AsyncIO" ;;
  ability)
    # ability 页需要 pages/Index 的注册产物（loadContent 要真渲染它）
    "$NODE" tools/extract.mjs "$(src_of pages/Index.ts)" build/app.js >/dev/null || exit 1
    run_one ability "$(src_of entryability/EntryAbility.ts)" build/ability-module.js test/ability.html \
      "--cjs --register EntryAbility" ;;
  promptaction)
    # 三个模块：调用方页面 / 被启动方页面 / ability 类；被启动方由 ability 的 loadContent 选页
    "$NODE" tools/extract.mjs "$(src_of pages/Callee.ts)" build/callee-module.js --cjs --register Callee >/dev/null || exit 1
    "$NODE" tools/extract.mjs "$(src_of pages/PromptAct.ts)" build/promptact-module.js --cjs --register PromptAct >/dev/null || exit 1
    run_one promptaction "$(src_of entryability/PromptAbility.ts)" build/promptability-module.js test/promptaction.html \
      "--cjs --register PromptAbility" ;;
  realfs)
    # R21：后端如实自报 + OPFS 现场探测（复用 NetFile 页面做真实读写）
    run_one realfs "$(src_of pages/NetFile.ts)" build/netfile-module.js test/realfs.html \
      "--cjs --register NetFile" ;;
  animdemo)
    # R22：animateTo / animateToImmediately → CSS transition
    run_one animdemo "$(src_of pages/AnimDemo.ts)" build/animdemo-module.js test/animdemo.html \
      "--cjs --register AnimDemo" ;;
  gesturedemo)
    # R23：手势（两层栈）→ pointer 事件
    run_one gesturedemo "$(src_of pages/GestureDemo.ts)" build/gesturedemo-module.js test/gesturedemo.html \
      "--cjs --register GestureDemo" ;;
  transitiondemo)
    # R22 收口：transition（出现/消失动画）
    run_one transitiondemo "$(src_of pages/TransitionDemo.ts)" build/transitiondemo-module.js test/transitiondemo.html \
      "--cjs --register TransitionDemo" ;;
  gesturegroupdemo)
    # R23 收口：手势分组 / 旋转 / 优先级仲裁
    run_one gesturegroupdemo "$(src_of pages/GestureGroupDemo.ts)" build/gesturegroupdemo-module.js test/gesturegroupdemo.html \
      "--cjs --register GestureGroupDemo" ;;
  navbardemo)
    # R12 收口：Navigation 标题栏 / 工具栏 / 分栏
    run_one navbardemo "$(src_of pages/NavBarDemo.ts)" build/navbardemo-module.js test/navbardemo.html \
      "--cjs --register NavBarDemo" ;;
  navtransdemo)
    # R25 收口：Navigation push/pop 转场 + onTitleModeChange 滚动联动
    run_one navtransdemo "$(src_of pages/NavTransDemo.ts)" build/navtransdemo-module.js test/navtransdemo.html \
      "--cjs --register NavTransDemo" ;;
  shapedemo)
    # R26：SVG 形状族
    run_one shapedemo "$(src_of pages/ShapeDemo.ts)" build/shapedemo-module.js test/shapedemo.html \
      "--cjs --register ShapeDemo" ;;
  inputdemo)
    # R27：输入类
    run_one inputdemo "$(src_of pages/InputDemo.ts)" build/inputdemo-module.js test/inputdemo.html \
      "--cjs --register InputDemo" ;;
  showdemo)
    # R28：信息展示类
    run_one showdemo "$(src_of pages/ShowDemo.ts)" build/showdemo-module.js test/showdemo.html \
      "--cjs --register ShowDemo" ;;
  popdemo)
    # R29：弹出类
    run_one popdemo "$(src_of pages/PopDemo.ts)" build/popdemo-module.js test/popdemo.html \
      "--cjs --register PopDemo" ;;
  uictxdemo)
    # R30：UIContext
    run_one uictxdemo "$(src_of pages/UiContextDemo.ts)" build/uictxdemo-module.js test/uictxdemo.html \
      "--cjs --register UiContextDemo" ;;
  canvasedemo)
    # R31：表层类 Canvas
    run_one canvasedemo "$(src_of pages/CanvasDemo.ts)" build/canvasedemo-module.js test/canvasedemo.html \
      "--cjs --register CanvasDemo" ;;
  xcompdemo)
    # R32：表层类另一半 XComponent
    run_one xcompdemo "$(src_of pages/XCompDemo.ts)" build/xcompdemo-module.js test/xcompdemo.html \
      "--cjs --register XCompDemo" ;;
  qrdemo)
    # R33：信息展示收官 QRCode
    run_one qrdemo "$(src_of pages/QrDemo.ts)" build/qrdemo-module.js test/qrdemo.html \
      "--cjs --register QrDemo" ;;
  textdemo)
    # R34：输入收官
    run_one textdemo "$(src_of pages/TextDemo.ts)" build/textdemo-module.js test/textdemo.html \
      "--cjs --register TextDemo" ;;
  mediademo)
    # R35：平台模块收官
    run_one mediademo "$(src_of pages/MediaDemo.ts)" build/mediademo-module.js test/mediademo.html \
      "--cjs --register MediaDemo" ;;
  smalldemo)
    # R36：小件收官
    run_one smalldemo "$(src_of pages/SmallDemo.ts)" build/smalldemo-module.js test/smalldemo.html \
      "--cjs --register SmallDemo" ;;
  stepdemo)
    # R37：分步器
    run_one stepdemo "$(src_of pages/StepDemo.ts)" build/stepdemo-module.js test/stepdemo.html \
      "--cjs --register StepDemo" ;;
  imagedemo)
    # R45：Image
    run_one imagedemo "$(src_of pages/ImageDemo.ts)" build/imagedemo-module.js test/imagedemo.html \
      "--cjs --register ImageDemo" ;;
  scrolldemo)
    # R46：Scroll
    run_one scrolldemo "$(src_of pages/ScrollDemo.ts)" build/scrolldemo-module.js test/scrolldemo.html \
      "--cjs --register ScrollDemo" ;;
  animatordemo)
    # R47：ImageAnimator
    run_one animatordemo "$(src_of pages/AnimatorDemo.ts)" build/animatordemo-module.js test/animatordemo.html \
      "--cjs --register AnimatorDemo" ;;
  listitemgroup)
    # R49：ListItemGroup
    run_one listitemgroup "$(src_of pages/ListGroupDemo.ts)" build/listitemgroup-module.js test/listitemgroup.html \
      "--cjs --register ListGroupDemo" ;;
  refreshdemo)
    # R50：Refresh
    run_one refreshdemo "$(src_of pages/RefreshDemo.ts)" build/refreshdemo-module.js test/refreshdemo.html \
      "--cjs --register RefreshDemo" ;;
  datepickerdemo)
    # R51：DatePicker
    run_one datepickerdemo "$(src_of pages/DatePickerDemo.ts)" build/datepickerdemo-module.js test/datepickerdemo.html \
      "--cjs --register DatePickerDemo" ;;
  timepickerdemo)
    # R52：TimePicker
    run_one timepickerdemo "$(src_of pages/TimePickerDemo.ts)" build/timepickerdemo-module.js test/timepickerdemo.html \
      "--cjs --register TimePickerDemo" ;;
  waterflowdemo)
    # R53：WaterFlow
    run_one waterflowdemo "$(src_of pages/WaterFlowDemo.ts)" build/waterflowdemo-module.js test/waterflowdemo.html \
      "--cjs --register WaterFlowDemo" ;;
  calendarpickerdemo)
    # R54：CalendarPicker
    run_one calendarpickerdemo "$(src_of pages/CalendarPickerDemo.ts)" build/calendarpickerdemo-module.js test/calendarpickerdemo.html \
      "--cjs --register CalendarPickerDemo" ;;
  textpickerdemo)
    # R56：TextPicker
    run_one textpickerdemo "$(src_of pages/TextPickerDemo.ts)" build/textpickerdemo-module.js test/textpickerdemo.html \
      "--cjs --register TextPickerDemo" ;;
  griddemo)
    # R57：Grid
    run_one griddemo "$(src_of pages/GridDemo.ts)" build/griddemo-module.js test/griddemo.html \
      "--cjs --register GridDemo" ;;
  texttimedemo)
    # R59：TextClock/TextTimer
    run_one texttimedemo "$(src_of pages/TextTimeDemo.ts)" build/texttimedemo-module.js test/texttimedemo.html \
      "--cjs --register TextTimeDemo" ;;
  alphabetindexerdemo)
    # R60：AlphabetIndexer
    run_one alphabetindexerdemo "$(src_of pages/AlphabetIndexerDemo.ts)" build/alphabetindexerdemo-module.js test/alphabetindexerdemo.html \
      "--cjs --register AlphabetIndexerDemo" ;;
  sidebardemo)
    # R61：SideBarContainer
    run_one sidebardemo "$(src_of pages/SideBarDemo.ts)" build/sidebardemo-module.js test/sidebardemo.html \
      "--cjs --register SideBarDemo" ;;
  router)
    # 两个页面都要注册；Detail 先单独产出，Home 由 run_one 带 flags 产出
    "$NODE" tools/extract.mjs "$(src_of pages/Detail.ts)" build/detail-module.js --cjs --register Detail >/dev/null || exit 1
    run_one router "$(src_of pages/Home.ts)" build/home-module.js test/router.html "--cjs --register Home" ;;
  netfile|persist)
    # 两阶段跨进程持久化：phase1 在进程 A 写盘 → phase2 在【全新进程 B】读取。
    # 两阶段必须共用同一个 Chrome profile（localStorage 后端靠它跨进程存活）；
    # Electron 侧则共用 electron/data 真实目录。
    PERSIST_PROFILE="$HERE/build/chrome-profile-persist"
    rm -rf "$PERSIST_PROFILE"; mkdir -p "$PERSIST_PROFILE"   # 见 all 分支的说明
    PERSIST_PORT="$(pick_free_port)" || { echo "  ❌ 找不到空闲端口"; exit 1; }
    run_one netfile-1 "$(src_of pages/NetFile.ts)" build/netfile-module.js test/netfile.html \
      "--cjs --register NetFile" "?phase=1" "$PERSIST_PROFILE" "$PERSIST_PORT" || exit 1
    echo
    run_one netfile-2 "$(src_of pages/NetFile.ts)" build/netfile-module.js test/netfile.html \
      "--cjs --register NetFile" "?phase=2" "$PERSIST_PROFILE" "$PERSIST_PORT" ;;
  *) echo "用法: bash run.sh [index|rich|leak|layout|widgets|tabgrid|swiper|navdemo|reldemo|drawdemo|textmeasure|lazyvh|measarea|measimage|measnotify|promptaction|realfs|animdemo|gesturedemo|transitiondemo|gesturegroupdemo|navbardemo|navtransdemo|shapedemo|inputdemo|showdemo|popdemo|uictxdemo|canvasedemo|xcompdemo|qrdemo|textdemo|mediademo|smalldemo|stepdemo|imagedemo|scrolldemo|animatordemo|listitemgroup|refreshdemo|datepickerdemo|timepickerdemo|waterflowdemo|calendarpickerdemo|textpickerdemo|griddemo|texttimedemo|alphabetindexerdemo|sidebardemo|measure|lazy|provide|async|ability|router|netfile|all]"; exit 2 ;;
esac
