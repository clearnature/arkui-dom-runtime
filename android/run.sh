#!/usr/bin/env bash
# Android(System WebView) 第五端全矩阵驱动（R149）—— 同用例表 × 移动 Blink
#
#   bash android/run.sh            # 全部用例（用例表 = run.sh all 块，单一事实来源）
#   bash android/run.sh <用例名>   # 只跑名字含该子串的用例
#
# 依赖：Android SDK（/data/android-sdk：adb/emulator，许可已由用户接受）+ 模拟器
# AVD arkui_test（API35 x86_64）+ venv（websocket-client + 内嵌 serve）。
# 依赖缺席则显式跳过并声明原因（同 supply/firefox/webkit 步纪律，绝不冒充通过）。
# 链路：起模拟器（无窗）→ 起 WebView Shell → 发现 webview_devtools_remote socket
# （含 PID，重启会变；case 白名单守卫）→ adb forward tcp:9222 → tools/an-matrix.py
# 原始 CDP 驱动（playwright connectOverCDP 不支持 WebView，实测坑）。
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
cd "$ROOT"

mkdir -p /data/tmp
export TMPDIR=/data/tmp

NODE=/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools/tool/node/bin/node
SDK=/data/android-sdk
ADB="$SDK/platform-tools/adb"
EMU_SERIAL=emulator-5554
WK_PY=/data/tmp/wk-venv/bin/python
target="${1:-all}"

# ── 依赖定位：SDK/模拟器/venv 任一缺席则显式跳过 ──
if [ ! -x "$ADB" ] || [ ! -d "$SDK/emulator" ] || [ ! -x "$WK_PY" ]; then
  printf '════ android (android/run.sh %s) ════\n' "$target"
  printf '  ⏭  跳过（原因：Android SDK 或测试 venv 不齐（找 %s / %s 失败）。\n' "$ADB" "$WK_PY"
  printf '      Android 是移动 Blink 兼容性加分端；补齐后本步自动转真）\n'
  exit 0
fi

# ── 模拟器：未起则起（无窗；-no-snapshot 每次冷启，状态可复现）──
if ! "$ADB" devices | grep -q "$EMU_SERIAL"; then
  "$SDK/emulator/emulator" -avd arkui_test -no-window -no-audio -no-boot-anim \
    -gpu swiftshader_indirect -no-snapshot -port 5554 >/data/tmp/emulator.log 2>&1 &
fi
boot=""
for _ in $(seq 1 60); do
  boot="$("$ADB" -s "$EMU_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
  [ "$boot" = "1" ] && break
  sleep 5
done
if [ "$boot" != "1" ]; then
  printf '  ❌ 模拟器未完成启动（sys.boot_completed != 1）\n'
  exit 1
fi

# ── 用例计划：与 Firefox/WebKit 同一份解析产物 ──
mkdir -p build
python3 tools/ff-plan.py > build/ff-plan.jsonl || exit 1
plan_n="$(grep -c '^{' build/ff-plan.jsonl 2>/dev/null || true)"
plan_n="${plan_n:-0}"
raw_n="$(sed -n '/^  all)/,/^    exit \$rc ;;/p' run.sh | grep -cE '^[[:space:]]*(VTBUDGET=[0-9]+[[:space:]]+)?run_one ' || true)"
raw_n="${raw_n:-0}"
if [ "$plan_n" -ne "$raw_n" ]; then
  printf '  ❌ 计划用例数(%d) ≠ all 块 run_one 行数(%d)——ff-plan 解析漂移\n' "$plan_n" "$raw_n"
  exit 1
fi

# ── 宿主 serve.py（固定 41790；经 adb reverse 直通设备 localhost——10.0.2.2 NAT
#    实测 ERR_EMPTY_RESPONSE 不可靠，R149）──
pkill -f "serve.py 4179[0]" 2>/dev/null && sleep 0.5
python3 tools/serve.py 41790 >/data/tmp/an-serve.log 2>&1 &
SERVE_PID=$!
cleanup() {
  kill "$SERVE_PID" 2>/dev/null
}
trap cleanup EXIT
for _ in $(seq 1 30); do
  curl -s -o /dev/null http://127.0.0.1:41790/test/index.html && break
  sleep 0.3
