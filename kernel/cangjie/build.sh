#!/usr/bin/env bash
# libkernel.so 构建脚本（R103）
#
#   bash kernel/cangjie/build.sh              # release（-O2，默认）
#   BUILD=debug bash kernel/cangjie/build.sh  # debug（-O0，默认档）
#
# 前置：cjc 在 PATH（source <SDK>/envsetup.sh；本机默认 nightly-current 已在 .bashrc 注入）
# 实测（2026-09-27，nightly 1.3.0-alpha）：fib(32) debug 60ms → release 见 git 提交记录
# 产物：kernel/cangjie/libkernel.so（覆盖式；构建档记录在同目录 .build-profile）
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD="${BUILD:-release}"

case "$BUILD" in
  release) OPT=(-O2) ;;
  debug)   OPT=(-O0) ;;
  *) echo "BUILD 仅支持 release|debug，得到：$BUILD" >&2; exit 2 ;;
esac

cd "$HERE"
# R109：RPATH=$ORIGIN（老式 tag，链式传递到二层依赖）——打包态把 仓颉运行时 .so 集
# 与 libkernel.so 放同目录即可零 LD_LIBRARY_PATH 加载（RUNPATH 不传递、glibc 对无
# SONAME 库不按 basename 匹配，两个实测否决见 ROADMAP R109）。
cjc src/kernel.cj --output-type=dylib "${OPT[@]}" \
    --link-options '--disable-new-dtags -rpath=$ORIGIN' -o libkernel.so
printf '%s\n' "$BUILD" > .build-profile
echo "✅ libkernel.so 构建完成（$BUILD，cjc ${OPT[*]}，RPATH=\$ORIGIN）"
