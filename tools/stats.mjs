/*
 * 项目自检统计：组件覆盖、运行时 API 面、平台模块、用例矩阵。
 * 用途：写文档/评审时用实际数字，而不是凭印象。
 *
 * 用法: node tools/stats.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── 组件画像 ──
// 注意：generated 里的条目**不是**全都生效——registerGeneratedComponents 里
// `if (components[name]) continue` 让手写实现优先。所以覆盖数必须减掉手写的那批。
const HANDWRITTEN = ['Text', 'Button', 'Column', 'Row', 'Stack', 'List', 'ListItem', 'RelativeContainer',
  'Tabs', 'TabContent'];
const CONTROL_FLOW = ['If', 'ForEach', 'LazyForEach'];   // 不在 149 注册表内，单独实现

const gen = read('runtime/generated-components.js');
const regJson = gen.match(/__ARKUI_COMPONENTS = (\{[\s\S]*?\n\});/)[1];
const reg = JSON.parse(regJson);
const names = Object.keys(reg);
let profiled = 0, containerProfiled = 0, leafProfiled = 0, defaultDiv = 0, inputs = 0;
let attrTotal = 0, attrMax = 0, attrMaxName = '';
const profList = [], defList = [];
for (const n of names) {
  if (HANDWRITTEN.includes(n)) continue;                 // 骨架被手写实现顶掉，不计入骨架统计
  const c = reg[n];
  const base = c.baseStyle || {};
  const hasProfile = Object.keys(base).length > 0 || c.tag !== 'div' || !!c.inputType;
  if (hasProfile) {
    profiled++;
    profList.push(n);
    c.isContainer ? containerProfiled++ : leafProfiled++;
  } else {
    defaultDiv++;
    defList.push(n);
  }
  if (c.inputType) inputs++;
  const a = (c.attrs || []).length;
  attrTotal += a;
  if (a > attrMax) { attrMax = a; attrMaxName = n; }
}
const coverage = HANDWRITTEN.length + profiled + defaultDiv;

// ── 运行时 API 面 ──
const rt = read('runtime/arkui-dom-runtime.js');
// Object.assign(global, {...}) 里的条目 = 顶层导出名；去掉注释行后按逗号切
const assignBlock = rt.match(/Object\.assign\(global, \{([\s\S]*?)\n  \}\);/)[1];
const globals = assignBlock
  .split('\n')
  .filter((l) => !/^\s*\/\//.test(l))
  .join('\n')
  .split(',')
  .map((s) => s.trim().split(':')[0].trim())
  .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
const STATE_CLASSES = globals.filter((g) => /Property.*PU$/.test(g));
const BUILTIN_COMPONENTS = ['Text', 'Button', 'Column', 'Row', 'Stack', 'List', 'ListItem',
  'If', 'ForEach', 'LazyForEach', 'RelativeContainer', 'Tabs', 'TabContent'].filter((c) => globals.includes(c));
const INTERNAL = globals.filter((g) => g.startsWith('__arkui_dom_'));

// 状态管理 v2：装饰器表（V2 的能力由装饰器提供，不由状态类提供）
const decBlock = rt.match(/const decorators = \{([\s\S]*?)\n  \};/);
const V2_DECORATORS = decBlock
  ? decBlock[1].split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z_$][\w$]*$/.test(s))
  : [];
const hasV2Base = /\bclass ViewV2 extends ViewPU\b/.test(rt);
// V1 深度观测：@Observed 类装饰器 + @ObjectLink 的状态类
const hasV1Observed = /function Observed\(/.test(rt);
const hasObjectLinkClass = /class SynchedPropertyNesedObjectPU\b/.test(rt);
const V1_EXTRA = ['Observed'];
const V2_ONLY = V2_DECORATORS.filter((d) => !V1_EXTRA.includes(d));

// ── 平台模块 ──
const shims = read('runtime/ohos-shims.js');
const modules = [...shims.matchAll(/define\(\s*'([a-zA-Z.]+)'/g)].map((m) => m[1]).sort();

// ── 用例矩阵 ──
const runSh = read('run.sh');
const cases = [...runSh.matchAll(/^ {2}([a-z0-9|-]+)\)/gm)]
  .flatMap((m) => m[1].split('|'))
  .filter((c) => c !== 'all' && c !== '*');
const elSh = read('electron/run.sh');
const elCases = [...elSh.matchAll(/^ {2}([a-z0-9|-]+)\)/gm)]
  .flatMap((m) => m[1].split('|'))
  .filter((c) => c !== 'all' && c !== '*');
const tests = fs.readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('.html')).sort();
const fixtures = fs.readdirSync(path.join(ROOT, 'fixtures/pages')).sort();

// ── 体积 ──
const du = (p) => {
  let total = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    }
  };
  walk(path.join(ROOT, p));
  return total;
};

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const sizes = {
  runtime: du('runtime'),
  test: du('test'),
  tools: du('tools'),
  'electron(src)': du('electron') - du('electron/runtime') - du('electron/data'),
  docs: du('docs'),
  fixtures: du('fixtures'),
};

// 逐文件体积：文档里"文件职责"表引用的就是这些值
const TRACKED_FILES = [
  'runtime/arkui-dom-runtime.js', 'runtime/generated-components.js', 'runtime/ohos-shims.js',
  'tools/extract.mjs', 'tools/gen-components.mjs', 'tools/serve.py', 'tools/stats.mjs',
  'tools/preflight.mjs', 'tools/check-all.sh',
  'run.sh', 'electron/run.sh', 'electron/main.js', 'electron/preload.js',
  'package.json', '.gitignore', 'README.md', 'THIRD-PARTY-NOTICES.md',
  'docs/ARCHITECTURE.md', 'docs/CAPABILITY.md', 'docs/DEVELOPING.md',
  'docs/ROADMAP.md', 'docs/surface-measurement.md',
];
// 每个 fixture 与测试页都列出来：它们是"能力有测试"的证据
TRACKED_FILES.push(
  ...fs.readdirSync(path.join(ROOT, 'fixtures/pages')).sort().map((f) => `fixtures/pages/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'test')).sort().map((f) => `test/${f}`),
);
const fileBytes = {};
for (const f of TRACKED_FILES) {
  const p = path.join(ROOT, f);
  fileBytes[f] = fs.existsSync(p) ? fs.statSync(p).size : null;
}

const report = {
  components: {
    registryNames: names.length,
    handwritten: HANDWRITTEN,
    controlFlow: CONTROL_FLOW,
    profiledSkeletons: profList,
    dataOnlySkeletons: defList,
    coverage,
    containerProfiled, leafProfiled, inputs,
    attrTotal, attrMax, attrMaxName,
  },
  runtime: {
    globalExports: globals.length, stateClasses: STATE_CLASSES,
    builtinComponents: BUILTIN_COMPONENTS, internalHooks: INTERNAL.length,
    stateV2: { hasViewV2Base: hasV2Base, decorators: V2_ONLY },
    stateV1Deep: { hasObservedDecorator: hasV1Observed, hasObjectLinkClass: hasObjectLinkClass },
  },
  platformModules: modules,
  tests: { browserCases: cases, electronCases: elCases, pages: tests, fixtures },
  sizes,
  fileBytes,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

console.log('== 组件库 ==');
console.log(`  ets-loader 注册名    ${names.length}`);
console.log(`  手写实现（真布局语义）${HANDWRITTEN.length}：${HANDWRITTEN.join(' ')}`);
console.log(`  控制流宏（非组件）    ${CONTROL_FLOW.length}：${CONTROL_FLOW.join(' ')}`);
console.log(`  骨架·有 DOM 画像     ${profiled}（容器 ${containerProfiled} / 叶子 ${leafProfiled}）`);
console.log(`  骨架·仅 data-*       ${defaultDiv}`);
console.log(`  ⇒ 可建出的组件名      ${coverage} / ${names.length}`);
console.log(`  原生输入类控件       ${inputs}`);
console.log(`  属性元数据总数       ${attrTotal}（平均 ${(attrTotal / names.length).toFixed(1)}／组件，最多 ${attrMaxName}=${attrMax}）`);

console.log('\n== 运行时 API ==');
console.log(`  global 导出        ${globals.length} 个`);
console.log(`  状态类            ${STATE_CLASSES.join(' ')}`);
console.log(`  内置组件          ${BUILTIN_COMPONENTS.join(' ')}`);
console.log(`  内部钩子 __arkui_dom_*  ${INTERNAL.length} 个`);

console.log('\n== 状态管理 ==');
console.log(`  v1  状态类        ${STATE_CLASSES.length} 个（包装对象模型）`);
console.log(`  v1  深度观测      @Observed ${hasV1Observed ? '已实现' : '缺失'}（Proxy 拦截字段写入）` +
  ` + @ObjectLink ${hasObjectLinkClass ? '已实现' : '缺失'}（SynchedPropertyNesedObjectPU，官方拼写如此）`);
console.log(`  v2  基类          ViewV2 ${hasV2Base ? '已实现' : '缺失'}（extends ViewPU）`);
console.log(`  v2  装饰器        ${V2_ONLY.length} 个：${V2_ONLY.join(' ')}`);
console.log(`  注入方式          作用域内绑定（__arkui_dom_decorators），不挂 global —— 见 ARCHITECTURE.md §3.4`);
console.log(`  装饰器表合计      ${V2_DECORATORS.length} 个（含 v1 的 Observed）`);

console.log('\n== 平台模块（@ohos:*）==');
console.log(`  ${modules.length} 个：${modules.join(' ')}`);

console.log('\n== 用例矩阵 ==');
console.log(`  浏览器 run.sh     ${cases.length} 个：${cases.join(' ')}`);
console.log(`  Electron          ${elCases.length} 个：${elCases.join(' ')}`);
console.log(`  测试页            ${tests.length} 个`);
console.log(`  fixtures 转换产物  ${fixtures.length} 个：${fixtures.map((f) => f.replace('.ts', '')).join(' ')}`);

console.log('\n== 体积（源码，不含产物/Electron 运行时）==');
for (const [k, v] of Object.entries(sizes)) console.log(`  ${k.padEnd(16)} ${kb(v)}`);

console.log('\n== 逐文件（文档"文件职责"表的来源）==');
const width = Math.max(...Object.keys(fileBytes).map((f) => f.length));
for (const [f, b] of Object.entries(fileBytes)) {
  console.log(`  ${f.padEnd(width)}  ${b === null ? '（不存在）' : `${String(b).padStart(6)} B  ${kb(b)}`}`);
}
