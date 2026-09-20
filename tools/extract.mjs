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
const HERE = path.dirname(path.dirname(new URL(import.meta.url).pathname));   // 仓库根
const CLT = '/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools';
const TS_PATH = path.join(
  CLT, 'sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript'
);

const DEFAULT_SRC =
  path.join(HERE, 'harmony-proj/entry/build/default/cache/default/default@CompileArkTS/esmodule/debug/',
    'entry/src/main/ets/pages/Index.ts');

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

// ── 状态管理装饰器前奏 ──
// V2/V1 产物把装饰器保留成 __decorate([Local], Proto, "count", void 0) / ([Observed], Cls)
// —— 这些名字在产物里是【自由变量】。但其中 `Event` 与浏览器全局同名，而 runtime 自己
// （Scroller 里的 new Event('scroll')）与 test/lazy.html 都在用 new Event(...)。
// 所以不能把装饰器挂到 global，改为在产物作用域内做绑定。
//
// 门禁用 __decorate( —— 它【只】在源码用了装饰器时才会被 TS 发出来，所以不带装饰器的
// 页面完全不受影响（实测：11 个早期 fixture 的产物里 __decorate 出现 0 次）。
// 名字匹配故意用宽口径（词边界，不判断后随字符）：漏绑是致命错误（ReferenceError），
// 多绑一个用不到的名字只是多一次解构赋值，没有副作用。代价是会匹配到注释里的名字
// （实测 V2.ts 的注释提到 @Trace 导致多绑一个），可以接受。
//
// `Observed` 是 V1 的类装饰器；`SynchedPropertyNesedObjectPU` 不是装饰器而是状态类，
// 走 global（见 runtime 的 Object.assign(global, ...)），不需要在这里绑。
const DECORATOR_NAMES = ['ViewV2', 'Param', 'Local', 'Once', 'Event', 'Monitor',
  'Computed', 'Provider', 'Consumer', 'ObservedV2', 'Trace', 'Observed'];
const hasDecorators = output.includes('__decorate(');
const usedDecorators = hasDecorators
  ? DECORATOR_NAMES.filter((d) => new RegExp(`\\b${d}\\b`).test(output))
  : [];

// 守卫：把"静默无效"变成"响亮报错"。
// 若某个装饰器名字出现在产物里、却不在运行时表里，解构会得到 undefined，
// 而 TS 的 __decorate 助手对 falsy 装饰器是【静默跳过】的 —— 于是 `@Observed`
// 会什么都不做，页面看起来"正常"但深度观测完全失效。这类静默失败在本项目已经
// 出过 4 次，必须在边界处堵住。
const decoratorPrelude = usedDecorators.length
  ? `// 自动生成：状态管理装饰器的作用域内绑定（避免与浏览器全局 Event 等撞名）\n` +
    `const { ${usedDecorators.join(', ')} } = (globalThis.__arkui_dom_decorators || {});\n` +
    `{\n` +
    `  const __missing = [${usedDecorators.map((d) => `[${JSON.stringify(d)}, typeof ${d}]`).join(', ')}]\n` +
    `    .filter(([, t]) => t !== 'function')\n` +
    `    .map(([n, t]) => \`\${n}(\${t})\`);\n` +
    `  if (__missing.length) {\n` +
    `    throw new Error('[arkui-dom] 装饰器未就绪: ' + __missing.join(', ') +\n` +
    `      ' —— 需先加载 runtime/arkui-dom-runtime.js，且该名字要同时存在于运行时的 decorators 表里');\n` +
    `  }\n` +
    `}\n`
  : '';

if (decoratorPrelude) output = decoratorPrelude + output;

if (registerId) {
  output =
    `// 自动生成：把 ${path.basename(src)} 注册为 CommonJS 模块 "${registerId}"\n` +
    `__arkui_dom_defineCommonJS(${JSON.stringify(registerId)}, function (require, exports, module) {\n` +
    output +
    `\n});\n`;
} else if (decoratorPrelude) {
  // 经典脚本：包一层 IIFE，让前奏里的 const 不外泄（避免污染全局作用域）
  output = `(function () {\n${output}\n})();\n`;
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
