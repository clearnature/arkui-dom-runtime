#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# hm-2in1.sh —— 2in1 桌面（PC 形态）设备侧采集（R167 切片 3 脚本化封装）
#
# 配方=docs/HARMONYOS-EMULATOR.md §4 + R167 三坑：装包后「添加到桌面」对话框挡
# 启动（dump 找按钮点掉）、hdcPort 必须 10000-16555（实例用 16001）、osVersion
# 用 imageList 原文格式。与 hm-run.sh（phone）平行的薄驱动——只做设备侧文本
# 采集（WinSem 等窗口语义页的对拍=与 Electron 侧 test 页人工/断言语义对照）。
#
# 用法：bash tools/hm-2in1.sh [pages/X ...]（默认 pages/WinSem）
# 缺席显式跳过（实例未建/未起 → exit 0，同 hm-run 先例）。
# 产物：stdout 摘要 + build/hm-2in1/<page>.txt（JSON dump 全文）
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

CLT="${HM_CLT:-/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools}"
HDC="$CLT/sdk/default/openharmony/toolchains/hdc"
EMU="$CLT/emulator/Emulator"
INSTPATH="${HM_INSTANCE_PATH:-/data/training/cli/emulator-images/instances}"
IMAGEROOT="${HM_IMAGE_ROOT:-/data/training/cli/emulator-images}"
TARGET_PORT="${HM_2IN1_PORT:-16001}"
BUNDLE="com.example.arkuidomprobe"
HAP="${HM_HAP:-$HERE/harmony-proj/entry/build/default/outputs/default/entry-default-unsigned.hap}"

