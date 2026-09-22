#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# arkui-qrcodegen vendor 构建：把 OHOS 真机 QR 编码器（src/ 下逐字复制的 C++ 源码）
# 编成独立 WASM，并把字节以 base64 内嵌进单文件加载器（file:// 与 http:// 都能加载，
# 浏览器与 Electron 同一份）。
#
# 工具链：emscripten（本机装在 /data/training/cli/emsdk，git clone + ./emsdk install latest）
# 产物：../arkui-qrcodegen.js（已入库；改了 src/ 或 glue/ 才需要重跑本脚本）
#
# 纪律：src/ 下的算法源码是逐字复制的真机源码，不许手改；本脚本与 glue/ 是唯一的
# 本地附加物（securec 兼容层 + 导出配置 + 加载器）。
#
# 为什么 STANDALONE_WASM：emscripten 6 的 JS 工厂是 async 的，而 QRCode 的首绘在
# 渲染后同步阶段（不变量 18），等不起 Promise。STANDALONE 产物不依赖 emscripten 的
# JS 运行时，加载器用同步的 new WebAssembly.Module 自己实例化——脚本求值完即可用。
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EMSDK="${EMSDK_DIR:-/data/training/cli/emsdk}"
if [ ! -f "$EMSDK/emsdk_env.sh" ]; then
  echo "找不到 emsdk（$EMSDK）。安装：git clone https://github.com/emscripten-core/emsdk $EMSDK && $EMSDK/emsdk install latest && $EMSDK/emsdk activate latest" >&2
  exit 2
fi
# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh"

cd "$HERE"
emcc \
  src/*.cpp glue/securec_glue.cpp \
  -I src -I glue \
  -O3 \
  -s STANDALONE_WASM=1 \
  -s ALLOW_MEMORY_GROWTH=0 \
  -s EXPORTED_FUNCTIONS=['_malloc','_free','_QrcodeImageEncodeString','_QrcodeImageFree'] \
  --no-entry \
  -o arkui-qrcodegen.wasm

node - <<'PACK'
/* 把 wasm 打成 base64 内嵌的同步加载器（唯一本地附加的 JS） */
const fs = require('node:fs');
const wasm = fs.readFileSync('arkui-qrcodegen.wasm');
const b64 = wasm.toString('base64');
const loader = `/*
 * arkui-qrcodegen 加载器（本地附加，非真机源码）。
 * 内嵌 ${wasm.length} B 的独立 WASM——真机 QR 编码器 arkui_qrcodegen 的构建产物
 * （源码在 ./src/，逐字复制自 OpenHarmony arkui_qrcodegen；见 build.sh 与 THIRD-PARTY-NOTICES）。
 *
 * 用法：globalThis.ArkuiQrcodegen.encode(text, ecc)
 *   ecc: 0 = QRCODE_ECC_MEDIUM（真机组件硬编码用这个）、1 = QRCODE_ECC_HIGH
 *   返回 { version, width, size, data:Uint8Array } | null（内容非法/过长时 null）
 *   data 为行优先 width×width 字节，取值 0/1（1 = 暗格——源码口径 data[i] & 0x1，
 *   见 qrcode_mask.cpp QrcodeMaskCopyWithExpression 的 blackCount 统计）。
 * 同步可用：new WebAssembly.Module 是同步 API，本脚本求值完成即就绪。
 */
(() => {
  const b64 = '${b64}';
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const mod = new WebAssembly.Module(bin);
  const inst = new WebAssembly.Instance(mod, {});
  const ex = inst.exports;
  if (ex.__wasm_call_ctors) ex.__wasm_call_ctors();   // 初始化 dlmalloc 等 C++ 运行时
  const i32 = (p) => new DataView(ex.memory.buffer).getInt32(p, true);
  globalThis.ArkuiQrcodegen = {
    encode(text, ecc) {
      const src = new TextEncoder().encode(String(text) + '\\0');
      const pText = ex.malloc(src.length);
      if (!pText) return null;
      new Uint8Array(ex.memory.buffer, pText, src.length).set(src);
      const ptr = ex.QrcodeImageEncodeString(pText, ecc || 0);
      ex.free(pText);
      if (!ptr) return null;
      const version = i32(ptr);
      const width = i32(ptr + 4);
      const dataPtr = i32(ptr + 8);
      const data = new Uint8Array(width * width);
      const heap = new Uint8Array(ex.memory.buffer, dataPtr, width * width);
      for (let i = 0; i < data.length; i++) data[i] = heap[i] & 1;
      ex.QrcodeImageFree(ptr);
      return { version, width, size: width, data };
    },
  };
})();
`;
fs.writeFileSync('../arkui-qrcodegen.js', loader);  // 产物放 vendor 根（页面 <script> 指向它）
console.log('loader:', loader.length, 'B（wasm', wasm.length, 'B 内嵌）');
PACK

rm -f arkui-qrcodegen.wasm
echo "✅ ../arkui-qrcodegen.js 构建完成（$(wc -c < ../arkui-qrcodegen.js) B）"
