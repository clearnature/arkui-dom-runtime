#!/usr/bin/env bash
# R119：五内核统一契约套件编排——同一份断言证明五语言契约等价
#   bash kernel/run-contract.sh            # 跑全部五内核
#   bash kernel/run-contract.sh c          # 只跑指定名（c/hs/go/rs/cangjie）
# 依赖：gcc；仓颉需 SDK 运行时库（自动探测 nightly-current）；GHC ≥9.14。
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
cd "$ROOT"

CJ_RT="${CANGJIE_RT_LIB:-/data/work/compiler/cangjie/Nightly/cangjie-nightly-current/runtime/lib/linux_x86_64_cjnative}"
GHC_LIB="${GHC_LIB_DIR:-/usr/local/lib/ghc-9.14.1/lib/x86_64-linux-ghc-9.14.1-inplace}"

gcc -O2 -o kernel/contract_common kernel/contract_common.c -ldl || exit 1

only="${1:-all}"
rc=0
run() {
  local label="$1"; shift
  echo "════ contract: $label ════"
  if ! "$@" ; then rc=1; fi
  echo
}

if [ "$only" = "all" ] || [ "$only" = "c" ]; then
  run "纯C(direct)" ./kernel/contract_common direct kernel/c-sample/libkernel_c.so
fi
if [ "$only" = "all" ] || [ "$only" = "go" ]; then
  run "Go(direct)" ./kernel/contract_common direct kernel/go/libkernel_go.so
fi
if [ "$only" = "all" ] || [ "$only" = "rs" ]; then
  run "Rust(direct)" ./kernel/contract_common direct kernel/rust/libkernel_rs.so
fi
if [ "$only" = "all" ] || [ "$only" = "cangjie" ]; then
  if [ -d "$CJ_RT" ]; then
    LD_LIBRARY_PATH="$CJ_RT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
      run "仓颉(cangjie)" ./kernel/contract_common cangjie kernel/cangjie/libkernel.so "$CJ_RT"
  else
    echo "SKIP 仓颉（CANGJIE_RT_LIB=$CJ_RT 不存在）"
  fi
fi
if [ "$only" = "all" ] || [ "$only" = "hs" ]; then
  if [ -d "$GHC_LIB" ]; then
    # R159.3：ghcup 布局下 RTS/base 的依赖（libffi 等）不在系统 ld 路径——
    # 把 libdir 注入 LD_LIBRARY_PATH（本地 /usr/local/lib 已在路径中，幂等）
    LD_LIBRARY_PATH="$GHC_LIB${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
      run "Haskell(ghc)" ./kernel/contract_common ghc kernel/hs/libkernel_hs.so "$GHC_LIB"
  else
    echo "SKIP Haskell（GHC_LIB_DIR=$GHC_LIB 不存在）"
  fi
fi

if [ $rc -eq 0 ]; then echo "✅ 五内核统一契约：全部 ALL PASS"; else echo "❌ 存在失败（见上）"; fi
exit $rc
