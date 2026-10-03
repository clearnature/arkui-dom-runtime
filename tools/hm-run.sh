#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# hm-run.sh —— 第六端（官方模拟器 oracle）脚本化冒烟
# （docs/HARMONYOS-EMULATOR.md §6 切片 1；配方=同文 §4 六步，2026-10-02 实测）
#
# 六步：①起机（未运行时）→ ②hdc 连靶 → ③装包 → ④aa start →
#       ⑤WMS 首帧判定（hilog）→ ⑥截图留档
#
# 缺席显式跳过（同 webkit 第 6c 步先例）：Emulator/hdc/HAP 任一缺席 → 退出 0。
# 可覆盖：HM_CLT / HM_HAP / HM_INSTANCE / HM_INSTANCE_PATH / HM_IMAGE_ROOT / HM_SHOTS
# 退出码：0=冒烟通过或跳过；1=起机/连接/装包/首帧任一失败。
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLT="${HM_CLT:-/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools}"
EMU="$CLT/emulator/Emulator"
HDC="$CLT/sdk/default/openharmony/toolchains/hdc"
HAP="${HM_HAP:-$HERE/harmony-proj/entry/build/default/outputs/default/entry-default-unsigned.hap}"
INSTANCE="${HM_INSTANCE:-hmtest_phone}"
INSTPATH="${HM_INSTANCE_PATH:-/data/training/cli/emulator-images/instances}"
IMAGEROOT="${HM_IMAGE_ROOT:-/data/training/cli/emulator-images}"
SHOTS="${HM_SHOTS:-$HERE/build}"
BUNDLE="com.example.arkuidomprobe"
ABILITY="EntryAbility"

step() { echo "══ $*"; }

for f in "$EMU" "$HDC"; do
  [ -x "$f" ] || { echo "⏭  hm-run 跳过：缺 $f（HM_CLT 可覆盖 CLT 路径）"; exit 0; }
done
[ -f "$HAP" ] || { echo "⏭  hm-run 跳过：缺 HAP（先 cd harmony-proj && devecocli build）：$HAP"; exit 0; }

# ① 起机（已在运行则复用——pgrep 精确匹配实例名）
if ! pgrep -f "Emulator -start $INSTANCE" >/dev/null 2>&1; then
  step "① 起机 $INSTANCE（后台；软渲冷启动实测 2-6 分钟）"
  setsid nohup "$EMU" -start "$INSTANCE" -instancePath "$INSTPATH" -imageRoot "$IMAGEROOT" -noWindow \
    >"${TMPDIR:-/tmp}/hm-run-boot.log" 2>&1 &
  sleep 2
else
  step "① 模拟器已在运行（复用）"
fi

# ② hdc 连靶（轮询 5 分钟；坑：必须 export HDC_SERVER_PORT。
#    R161 实录：桥接端口随 boot 漂移（10/02 实测 5557，本次 5555）——以
#    list targets 非空为准，tconn 只作两端口探测/催化）
step "② hdc 连靶（轮询 5 分钟，端口自适应）"
export HDC_SERVER_PORT=5557
ok=0
for i in $(seq 1 60); do
  "$HDC" tconn 127.0.0.1:5557 >/dev/null 2>&1
  "$HDC" tconn 127.0.0.1:5555 >/dev/null 2>&1
  tgt=$("$HDC" list targets 2>/dev/null | grep -v Empty | head -1)
  if [ -n "$tgt" ]; then ok=1; echo "  [$i] target=$tgt"; break; fi
  sleep 5
done
if [ "$ok" != 1 ]; then
  echo "❌ hdc 连接失败（5 分钟超时）"
  echo "   boot 日志：${TMPDIR:-/tmp}/hm-run-boot.log；guest 内核：$INSTPATH/$INSTANCE/Log/kernel.log"
  exit 1
fi
"$HDC" list targets

# ③ 装包（unsigned 在模拟器宽容；真机需 debug 签名——§7 记档）
step "③ 装包"
if ! "$HDC" install -r "$HAP"; then echo "❌ install 失败"; exit 1; fi

# ④ 解锁 + 启动应用（R161 实录：锁屏状态 aa start 报 10106102 拒启——
#    开发者模式不能自动解锁；power-shell wakeup + uitest 上滑解锁可过）
step "④ 解锁 + 启动 $BUNDLE/$ABILITY"
"$HDC" shell "power-shell wakeup" >/dev/null 2>&1
"$HDC" shell "uitest uiInput swipe 400 2200 400 600 500" >/dev/null 2>&1
sleep 2
if ! "$HDC" shell aa start -b "$BUNDLE" -a "$ABILITY"; then echo "❌ aa start 失败"; exit 1; fi
sleep 8

# ⑤ 渲染判定（R161 实录：首帧 hilog 信号随版本漂移——10/02 构建=
#    WMS NotifyCompleteFirstFrameDrawing；本构建=SCBSceneSession
#    onBufferAvailableChange isBufferAvailable: true。两个模式都认）
step "⑤ 渲染判定（hilog 双模式）"
first=$("$HDC" shell "hilog -x | grep -i $BUNDLE | grep -cE 'NotifyCompleteFirstFrameDrawing|onBufferAvailableChange, isBufferAvailable: true'" 2>/dev/null | tr -d '[:space:]')
first=${first:-0}
echo "  首帧计数 = $first"
if [ "$first" -ge 1 ]; then
  echo "  ✅ 首帧已渲染（真 ArkUI）"
else
  echo "  ❌ 未见首帧（hilog 尾部：）"
  "$HDC" shell "hilog -x | grep -i $BUNDLE | tail -5" 2>/dev/null | sed 's/^/     /'
fi

# ⑥ 截图（坑：-screenshotPath 目录必须预先存在；独立子目录防与 electron 截图混列）
step "⑥ 截图"
mkdir -p "$SHOTS/hm"
"$EMU" -instance "$INSTANCE" -screenshot -screenshotPath "$SHOTS/hm" \
  -instancePath "$INSTPATH" -imageRoot "$IMAGEROOT" 2>&1 | tail -1
latest=$(ls -t "$SHOTS"/hm/*.png 2>/dev/null | head -1)
[ -n "$latest" ] && echo "  最新截图：$latest"

[ "$first" -ge 1 ] || exit 1
echo "✅ hm-run 冒烟通过（第六端真 ArkUI 渲染实证）"
