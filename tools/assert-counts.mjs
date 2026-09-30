/*
 * 断言计数守门：把 runner **实测**到的「每个用例 emit 了多少条 PASS」与文档里手写的
 * 「（N 条断言）」逐一比对。
 *
 * 为什么需要它：文档里散落的计数一直靠人肉同步，已经漂移过两次 ——
 *   · R22 animdemo 记成 35、实际 36（2026-09-21 修）
 *   · v2 记成 26、实际 25；observe 记成 20、实际 19（同一天查出）
 * 与 gen-components --check、stats --check-doc 同构：文档里的数字必须有守卫，
 * 否则会先于代码腐烂。
 *
 * 为什么**不能**用 grep 数 test/*.html 里的 `check(` ：
 *   realfs.html 里 `check(` 有 28 处，但两端各只**执行** 21 条 —— 差的 7 处在互斥分支
 *   （浏览器走 localStorage 那一支、Electron 走 node-fs 那一支），静态计数会把"没跑到的
 *   断言"也算进去。**唯一权威是运行期真的 emit 出来的 PASS 行**，所以计数由 runner 落盘。
 *
 * 用法：
 *   node tools/assert-counts.mjs --browser  <counts.tsv>               校验浏览器端
 *   node tools/assert-counts.mjs --electron <counts.tsv>               校验 Electron 端
 *   node tools/assert-counts.mjs --browser  <counts.tsv> --overrides <file>
 *   node tools/assert-counts.mjs --report   <counts.tsv>               只打印解析到的"文档声明"（查解析规则用）
 *
 *   counts.tsv 每行： <用例名>\t<实测 PASS 行数>      （由 run.sh / electron/run.sh 生成）
 *
 * --overrides（R144）：跨引擎矩阵用的「分端期望值表」——某些用例存在互斥条件分支，
 *   不同引擎各走一支、emit 的 PASS 数天然不同（实例：realfs 的 OPFS 探测——
 *   Chromium headless 卡 200ms 失败 / Gecko 8ms 成功，分支互斥差 1 条）。
 *   文件每行：<用例名>\t<该端期望值>\t<理由>（# 开头为注释）。命中覆盖的用例按
 *   覆盖值核对，偏差同样红——覆盖是「带理由的期望」，不是豁免；打印时显式标注。
 *
 * 文档声明的两种**规范写法**（改文档时照这两种写，别的写法守不住）：
 *   ① 同行：`bash run.sh <用例>` …（N 条断言…）          —— 数字与用例名必须在同一行
 *   ② 围栏块内：块内先出现 `run.sh <用例>`，块内随后的「（N 条断言）」归它
 *      （README 里 `$ bash run.sh x` 后跟 `=== ALL PASS ===（N 条断言）` 就是这种）
 * 含「条断言失败 / 条红」的行是破坏验证的**失败数**、不是总数，自动跳过。
 *
 * 退出码：0 = 所有能核对的声明都一致；1 = 有漂移（逐条打印 file:line / 文档值 / 实测值）。
 * 未在本次运行中测到的用例不算错（单用例运行时只核对它自己），只计入"跳过"。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const DOCS = ['README.md', 'docs/ROADMAP.md', 'docs/ARCHITECTURE.md', 'docs/CAPABILITY.md'];
// 用例名：`run.sh xxx` / `./run.sh xxx` / `bash run.sh xxx`
const CASE_RE = /(?:bash\s+|\.\/)?(?:electron\/)?run\.sh\s+([a-z][a-z0-9-]*)/g;
// 数字必须**紧跟在**（ ( ， , * 之后才算"声明"——这样 "被 5 条断言抓住" 这类散文不会被误判成总数
const NUM_RE = /[（(，,*](\d+)\s*条断言/;
const COUNT_MEANING_RE = /条断言失败|条红|条断言被|条断言没牙齿/;   // 破坏验证的失败数，不是总数

const argv = process.argv.slice(2);
const mode = argv[0];
const file = argv[1];
let overridePath = null;
let label = null;
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === '--overrides') { overridePath = argv[i + 1]; i++; }
  else if (argv[i] === '--label') { label = argv[i + 1]; i++; }
}
if (!['--browser', '--electron', '--report'].includes(mode) || !file) {
  console.error('用法: node tools/assert-counts.mjs --browser|--electron|--report <counts.tsv> [--overrides <file>] [--label <端名>]');
  process.exit(2);
}

// ── 分端期望值覆盖（R144，可选）──
// 值域支持逗号分隔集合：`realfs\t20,21\t理由` = 20 或 21 都算过（时序敏感的互斥分支
// 两态皆合法，实测见 firefox/assert-overrides.tsv）；集合之外的值仍然红。
const overrides = new Map();
if (overridePath) {
  for (const line of fs.readFileSync(overridePath, 'utf8').split('\n')) {
    const m = line.match(/^([a-z][a-z0-9-]*)\t([\d,]+)\t/);
    if (m) overrides.set(m[1], m[2].split(',').map(Number));
  }
}

// ── 实测值（runner 落盘）──
const measured = new Map();
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  const m = line.match(/^([a-z][a-z0-9-]*)\t(\d+)\s*$/);
  if (m) measured.set(m[1], Number(m[2]));
}
if (measured.size === 0) {
  console.error(`❌ ${file} 里没有任何「<用例>\t<数>」记录（runner 没写？）`);
  process.exit(1);
}

// ── 解析文档声明 ──
// 每处声明：{ file, line, caseName, declared, how }
const decls = [];
const ambiguous = [];

for (const doc of DOCS) {
  let inFence = false;
  let fenceCase = null;              // 围栏块内最近一次出现的用例名
  const lines = read(doc).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*```/.test(raw)) { inFence = !inFence; if (inFence) fenceCase = null; continue; }
    // 先记用例名（`$ bash run.sh <用例>` 这种行**没有数字**，必须在数字判断之前处理，
    // 否则块内永远记不住用例名 —— 这正是第一版实现踩的坑）
    const uniq = [...new Set([...raw.matchAll(CASE_RE)].map((m) => m[1]))];
    if (inFence && uniq.length === 1) fenceCase = uniq[0];
    const num = raw.match(NUM_RE);
    if (!num || COUNT_MEANING_RE.test(raw)) continue;
    if (uniq.length === 1) {
      decls.push({ file: doc, line: i + 1, caseName: uniq[0], declared: Number(num[1]), how: '同行' });
    } else if (uniq.length === 0) {
      if (inFence && fenceCase) {
        // 围栏块内：数字这行没写用例名，沿用块内最近一次出现的用例名
        decls.push({ file: doc, line: i + 1, caseName: fenceCase, declared: Number(num[1]), how: '块内' });
      } else {
        ambiguous.push({ file: doc, line: i + 1, text: raw.trim(), why: '有数字但既没写用例名、也不在"块内已点名用例"的围栏里' });
      }
    } else {
      ambiguous.push({ file: doc, line: i + 1, text: raw.trim(), why: `一行里出现多个用例名：${uniq.join(' ')}` });
    }
  }
}

if (mode === '--report') {
  console.log(`实测输入：${measured.size} 个用例（${file}）`);
  for (const d of decls) {
    const have = measured.get(d.caseName);
    const mark = have === undefined ? '·未测' : have === d.declared ? '✅' : `❌ 实测 ${have}`;
    console.log(`  ${mark}  ${d.caseName.padEnd(14)} 文档 ${String(d.declared).padStart(3)}  ${d.file}:${d.line}（${d.how}）`);
  }
  for (const a of ambiguous) console.log(`  ⚠️  无法归类：${a.file}:${a.line}（${a.why}）\n        ${a.text}`);
  console.log(`合计 ${decls.length} 处声明；无法归类 ${ambiguous.length} 处`);
  process.exit(ambiguous.length ? 1 : 0);
}

const end = label || (mode === '--browser' ? '浏览器' : 'Electron');
const bad = [];
let checked = 0, skipped = 0, overridden = 0;
for (const d of decls) {
  const have = measured.get(d.caseName);
  if (have === undefined) { skipped++; continue; }
  checked++;
  const expected = overrides.get(d.caseName);
  if (expected !== undefined) {
    overridden++;
    if (!expected.includes(have)) bad.push({ ...d, have, declared: expected.join('|'), how: d.how + '，覆盖值' });
  } else if (have !== d.declared) {
    bad.push({ ...d, have });
  }
}

if (ambiguous.length) {
  console.error(`❌ 有 ${ambiguous.length} 处「（N 条断言）」无法归类到用例 —— 守门对它们无效：`);
  for (const a of ambiguous) {
    console.error(`   ${a.file}:${a.line}  ${a.why}`);
    console.error(`     ${a.text}`);
  }
  console.error('   修法：把这行改成规范写法（同行写 `run.sh <用例>`，或放进"块内已点名用例"的围栏里）');
}

if (bad.length) {
  console.error(`❌ 断言计数与文档不一致（${bad.length} 处，${end}端）：`);
  for (const b of bad) {
    console.error(`   ${b.file}:${b.line}  用例 ${b.caseName}  文档 ${b.declared}  实测 ${b.have}（${b.how}）`);
    console.error(`     文档原行：${read(b.file).split('\n')[b.line - 1].trim().slice(0, 120)}`);
  }
  console.error('   修法：把文档里的数字改成实测值 —— 数字只能来自运行期 emit 的 PASS 行，不许用 grep 数 check(');
  console.error(`   （实测值：${bad.map((b) => `${b.caseName}=${b.have}`).join(' ')}）`);
}

if (bad.length || ambiguous.length) process.exit(1);
console.log(`✅ 断言计数守门（${end}端）：核对 ${checked} 处声明，全部与实测一致`
  + (overridden ? `（其中 ${overridden} 处按分端覆盖值核对）` : '')
  + (skipped ? `（另有 ${skipped} 处因本次未跑该用例而跳过）` : ''));