done
"$ADB" -s "$EMU_SERIAL" reverse tcp:41790 tcp:41790

# ── WebView Shell：打开首页（shell 常驻，后续每用例经 CDP Page.navigate 换页）──
"$ADB" -s "$EMU_SERIAL" shell am start -W -n \
  org.chromium.webview_shell/.WebViewBrowserActivity \
  -d "http://127.0.0.1:41790/test/index.html" >/dev/null 2>&1
sleep 4

# ── socket 发现（PID 会变）+ 白名单守卫 + forward ──
name="$("$ADB" -s "$EMU_SERIAL" shell cat /proc/net/unix 2>/dev/null \
  | grep -oE 'webview_devtools_remote_[0-9]+' | head -1)"
case "$name" in
  webview_devtools_remote_[0-9]*) ;;   # 严格白名单：socket 名只接受此形态
  *) printf '  ❌ devtools socket 未发现或形态异常: %s\n' "${name:-(空)}"; exit 1 ;;
esac
"$ADB" -s "$EMU_SERIAL" forward tcp:9222 "localabstract:$name"

# ── 跑矩阵（失败先整批重试一次：shell 重建后 socket 换名）──
if [ "$target" = "all" ]; then
  "$WK_PY" tools/an-matrix.py >build/an-matrix.log 2>&1 || \
  { sleep 2; name="$("$ADB" -s "$EMU_SERIAL" shell cat /proc/net/unix 2>/dev/null \
      | grep -oE 'webview_devtools_remote_[0-9]+' | head -1)"
    case "$name" in webview_devtools_remote_[0-9]*)
      "$ADB" -s "$EMU_SERIAL" forward tcp:9222 "localabstract:$name" ;;
    esac
    "$WK_PY" tools/an-matrix.py >build/an-matrix.log 2>&1; }
else
  "$WK_PY" tools/an-matrix.py "$target" >build/an-matrix.log 2>&1 || \
  { sleep 2; name="$("$ADB" -s "$EMU_SERIAL" shell cat /proc/net/unix 2>/dev/null \
      | grep -oE 'webview_devtools_remote_[0-9]+' | head -1)"
    case "$name" in webview_devtools_remote_[0-9]*)
      "$ADB" -s "$EMU_SERIAL" forward tcp:9222 "localabstract:$name" ;;
    esac
    "$WK_PY" tools/an-matrix.py "$target" >build/an-matrix.log 2>&1; }
fi
rc=$?
grep -E '^(SUMMARY|CASE|----|  )' build/an-matrix.log | sed 's/^/  /'
grep '^CASE' build/an-matrix.log | awk -F'\t' '{print $2 "\t" $4}' > build/assert-counts-android.tsv

# ── 判定 ──
badcases="$(grep -E $'\t(FAIL|TIMEOUT|ERROR)\t' build/an-matrix.log || true)"
if [ -n "$badcases" ]; then
  printf '  ❌ Android 矩阵有非 PASS 用例：\n'
  printf '  %s\n' "$badcases"
  rc=1
fi

# ── 断言计数守门（Android 端：分端覆盖表见 android/assert-overrides.tsv）──
if ! "$NODE" tools/assert-counts.mjs --browser build/assert-counts-android.tsv \
    --overrides android/assert-overrides.tsv --label "Android"; then
  rc=1
fi

if [ "$rc" -eq 0 ]; then
  ver="$("$ADB" -s "$EMU_SERIAL" shell dumpsys package com.android.webview 2>/dev/null | grep -oE 'versionName=[^ ]+' | head -1)"
  printf '  ✅ android 全矩阵通过（System WebView %s）\n' "${ver:-?}"
fi
exit $rc
