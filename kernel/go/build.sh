#!/usr/bin/env bash
# libkernel_go.so 构建脚本（R116：Go 内核——DeepSeek-Reasonix 数据面对齐）
#   bash kernel/go/build.sh
# 前置：Go ≥ 1.26（本机 1.27.1）；无外部依赖（仅标准库 encoding/json + sync）。
# 形态：-buildmode=c-shared —— Go runtime 静态链进 .so，产物仅依赖 libc，
#       dlopen 时 constructor 自初始化（零宿主序，rtLib="" 挂载，同纯 C 路径）。
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
go build -buildmode=c-shared -o libkernel_go.so kernel.go
echo "✅ libkernel_go.so 构建完成（$(go version | awk '{print $3}'), c-shared，仅依赖 libc）"
