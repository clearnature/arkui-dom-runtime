#!/usr/bin/env bash
# CI / 打包腿前置：确保 TypeScript 7 可用（tools/extract.mjs 的默认转译引擎）。
#
# 为什么单独一步：本仓库是"零 npm 依赖"的——4.9.5-r4 以 vendor 副本入库（供
# tools/arkui-optimizer.mjs 的经典 AST API 用），而 TS 7 的原生包无法入库
# （每平台 24 MB 的 Go 二进制）。本地开发用 pnpm 全局的 typescript@7；
# CI / 打包腿由本脚本装到 npm 全局，tools/extract.mjs 会自己探测 `npm root -g`。
#
# 版本：TS7_VERSION 可覆盖，默认与治理仓 arkui-ci 的工具链基线一致（7.1.0-beta）。
# 两者必须同版：本地 pnpm 全局是 7.1.0-beta，CI 若留 7.0.2 就成了两套编译器
# （在 fixture 上 emit 逐字节一致，但没有理由不统一）。
# 注意：这是 CI 侧供给，不是运行时依赖——生产产物只包含转译后的 JS。
set -euo pipefail

VER="${TS7_VERSION:-7.1.0-beta}"

# 用 node 判存在：跨平台（Git Bash 下 npm root -g 返回 C:\... 反斜杠路径，shell test 不可靠）
check() {
  node -e '
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
let root;
try { root = cp.execSync("npm root -g", { encoding: "utf8" }).trim(); } catch { process.exit(1); }
process.exit(fs.existsSync(path.join(root, "typescript", "dist", "api", "sync", "api.js")) ? 0 : 1);
'
}

if check; then
  echo "✅ TypeScript 7 已可用（跳过安装）"
  exit 0
fi

echo "▶ 安装 typescript@${VER}（extract 的转译引擎）"
npm i -g --silent "typescript@${VER}"

if ! check; then
  echo "❌ 安装后仍找不到 typescript@${VER} 的 API 面（dist/api/sync/api.js）"
  echo "   排查：npm root -g / npm ls -g --depth=0"
  exit 1
fi
echo "✅ TypeScript 7 就绪"
