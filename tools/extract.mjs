/*
 * 从 hvigor 的 cache 里取出 ets-loader 的转换产物（.ts），转成浏览器/Electron 可执行的 .js
 *
 * 转译引擎（EXTRACT_TS）：
 *   · 7（默认）—— TypeScript 7 原生编译器的 API（typescript/sync）。产物与 `tsc 7`
 *     CLI 逐字节一致（已对拍）。与 ets-loader 内部的 4.9.5 无关：ets-loader 只负责
 *     .ets→.ts，这一层是我们自己的 TS→JS。
 *   · 4 —— ets-loader 自带的 4.9.5-r4（test/vendor 入库副本）。逃生阀：CI 未装 7.x、
 *     或需要与历史产物逐字节比对时用。
 *
 * 两份 TS 同时在场是刻意的：JS 后优化器（tools/arkui-optimizer.mjs）用的是经典 AST/
 * transformer API（ts.createSourceFile / ts.transform / ts.factory），TS 7 的包不导出
 * 这套（它的 AST 走 IPC 远程节点 + ./ast 子路径）。所以优化器继续用 4.9.5 解析"已经转译
 * 好的 JS"，与转译引擎无关——它只看 JS 语法，不看 TS 版本。
 *
 * 用法:
 *   node tools/extract.mjs                       # 默认 Index → build/app.js（经典脚本，去类型）
 *   node tools/extract.mjs <src> <out>
 *   node tools/extract.mjs <src> <out> --cjs                 # 转成 CommonJS（保留 @ohos: 的 require）
 *   node tools/extract.mjs <src> <out> --cjs --register ID   # 再包一层"注册模块"，供 requireModule(ID) 取用
 *   EXTRACT_TS=4 node tools/extract.mjs ...                  # 回退 4.9.5-r4 引擎
 *
 * --register 的意义：产物里若有 `import ... from "@ohos:xxx"`，必须以 CommonJS 形式装载；
 * 生成的注册文件用 __arkui_dom_defineCommonJS 挂上，避免 fetch/eval 带来的 CSP 与 file:// 限制。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
// fileURLToPath：.pathname 在 Windows 返回 /D:/...（盘符前带斜杠），join 出 \D:\ 死路径
const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));   // 仓库根
// TypeScript（4.9.5-r4，华为补丁版）解析顺序：
//   ① env TS_PATH（应急覆盖）
//   ② test/vendor/ 入库副本（R159.3：CI 上没有本地 CLT——vendor 与 CLT 副本逐字节
//     相同，转译输出一致已验证；.cjs 后缀因仓库 "type":"module"，.js 会被当 ESM）
// 入库出处与许可见 THIRD-PARTY-NOTICES.md §3b（Apache-2.0，逐字节复制零修改）
const TS_PATH = process.env.TS_PATH
  || path.join(HERE, 'test/vendor/typescript-4.9.5-r4.lib.cjs');

// 转译引擎选择：7 = TS 7 原生 API（默认）；4 = ets-loader 的 4.9.5-r4
const ENGINE = (process.env.EXTRACT_TS || '7').trim();
if (ENGINE !== '7' && ENGINE !== '4') {
  console.error(`EXTRACT_TS 只接受 7 或 4（当前：${ENGINE}）`);
  process.exit(2);
}

// ── TS 7 包定位 ──
// 顺序：TSC7_PKG（显式）→ 本地可解析的 typescript → npm 全局根 → pnpm 全局根。
// 只要 dist/api/sync/api.js 在就算命中（那是本迁移唯一依赖的面）。
// 两条全局根都要探：
//   · npm 全局（CI 走这条：arkui-ci 的工具链基线用 `npm i -g` 装 TS 7）
//   · pnpm 全局（本机开发走这条；12 的布局是 <root>/<hash>/node_modules/typescript，
//     且 typescript 本身是符号链接，所以既不能拼 <root>/node_modules，
//     也不能用 find -type d ——必须逐子项 + existsSync 跟随链接）
const isTs7Pkg = (p) => !!p && fs.existsSync(path.join(p, 'dist/api/sync/api.js'));

function globalRoot(cmd) {
  // Windows 上 npm/pnpm 是 .cmd 垫片，不加 shell 会 ENOENT（2026-11-18 CI 实测：
  // browser-windows 腿工具链步成功打印了 tsc 7.1.0-beta，但这里探不到 → 产物全失败）
  const r = spawnSync(cmd, ['root', '-g'],
    { encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) return null;
  const base = (r.stdout || '').trim();
  return base || null;
}

function typescriptUnder(base) {
  if (!base) return null;
  // 直接子项（npm 全局、pnpm 老布局）
  if (isTs7Pkg(path.join(base, 'typescript'))) return path.join(base, 'typescript');
  // pnpm 12：<base>/<hash>/node_modules/typescript
  let entries;
  try { entries = fs.readdirSync(base); } catch { return null; }
  for (const e of entries) {
    const cand = path.join(base, e, 'node_modules', 'typescript');
    if (isTs7Pkg(cand)) return cand;
  }
  return null;
}

function resolveTs7Pkg() {
  const cands = [];
  if (process.env.TSC7_PKG) cands.push(process.env.TSC7_PKG);
  try {
    cands.push(path.dirname(require.resolve('typescript/package.json')));
  } catch { /* 本项目零依赖，通常解析不到；不视为错误 */ }
  const hit = cands.find(isTs7Pkg);
  if (hit) return hit;

  // 不依赖 spawn 的兜底根：Windows runner 的 npm 全局前缀通常是 %APPDATA%\npm 或 C:\npm，
  // Unix 则是与 node 可执行文件同级的 lib/node_modules。spawn 失败时这些仍能命中。
  const fallbackRoots = [];
  if (process.env.npm_config_prefix) {
    fallbackRoots.push(path.join(process.env.npm_config_prefix, 'node_modules'));
  }
  if (process.platform === 'win32') {
    if (process.env.APPDATA) fallbackRoots.push(path.join(process.env.APPDATA, 'npm', 'node_modules'));
    fallbackRoots.push('C:\\npm\\node_modules');
  } else {
    fallbackRoots.push(path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules'));
    fallbackRoots.push('/usr/local/lib/node_modules');
  }
  for (const base of fallbackRoots) {
    const pkg = typescriptUnder(base);
    if (pkg) return pkg;
  }

  for (const cmd of ['npm', 'pnpm']) {
    const pkg = typescriptUnder(globalRoot(cmd));
    if (pkg) return pkg;
  }
  return null;
}

