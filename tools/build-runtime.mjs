#!/usr/bin/env node
// runtime/src/ 的分片 → runtime/arkui-dom-runtime.js（拼接产物）
//
//   node tools/build-runtime.mjs           # 拼接并落盘
//   node tools/build-runtime.mjs --check   # 只校验产物与分片一致（不落盘），漂移即非 0 退出
//
// ── 为什么是"源拆分 + 拼接产物"，而不是拆成多个 <script> ──
// 产物是【经典脚本】（全文 0 个 import/export），加载方式是 30 个手写 HTML 里按固定顺序
// `<script src="runtime/arkui-dom-runtime.js">`；Electron 直接加载同一批 HTML（不复制测试代码）。
// 分片之间共享同一个闭包 —— `elmtIdSeq`/`elmtRecords`/`propDeps`/`ViewStackProcessor`/`pageStack`，
// 其中 `animWindow` 还是【可变绑定】（动画分片里 `let` 重新赋值、批量重渲染段在块外读它并
// `animWindow.els.push(...)`）。拆成多个 IIFE 就得把这些全改成显式访问器、并让 29 处 HTML 的
// 加载顺序变成新的失败模式。拼接方案下产物仍是【同一个闭包】：语义零变化，而源按节拆开维护。
//
// ⚠️ 分片不是独立可运行的 JS：它们是同一个 IIFE 体内的连续若干段（保留原来的 2 空格缩进）。
//    正确的检查方式只有一个 —— 拼出来、跑测试（本脚本的 --check 管"产物与源一致"，
//    `npm run check` 管"行为没变"）。
//
// 语法：主分片里写一行 `// @include <分片名>`（可省 .js），该【行】（连同它的换行）会被替换为
// 那个分片的全部内容。拼接顺序 = 标记出现的位置，所以产物里的代码顺序与拆分前逐字节一致。
//
// ⚠️ 空行也是一行：分片【必须】以换行结尾，且末尾的空行会被原样保留 —— 拆分时踩过这个坑：
//    按"行数组 + 丢掉末尾空元素"的写法会把分节片末尾那个属于代码的空行吞掉（产物少 1 字节）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRCDIR = path.join(ROOT, 'runtime/src');
const OUT = path.join(ROOT, 'runtime/arkui-dom-runtime.js');
const PRODUCT = 'runtime/arkui-dom-runtime.js';
const ENTRY = 'main.js';
// 标记的形态（每次现造正则：递归替换时复用同一个 /g 对象会踩 lastIndex 的坑）
const INCLUDE_SRC = '^[ \\t]*// @include[ \\t]+([A-Za-z0-9._-]+)[ \\t]*$';

const fail = (msg) => { console.error(`❌ ${msg}`); process.exit(1); };
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const fragments = fs.readdirSync(SRCDIR).filter((f) => f.endsWith('.js')).sort();
const used = new Set();

/** 展开一个分片：`// @include X` 那一行被替换为 X 的内容（递归、保序、不吞空行） */
function expand(name, stack) {
  if (stack.includes(name)) fail(`@include 成环：${[...stack, name].join(' → ')}`);
  const rel = `runtime/src/${name}`;
  if (!fs.existsSync(path.join(ROOT, rel))) {
    fail(`@include 找不到分片 ${rel}（runtime/src 下现有：${fragments.join(' ')}）`);
  }
  used.add(name);
  const content = read(rel);
  if (!content.endsWith('\n')) fail(`${rel} 必须以换行结尾（否则拼接处会与下一行粘连）`);
  return content.replace(new RegExp(`${INCLUDE_SRC}\\n`, 'gm'), (_, sub) =>
    expand(sub.endsWith('.js') ? sub : `${sub}.js`, [...stack, name]));
}

const built = expand(ENTRY, []);
if (new RegExp(INCLUDE_SRC, 'm').test(built)) {
  fail('产物里还有未展开的 @include（标记必须独占一行、且后面有换行）');
}

// 孤儿分片：写了但没被 @include —— 静默不生效最危险，直接报错
const orphans = fragments.filter((f) => f !== ENTRY && !used.has(f));
if (orphans.length) fail(`runtime/src/${orphans.join(' ')} 没有被任何 @include 引用（孤儿分片）`);

const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
const sizes = fragments.map((f) => `${f} ${fs.statSync(path.join(SRCDIR, f)).size}B`).join(' + ');

if (process.argv.includes('--check')) {
  if (current === built) {
    console.log(`✅ runtime 产物与分片一致（${fragments.length} 个分片：${sizes}）`);
    process.exit(0);
  }
  const a = (current || '').split('\n');
  const b = built.split('\n');
  let i = 0;
  while (i < Math.max(a.length, b.length) && a[i] === b[i]) i++;
  console.error(`❌ ${PRODUCT} 与 runtime/src/ 不一致（首个不同在第 ${i + 1} 行，${a.length} vs ${b.length} 行）`);
  console.error(`   产物: ${(a[i] ?? '（无此行）').slice(0, 100)}`);
  console.error(`   应为: ${(b[i] ?? '（无此行）').slice(0, 100)}`);
  console.error('   修法: node tools/build-runtime.mjs');
  process.exit(1);
}

if (current === built) {
  console.log(`✅ ${PRODUCT} 已是最新（${fragments.length} 个分片：${sizes}）`);
} else {
  fs.writeFileSync(OUT, built);
  console.log(`✅ 已生成 ${PRODUCT}（${fragments.length} 个分片：${sizes}）`
    + `\n   产物 ${Buffer.byteLength(built)} B / ${built.split('\n').length - 1} 行`);
}
