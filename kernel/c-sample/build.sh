#!/usr/bin/env bash
# libkernel_c.so 构建脚本（R107：纯 C 样例内核）
#   bash kernel/c-sample/build.sh
# 无 SDK 依赖（纯 gcc）；产物 kernel/c-sample/libkernel_c.so
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
gcc -shared -fPIC -O2 -pthread kernel.c -o libkernel_c.so
echo "✅ libkernel_c.so 构建完成（纯 C，无运行时依赖）"
