/*
 * 从 hvigor 的 cache 里取出 ets-loader 的转换产物（.ts），转成浏览器/Electron 可执行的 .js
 *
 * 用 ets-loader 自带的 TypeScript（4.9.5）做 transpileModule —— 不安装任何新依赖。
 *
 * 用法:
 *   node tools/extract.mjs                       # 默认 Index → build/app.js（经典脚本，去类型）
 *   node tools/extract.mjs <src> <out>
 *   node tools/extract.mjs <src> <out> --cjs                 # 转成 CommonJS（保留 @ohos: 的 require）
 *   node tools/extract.mjs <src> <out> --cjs --register ID   # 再包一层"注册模块"，供 requireModule(ID) 取用
 *
 * --register 的意义：产物里若有 `import ... from "@ohos:xxx"`，必须以 CommonJS 形式装载；
 * 生成的注册文件用 __arkui_dom_defineCommonJS 挂上，避免 fetch/eval 带来的 CSP 与 file:// 限制。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CLT = '/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools';
const TS_PATH = path.join(
  CLT, 'sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript'
);

const DEFAULT_SRC =
  '/tmp/hmtest/app/entry/build/default/cache/default/default@CompileArkTS/esmodule/debug/' +
  'entry/src/main/ets/pages/Index.ts';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.filter((a) => !a.startsWith('--'));
const regIdx = argv.indexOf('--register');
const registerId = regIdx >= 0 ? argv[regIdx + 1] : null;

const src = positional[0] || DEFAULT_SRC;
const out = positional[1] || 'build/app.js';
const useCjs = flags.has('--cjs') || registerId !== null;

if (!fs.existsSync(src)) {
  console.error(`找不到输入文件: ${src}`);
  console.error('提示：本仓库通常在 fixtures/ 下有固化的转换产物；');
  console.error('      若要重新生成，需在 HarmonyOS 工程里跑 devecocli build，产物在 hvigor 的 cache 目录。');
  process.exit(2);
}

const ts = require(TS_PATH);
const source = fs.readFileSync(src, 'utf8');

const result = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2021,
    // 无 import/export 的页面用 None（经典脚本，靠全局）；
    // 含 @ohos: import 的模块必须用 CommonJS，才能通过 require 垫片解析平台模块
    module: useCjs ? ts.ModuleKind.CommonJS : ts.ModuleKind.None,
    removeComments: false,
  },
  fileName: path.basename(src),
});

let output = result.outputText;
if (registerId) {
  output =
    `// 自动生成：把 ${path.basename(src)} 注册为 CommonJS 模块 "${registerId}"\n` +
    `__arkui_dom_defineCommonJS(${JSON.stringify(registerId)}, function (require, exports, module) {\n` +
    output +
    `\n});\n`;
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, output);

// 自检：非 CJS 模式下产物里不应再出现 TS 专属语法
const leftovers = useCjs
  ? []
  : ['interface ', 'private ', ' : string', ' : number', 'public ']
      .filter((s) => output.includes(s));

console.log(`源文件 : ${src}`);
console.log(`输出   : ${out}  (${output.length} 字节)  模式=${useCjs ? 'CommonJS' + (registerId ? ` + register(${registerId})` : '') : '经典脚本'}`);
console.log(`类型残留: ${leftovers.length ? '❌ ' + leftovers.join(' | ') : '✅ 无'}`);
console.log(`TS 版本 : ${ts.version}`);