// 4.9.5 恒加载：--no-optimize 之外，JS 后优化器要用它的经典 AST API
const ts45 = require(TS_PATH);

// 编译选项用【数值枚举】：TS 7 的 IPC 不接受 tsconfig 里的字符串写法，
// 传字符串会让原生服务 panic（interface conversion: interface {} is string, not float64）。
const TARGET_ES2021 = 8;          // ts.ScriptTarget.ES2021
const MODULE_NONE = 0;            // ts.ModuleKind.None
const MODULE_COMMONJS = 1;        // ts.ModuleKind.CommonJS

let transpile;                    // (source, fileName, moduleKind) => outputText
let engineLabel;
let ts7api = null;

if (ENGINE === '7') {
  const pkg = resolveTs7Pkg();
  if (!pkg) {
    console.error('❌ EXTRACT_TS=7 但找不到 TypeScript 7（需要 dist/api/sync/api.js）');
    console.error('   可设 TSC7_PKG=/path/to/node_modules/typescript，或先装：pnpm add -g typescript@7');
    console.error('   临时回退 4.9.5：EXTRACT_TS=4 node tools/extract.mjs ...');
    process.exit(2);
  }
  const { API } = await import(pathToFileURL(path.join(pkg, 'dist/api/sync/api.js')).href);
  const { version } = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8'));
  ts7api = new API({ cwd: HERE });
  engineLabel = `7 原生 API（${version}）`;
  transpile = (source, fileName, moduleKind, useCjs) => {
    const { outputText } = ts7api.transpileModule(source, {
      compilerOptions: {
        target: TARGET_ES2021,
        module: moduleKind,
        removeComments: false,
        // 必须显式开：TS 7 默认走标准装饰器（__esDecorate / stage-3），而本运行时与
        // es2abc 对拍的是遗产装饰器（__decorate，字段装饰器 3 实参）。
        experimentalDecorators: true,
      },
      fileName,
    });
    return outputText;
  };
} else {
  engineLabel = ts45.version;
  transpile = (source, fileName, moduleKind, useCjs) => ts45.transpileModule(source, {
    compilerOptions: {
      target: ts45.ScriptTarget.ES2021,
      module: useCjs ? ts45.ModuleKind.CommonJS : ts45.ModuleKind.None,
      removeComments: false,
    },
    fileName,
  }).outputText;
}

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

const source = fs.readFileSync(src, 'utf8');

// 无 import/export 的页面用 None（经典脚本，靠全局）；
// 含 @ohos: import 的模块必须用 CommonJS，才能通过 require 垫片解析平台模块
const moduleKind = useCjs ? MODULE_COMMONJS : MODULE_NONE;
let output = transpile(source, path.basename(src), moduleKind, useCjs);

// R86：静态/动态属性分裂默认开启——优化器 v1.1 全量毕业（全部用例过七步门禁后翻默认）。
// 个别不兼容页用 --no-optimize 退出并在此登记原因；--optimize 仍被接受（幂等）。
if (!flags.has('--no-optimize')) {
  const { optimizeJs } = await import('./arkui-optimizer.mjs');
  // 优化器固定用 4.9.5 的经典 AST API（TS 7 不导出 transformer 面）
  output = optimizeJs(output, ts45);
}

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
console.log(`转译引擎: ${engineLabel}`);

// TS 7 的 API 是"客户端 + 原生服务进程"，用完要收（否则 extract 每次调用留一个进程）
if (ts7api) ts7api.close?.();
