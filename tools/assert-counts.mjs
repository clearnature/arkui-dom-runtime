/*
 * 断言计数守门（R176 起：清单单一源）：runner 实测 PASS 行数 ←→
 * 【tools/assert-counts.expected.tsv 清单】←→ 文档「（N 条断言）」三者互证。
 *
 * 为什么改（R174.1 教训）：文档曾是唯一权威源——每个用例的计数散在 README/
 * ROADMAP/CAPABILITY/ARCHITECTURE 多处手工同步，本周 scrolldemo 一次改动要找
 * 3 处声明（第三处靠守门报错才发现）；历史行还要「避文法改写」。现在：
 *   · **唯一手写源 = 清单 TSV**（改计数只改它一处）；
 *   · 文档数字=展示真值：改完清单跑 `--sync-docs` 一键回写全部声明位；
 *   · runner 核对实测 vs 清单（分端期望仍走 --overrides 覆盖表，机制不变）；
 *   · 守门同时核 文档 vs 清单（漂了提示跑 --sync-docs），文法纪律照旧保留。
 *
 * 为什么不能 grep 数 test/*.html 的 `check(`：
 *   realfs.html 里 `check(` 28 处但两端各只执行 21 条（7 处在互斥分支）。
 *   **唯一权威是运行期真的 emit 出来的 PASS 行**，由 runner 落盘 counts.tsv。
 *
 * 用法：
 *   node tools/assert-counts.mjs --browser   <counts.tsv> [--overrides <f>] [--label <端>]
 *   node tools/assert-counts.mjs --electron  <counts.tsv> [--overrides <f>]
 *   node tools/assert-counts.mjs --report    <counts.tsv>   报告清单/文档/实测三方对照
 *   node tools/assert-counts.mjs --export                    清单 ← 文档（迁移/重建引导，一次性）
 *   node tools/assert-counts.mjs --sync-docs                 文档 ← 清单（改计数后的回写）
 *
 *   counts.tsv 每行： <用例名>\t<实测 PASS 行数>      （由 run.sh / electron/run.sh 生成）
 *   清单 TSV 每行：  <用例名>\t<期望数>\t<备注>        （# 注释；期望=各端统一值）
 *
 * --overrides（R144，机制不变）：分端期望值表（如 realfs 20,21 时序两态皆合法），
 *   文件每行 <用例>\t<该端期望值>\t<理由>。命中覆盖优先于清单；覆盖是「带理由的
 *   期望」不是豁免，集合之外仍红。
 *
 * 文档声明的两种规范写法（照旧）：
 *   ① 同行：`bash run.sh <用例>` …（N 条断言…）
 *   ② 围栏块内：块内先点名用例，块内随后的「（N 条断言）」归它
 *   含「条断言失败 / 条红」的行是失败数、自动跳过。
 *
 * 退出码：0 = 三方一致；1 = 有漂移（分区打印 + 各自修法）。
 * 未在本次运行测到的用例不因实测缺位报错（单用例只核它自己），计入跳过。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const DOCS = ['README.md', 'docs/ROADMAP.md', 'docs/ARCHITECTURE.md', 'docs/CAPABILITY.md'];
const EXPECTED_TSV = 'tools/assert-counts.expected.tsv';
// 用例名：`run.sh xxx` / `./run.sh xxx` / `bash run.sh xxx` / `electron/run.sh xxx`
const CASE_RE = /(?:bash\s+|\.\/)?(?:electron\/)?run\.sh\s+([a-z][a-z0-9-]*)/g;
// 数字必须紧跟在（ ( ， , * 之后才算"声明"——"被 5 条断言抓住"这类散文不误判
const NUM_RE = /[（(，,*](\d+)\s*条断言/;
const COUNT_MEANING_RE = /条断言失败|条红|条断言被|条断言没牙齿/;   // 破坏验证的失败数

const argv = process.argv.slice(2);
const mode = argv[0];
const file = (mode === '--browser' || mode === '--electron' || mode === '--report') ? argv[1] : null;
let overridePath = null;
let label = null;
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === '--overrides') { overridePath = argv[i + 1]; i++; }
  else if (argv[i] === '--label') { label = argv[i + 1]; i++; }
}
if (!['--browser', '--electron', '--report', '--sync-docs', '--export'].includes(mode)
    || ((mode === '--browser' || mode === '--electron' || mode === '--report') && !file)) {
  console.error('用法: node tools/assert-counts.mjs --browser|--electron|--report <counts.tsv> [--overrides <f>] [--label <端>] | --export | --sync-docs');
  process.exit(2);
}

// ── 清单（R176 唯一手写权威源）──
function loadManifest() {
  const m = new Map();
  if (!fs.existsSync(path.join(ROOT, EXPECTED_TSV))) return m;
  // R177：Windows checkout 行尾可能是 CRLF——split(/\r?\n/) + 去行尾 \r。
  // 实录：cb07bbb 三窗腿 160 处"清单缺该用例"（\r 使锚定正则全灭；Linux 腿同
  // commit 全绿=排除文件缺失），旧 measured loader 用 \s*$ 恰好耐 \r 所以从未暴露。
  for (const line of read(EXPECTED_TSV).split(/\r?\n/)) {
    const g = line.replace(/\r$/, '').match(/^([a-z][a-z0-9-]*)\t(\d+)(?:\t.*)?$/);
    if (g) m.set(g[1], Number(g[2]));
  }
  if (m.size === 0) {
    const b = fs.readFileSync(path.join(ROOT, EXPECTED_TSV));
    console.error(`❌ 清单 0 行可解析（${EXPECTED_TSV} 存在=${true} 字节=${b.length} 首行=${JSON.stringify(b.toString('utf8').split(/\r?\n/)[0] || '')}）`);
    process.exit(1);
  }
  return m;
}
const manifest = loadManifest();

// ── 分端期望值覆盖（R144，机制不变；可选）──
const overrides = new Map();
if (overridePath) {
  for (const line of fs.readFileSync(overridePath, 'utf8').split(/\r?\n/)) {
    const m = line.replace(/\r$/, '').match(/^([a-z][a-z0-9-]*)\t([\d,]+)\t/);
    if (m) overrides.set(m[1], m[2].split(',').map(Number));
  }
}

// ── 实测值（runner 落盘）──
const measured = new Map();
if (file) {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.replace(/\r$/, '').match(/^([a-z][a-z0-9-]*)\t(\d+)$/);
    if (m) measured.set(m[1], Number(m[2]));
  }
  if (mode !== '--export' && mode !== '--sync-docs' && measured.size === 0) {
    console.error(`❌ ${file} 里没有任何「<用例>\t<数>」记录（runner 没写？）`);
    process.exit(1);
  }
}

// ── 解析文档声明（语法机制保留——文档=展示真值，与清单互证）──
const decls = [];
const ambiguous = [];
for (const doc of DOCS) {
  let inFence = false;
  let fenceCase = null;
  const lines = read(doc).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*```/.test(raw)) { inFence = !inFence; if (inFence) fenceCase = null; continue; }
    const uniq = [...new Set([...raw.matchAll(CASE_RE)].map((m) => m[1]))];
    if (inFence && uniq.length === 1) fenceCase = uniq[0];
    const num = raw.match(NUM_RE);
    if (!num || COUNT_MEANING_RE.test(raw)) continue;
    if (uniq.length === 1) {
      decls.push({ file: doc, line: i, caseName: uniq[0], declared: Number(num[1]), how: '同行', num0: num.index, num1: num.index + num[0].length });
    } else if (uniq.length === 0) {
      if (inFence && fenceCase) {
        decls.push({ file: doc, line: i, caseName: fenceCase, declared: Number(num[1]), how: '块内', num0: num.index, num1: num.index + num[0].length });
      } else {
        ambiguous.push({ file: doc, line: i + 1, text: raw.trim(), why: '有数字但既没写用例名、也不在"块内已点名用例"的围栏里' });
      }
    } else {
      ambiguous.push({ file: doc, line: i + 1, text: raw.trim(), why: `一行里出现多个用例名：${uniq.join(' ')}` });
    }
  }
}

// ── --export：清单 ← 文档（迁移/重建引导：以当前文档声明为初始权威）──
if (mode === '--export') {
  const byCase = new Map();
  const conflicts = [];
  for (const d of decls) {
    if (byCase.has(d.caseName) && byCase.get(d.caseName) !== d.declared) {
      conflicts.push(`${d.caseName}: 文档两处声明不一致 ${byCase.get(d.caseName)} vs ${d.declared}（${d.file}:${d.line + 1}）`);
    }
    byCase.set(d.caseName, d.declared);
  }
  if (ambiguous.length || conflicts.length) {
    for (const a of ambiguous) console.error(`❌ 无法归类：${a.file}:${a.line + 1} ${a.why}`);
    for (const c of conflicts) console.error('❌ ' + c);
    console.error('   先把文档修成规范且一致的声明，再 --export');
    process.exit(1);
  }
  const out = [
    '# 断言计数期望清单（R176 起唯一手写权威源——runner 实测与文档展示都以它为准）。',
    '# 格式：<用例名>\\t<期望 PASS 数>\\t<备注>；分端差异（如 realfs 20,21）走各端',
    '# assert-overrides.tsv 覆盖表，机制不变。改计数：改本文件 → --sync-docs 回写文档。',
    '# 生成：node tools/assert-counts.mjs --export（从文档声明重建；--sync-docs 反向回写）。',
    '',
  ];
  for (const k of [...byCase.keys()].sort()) out.push(`${k}\t${byCase.get(k)}`);
  fs.writeFileSync(path.join(ROOT, EXPECTED_TSV), out.join('\n') + '\n');
  console.log(`✅ 清单已写入 ${EXPECTED_TSV}：${byCase.size} 个用例（源=文档声明）`);
  process.exit(0);
}

// ── --sync-docs：文档 ← 清单（回写全部声明位的数字）──
if (mode === '--sync-docs') {
  if (manifest.size === 0) { console.error(`❌ 清单为空/缺失（${EXPECTED_TSV}）——先 --export`); process.exit(1); }
  const perFile = new Map();
  let changed = 0, missing = 0;
  for (const d of decls) {
    const want = manifest.get(d.caseName);
    if (want === undefined) { missing++; console.error(`   ⚠ 清单缺用例 ${d.caseName}（${d.file}:${d.line + 1}）——先 --export 补齐`); continue; }
    if (want === d.declared) continue;
    let arr = perFile.get(d.file);
    if (!arr) { arr = read(d.file).split('\n'); perFile.set(d.file, arr); }
    const raw = arr[d.line];
    // 只替换解析命中段内的【数字】——前导标点/加粗（（N / **N 等）原样保留；
    // 历史数字在段外（如「R46 时 16；R173 扩到 **26 条断言」的 16），永不触碰
    const span = raw.slice(d.num0, d.num1);
    arr[d.line] = raw.slice(0, d.num0) + span.replace(/\d+/, String(want)) + raw.slice(d.num1);
    changed++;
  }
  for (const [f, lines] of perFile) fs.writeFileSync(path.join(ROOT, f), lines.join('\n'));
  console.log(`✅ 文档回写：${changed} 处声明位 ← 清单（${missing} 处清单缺位待 --export）`);
  process.exit(missing ? 1 : 0);
}

if (mode === '--report') {
  console.log(`实测输入：${measured.size} 个用例（${file}）；清单 ${manifest.size} 个；文档声明 ${decls.length} 处`);
  for (const d of decls) {
    const mv = manifest.get(d.caseName);
    const have = measured.get(d.caseName);
    const mMark = mv === undefined ? '❌清单缺' : mv !== d.declared ? `❌清单 ${mv}` : '✅';
    const tMark = have === undefined ? '·未测' : have === d.declared ? '=文档' : `❌实测 ${have}`;
    console.log(`  ${mMark}  ${d.caseName.padEnd(14)} 文档 ${String(d.declared).padStart(3)}  ${tMark}  ${d.file}:${d.line + 1}`);
  }
  for (const a of ambiguous) console.log(`  ⚠️  无法归类：${a.file}:${a.line}（${a.why}）\n        ${a.text}`);
  const badDocs = decls.filter((d) => manifest.get(d.caseName) !== d.declared).length;
  console.log(`合计：文档 ${decls.length} 处；与清单不一致 ${badDocs} 处；无法归类 ${ambiguous.length} 处`);
  process.exit(badDocs || ambiguous.length ? 1 : 0);
}

// ── runner 校验模式（--browser / --electron）──
const end = label || (mode === '--browser' ? '浏览器' : 'Electron');
const badDocs = [];      // 文档 vs 清单（修法：--sync-docs 或改清单）
const badMeasured = [];  // 实测 vs 清单/覆盖（修法：改清单——数字只来自运行期 PASS 行）
const noManifest = [];   // 实测但清单未收录（与旧守门"未声明不报错"同宽：计跳过不红）
let checkedDocs = 0, checkedMeasured = 0, overridden = 0, skippedDocs = 0;

// 1) 文档 ↔ 清单
for (const d of decls) {
  const want = manifest.get(d.caseName);
  if (want === undefined) { badDocs.push({ ...d, reason: '清单缺该用例（先 --export 补）' }); continue; }
  checkedDocs++;
  if (want !== d.declared) badDocs.push({ ...d, want });
}
// 2) 实测 ↔ 清单（覆盖优先）
for (const [caseName, have] of measured) {
  const ov = overrides.get(caseName);
  if (ov !== undefined) {
    checkedMeasured++; overridden++;
    if (!ov.includes(have)) badMeasured.push({ caseName, have, want: ov.join('|'), via: '分端覆盖值' });
    continue;
  }
  const want = manifest.get(caseName);
  if (want === undefined) { noManifest.push(caseName); continue; }
  checkedMeasured++;
  if (have !== want) badMeasured.push({ caseName, have, want, via: '清单' });
}
skippedDocs = decls.length - checkedDocs;

if (ambiguous.length) {
  console.error(`❌ 有 ${ambiguous.length} 处「（N 条断言）」无法归类到用例：`);
  for (const a of ambiguous) console.error(`   ${a.file}:${a.line}  ${a.why}\n     ${a.text}`);
  console.error('   修法：改成规范写法（同行 `run.sh <用例>`，或"块内已点名用例"的围栏里）');
}
if (badDocs.length) {
  console.error(`❌ 文档声明与清单不一致（${badDocs.length} 处）：`);
  for (const b of badDocs) {
    console.error(`   ${b.file}:${b.line + 1}  用例 ${b.caseName}  文档 ${b.declared}${b.want !== undefined ? `  清单 ${b.want}` : `  ${b.reason}`}`);
    console.error(`     文档原行：${read(b.file).split('\n')[b.line].trim().slice(0, 120)}`);
  }
  console.error('   修法：数字认定后改 tools/assert-counts.expected.tsv（唯一手写源），再跑 node tools/assert-counts.mjs --sync-docs 回写文档');
}
if (badMeasured.length) {
  console.error(`❌ 实测计数与清单不一致（${badMeasured.length} 处，${end}端）：`);
  for (const b of badMeasured) console.error(`   ${b.caseName}  实测 ${b.have}  期望 ${b.want}（${b.via}）`);
  console.error('   修法：数字只能来自运行期 emit 的 PASS 行——把实测值写进清单（不许 grep 数 check(');
  console.error(`   （实测值：${badMeasured.map((b) => `${b.caseName}=${b.have}`).join(' ')}）`);
}
if (badDocs.length || badMeasured.length || ambiguous.length) process.exit(1);

let tail = `✅ 断言计数守门（${end}端）：实测 ${checkedMeasured} 例核清单一致`
  + (checkedDocs ? `；文档 ${checkedDocs} 处声明与清单一致` : '')
  + (overridden ? `（其中 ${overridden} 处按分端覆盖值核对）` : '')
  + (skippedDocs ? `（另有 ${skippedDocs} 处声明的用例本次未测、跳过实测核对）` : '');
if (noManifest.length) tail += `（清单未收录：${noManifest.join(' ')}）`;
console.log(tail);
