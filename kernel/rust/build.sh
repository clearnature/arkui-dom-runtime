#!/usr/bin/env bash
# libkernel_rs.so 构建脚本（R117：Rust 内核——claurst 数据面对齐）
#   bash kernel/rust/build.sh
# 前置：rustc ≥ 1.75（本机 1.93.1）；零外部 crate（仓库零依赖纪律，无 cargo 联网）。
# 形态：--crate-type=cdylib —— Rust 运行时静态链进 .so，产物依赖仅 libgcc_s+libc，
#       dlopen 直调（无宿主序，同 Go/纯 C 路径）。
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
rustc --crate-type=cdylib -O kernel.rs -o libkernel_rs.so
echo "✅ libkernel_rs.so 构建完成（$(rustc --version | awk '{print $2}')，cdylib，依赖 libgcc_s+libc）"
