#!/usr/bin/env bash
# libkernel_hs.so 构建脚本（R114：Haskell/GHC 内核——trha 数据面对齐）
#   bash kernel/hs/build.sh
# 无外部包依赖（base/stm/containers 均 GHC boot）；需 GHC ≥ 9.14（本机 9.14.1）。
# 两个必须旗标（实测，见 kernel.hs 头注）：
#   -package-env=-  全局环境带 ollama/req 等无关包会全量链入
#   -dynamic        inplace GHC 静态包非 PIC，链共享对象报 R_X86_64_32S
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
ghc -package-env=- -shared -fPIC -dynamic -O2 kernel.hs -o libkernel_hs.so
echo "✅ libkernel_hs.so 构建完成（GHC $(ghc --numeric-version)，trha 数据面）"