PAGES=("$@")
[ ${#PAGES[@]} -gt 0 ] || PAGES=(pages/WinSem)
for pg in "${PAGES[@]}"; do
  [[ "$pg" =~ ^pages/[A-Za-z][A-Za-z0-9_]*$ ]] || { echo "❌ 非法页名: $pg"; exit 2; }
done

step() { echo "══ $*"; }

# ── 0) 缺席检查：实例存在 + 起机 ──
if ! "$EMU" -list -instancePath "$INSTPATH" 2>/dev/null | grep -q hmtest_2in1; then
  echo "⏭  hm-2in1 跳过：实例 hmtest_2in1 未建（见 HARMONYOS-EMULATOR §4——镜像已装时 -create hmtest_2in1 -deviceType 2in1 -osVersion \"HarmonyOS 7.0.0(26.0.0)\" …）"
  exit 0
fi
if ! pgrep -f "Emulator -start hmtest_2in1" >/dev/null 2>&1; then
  step "起机 hmtest_2in1（hdcPort $TARGET_PORT——范围必须 10000-16555）"
  setsid nohup "$EMU" -start hmtest_2in1 -instancePath "$INSTPATH" -imageRoot "$IMAGEROOT" \
    -noWindow -hdcPort "$TARGET_PORT" >"${TMPDIR:-/tmp}/hm2in1-boot.log" 2>&1 &
  sleep 2
fi

export HDC_SERVER_PORT=5557
T2="127.0.0.1:$TARGET_PORT"
step "连靶 $T2（轮询 5 分钟）"
ok=0
for i in $(seq 1 60); do
  "$HDC" tconn "$T2" >/dev/null 2>&1
  if "$HDC" -t "$T2" shell "echo ok" 2>/dev/null | grep -q ok; then ok=1; echo "  [$i] 已连"; break; fi
  sleep 5
done
if [ "$ok" != 1 ]; then
  echo "❌ 2in1 连接失败（boot 日志：${TMPDIR:-/tmp}/hm2in1-boot.log）"; exit 1
fi

# ── 1) 装包 ──
step "装包"
[ -f "$HAP" ] || { echo "❌ 缺 HAP（先 cd harmony-proj && hvigorw assembleHap）"; exit 1; }
"$HDC" -t "$T2" install -r "$HAP" >/dev/null 2>&1 || { echo "❌ install 失败"; exit 1; }

# ── 2) 解锁 + 清「添加到桌面」对话框（R167 坑：一次性系统对话框挡启动）──
step "解锁 + 关装包对话框"
"$HDC" -t "$T2" shell "power-shell wakeup" >/dev/null 2>&1
"$HDC" -t "$T2" shell "uitest uiInput swipe 400 2200 400 600 500" >/dev/null 2>&1
sleep 1
"$HDC" -t "$T2" shell "uitest dumpLayout -p /data/local/tmp/ly-dialog.xml" >/dev/null 2>&1
"$HDC" -t "$T2" file recv /data/local/tmp/ly-dialog.xml "${TMPDIR:-/tmp}/ly-dialog.xml" >/dev/null 2>&1
if [ -s "${TMPDIR:-/tmp}/ly-dialog.xml" ]; then
  # 找「添加」按钮中心点并点击（R167 实录坐标法：bounds 中心）
  # 单引号 python（bash 零展开——set -u 下 \${TMPDIR} 未设曾直接 unbound 炸）
  BTN=$(python3 -c '
import json, sys, os, re
p = os.path.join(os.environ.get("TMPDIR", "/tmp"), "ly-dialog.xml")
try:
    d = json.load(open(p, encoding="utf-8"))
except Exception:
    sys.exit(0)
def walk(n):
    a = n.get("attributes", {})
    if (a.get("text") or "").strip() == "添加":
        b = a.get("bounds") or ""
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", b)
        if m:
            x = (int(m.group(1)) + int(m.group(3))) // 2
            y = (int(m.group(2)) + int(m.group(4))) // 2
            print("%d %d" % (x, y))
        return True
    return any(walk(c) for c in (n.get("children") or []))
walk(d)' 2>/dev/null)
  if [ -n "$BTN" ]; then
    echo "  点击装包对话框（$BTN）"
    # shellcheck disable=SC2086  # 坐标为 python 输出的两个整数
    "$HDC" -t "$T2" shell "uitest uiInput click $BTN" >/dev/null 2>&1
    sleep 2
  fi
fi

rc=0
for pg in "${PAGES[@]}"; do
  step "启动 $pg"
  "$HDC" -t "$T2" shell "aa force-stop $BUNDLE" >/dev/null 2>&1
  sleep 2
  if ! "$HDC" -t "$T2" shell "aa start -b $BUNDLE -a EntryAbility --ps hm_page "$pg"" >/dev/null 2>&1; then
    echo "❌ aa start 失败: $pg"; rc=1; continue
  fi
  sleep 7
  "$HDC" -t "$T2" shell "uitest dumpLayout -p /data/local/tmp/ly.xml" >/dev/null 2>&1
  "$HDC" -t "$T2" file recv /data/local/tmp/ly.xml "${TMPDIR:-/tmp}/ly-2in1.xml" >/dev/null 2>&1
  OUT="build/hm-2in1/$(echo "$pg" | sed 's|pages/||').xml"
  mkdir -p build/hm-2in1
  cp "${TMPDIR:-/tmp}/ly-2in1.xml" "$OUT" 2>/dev/null || true
  python3 - "$OUT" "$pg" <<'PYEOF'
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding='utf-8'))
except Exception as e:
    print("❌ dump 解析失败: %s" % e); sys.exit(1)
page = sys.argv[2]
found = {"pagePath": None, "texts": []}
def walk(n, in_app=False):
    a = n.get("attributes", {})
    app = in_app or a.get("bundleName") == "com.example.arkuidomprobe"
    if app and a.get("pagePath"):
        found["pagePath"] = a.get("pagePath")
    if app:
        for k in ("text", "originalText"):
            v = (a.get(k) or "").strip()
            if v:
                found["texts"].append(v)
    for c in n.get("children") or []:
        walk(c, app)
walk(d)
if found["pagePath"] != page:
    print("❌ 启动标记失败: pagePath=%s（期望 %s）" % (found["pagePath"], page))
    sys.exit(1)
seen = []
for t in found["texts"]:
    if not seen or seen[-1] != t:
        seen.append(t)
print("✅ %s → %s" % (page, "".join(seen)))
PYEOF
  [ $? -eq 0 ] || rc=1
done
exit $rc
