// 生成 runtime/src/generated-sys-resources.js（E1-4：sys.* 系统资源表——id → 归一化值）
//   node tools/gen-sys-resources.mjs            # 生成
//   node tools/gen-sys-resources.mjs --check    # 只校验（产物漂移即非 0 退出）
//
// 源 = <CLT>/sdk/default/openharmony/previewer/common/resources/entry/resources.txt
//（预览器资源总表，75 个分段：glasses / 各 locale / base（light 主表）/ dark / …；
//  每段以 `keyconfig:…` 行开头、紧跟一行限定词（段名），随后是若干
//  `id:<十进制>, '<值>' '<资源名>'` 行）。
//
// ── 值归一化规则（生成器与产物头注各写一份，两处必须同步改）──────────────
//   '28.0vp' / '14.0fp' / '21px' → 数值 28 / 14 / 21
//     （vp/fp/px 与 px 1:1 —— 项目口径，同 runtime/src/main.js resolveResource 注释；
//      fp 理论上随系统字宽缩放，本运行时一律 1:1）
//   '10.0' / '1' / '10.5'        → 数值 10 / 1 / 10.5（裸数，去尾零）
//   '0xF1315'                    → 数值 989205（符号字形码点，按 16 进制字面量转数）
//   '#ff182431'（8 位）           → '#182431ff'（ArkUI 是 #AARRGGBB，CSS 是 #RRGGBBAA——
//     两种 8 位 hex 通道序不同，直接透传会错位；必须重排成 CSS 形态。
//     走字符串而不是 number：main.js 的 fontColor 萰 cssPropSize→String(resolveResource(v))，
//     CSS 8 位 hex 浏览器原生可吃，number 0xAARRGGBB 反而会被当字符串拼坏）
//   '#1A000000'（大小写混排）     → 统一小写后再按上条重排
//   '#182431'（6 位 #RRGGBB）     → 原样保留（CSS 同构，无需换算）
//   'true' / 'false'             → 布尔 true / false
//   其余                          → 字符串原样（'%1$d/%2$d'、'%sx' 等格式串也是字符串）
//
// ── 跳过（引用型，静态不可解）────────────────────────────────────────────
//   '$color:…' '$float:…' '$media:…' '$pattern:…' '$string:…' → 跳过并按前缀计数（写进产物头注）
//
// ── light 口径（同 id 多段取值规则）──────────────────────────────────────
//   同一 id 在多个分段重复出现（light/dark/locale/设备段各一份）：
//   优先取 base（light 主表）段的值；base 没有的 id 才回退全文件首次出现。
//   注意不能无脑"取第一次出现"——文件里 glasses（眼镜设备）段排在 base 之前，
//   无脑首取会拿到设备特化值（如 ohos_id_corner_radius_card 8vp 而非 light 的 24vp）。
//   dark 段的值一律不收（同一 id 的暗色变体），dark 专属资源名（…_dark）在 base
//   段有自己的 id，会以 light 值正常收录。
//
// ── 规模护栏 ─────────────────────────────────────────────────────────────
//   全量唯一 id ≈ 7.7k。若产物 JSON 体超过 800KB，则只收 number（float/integer）、
//   color、string 三类（等价于任务口径的 string/float/integer/color 四类），裁掉的
//   条数写进产物头注；仍超则如实记录体积（此时已无可裁类别）。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = '/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools'
  + '/sdk/default/openharmony/previewer/common/resources/entry/resources.txt';
const OUT = path.join(ROOT, 'runtime/src/generated-sys-resources.js');
const SIZE_BUDGET = 800 * 1024;   // 产物 JSON 体的体积护栏（字节）

// ── 解析 ──────────────────────────────────────────────────────────────────
// 返回 { table: Map<id, {value, fromBase, name}>, stats }
function parse() {
  const lines = fs.readFileSync(SRC, 'utf8').split('\n');
  const table = new Map();          // id → { value: 归一化后, fromBase: boolean, name }
  const darkTable = new Map();      // R141：dark 段 id → 归一化值（仅 dark 段内出现的条目）
  let inDark = false;
  const stats = {
    idLines: 0,                     // 以 `id:` 开头的物理行数
    unparsed: 0,                    // id 行里不匹配标准三段式的（全文件仅 1 条 es 段跨行串）
    sections: 0,                    // keyconfig 分段数
    section: '',                    // 当前段名
    refSkipped: {},                 // 引用型按前缀计数：{ '$color': n, … }
    fromBase: 0,                    // 取到 base（light）段值的 id 数
    fromFallback: 0,                // base 没有、回退首次出现的 id 数
  };
  const ID_RE = /^id:(\d+), '(.*)' '(.*)'$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('keyconfig:')) {
      stats.sections++;
      stats.section = (lines[i + 1] || '').trim();   // 分段头的下一行 = 段名（base/dark/locale…）
      inDark = stats.section === 'dark';
      i++;
      continue;
    }
    if (!line.startsWith('id:')) continue;
    stats.idLines++;
    const m = line.match(ID_RE);
    if (!m) { stats.unparsed++; continue; }
    const id = Number(m[1]);
    const name = m[3];
    const norm = normalize(m[2], stats);
    if (norm === null) continue;                      // 引用型：normalize 里已计数
    if (inDark && !darkTable.has(id)) darkTable.set(id, norm);   // R141：dark 段烘制
    const isBase = stats.section === 'base';
    const prev = table.get(id);
    // base（light）优先；base 段内部同 id 重复（不应发生）取首条；非 base 只在还没有值时占位
    if (!prev || (isBase && !prev.fromBase)) {
      table.set(id, { value: norm, fromBase: isBase, name });
      if (isBase && (!prev || !prev.fromBase)) stats.fromBase++;
      else if (!prev) stats.fromFallback++;
    }
  }
  stats.fromFallback = table.size - stats.fromBase;   // 回退数 = 总数 - base 直取数
  return { table, darkTable, stats };
}

// ── 归一化（规则见文件头注；两处必须同步改）────────────────────────────────
const REF_RE = /^\$([a-z]+):/;
const HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const UNIT_RE = /^(-?\d+(?:\.\d+)?)(vp|fp|px)$/;
const NUM_RE = /^-?\d+(?:\.\d+)?$/;
const HEXINT_RE = /^0x[0-9a-fA-F]+$/;
/** @param {string} raw @param {any} stats */
function normalize(raw, stats) {
  // 引用型：$color:125829120 / $float:… / $media:… / $pattern:… / $string:… → 静态不可解，跳过
  const ref = raw.match(REF_RE);
  if (ref) {
    const k = '$' + ref[1];
    stats.refSkipped[k] = (stats.refSkipped[k] || 0) + 1;
    return null;
  }
  const hex = raw.match(HEX_RE);
  if (hex) {
    const h = hex[1].toLowerCase();
    if (h.length === 8) return '#' + h.slice(2) + h.slice(0, 2);   // #AARRGGBB → #RRGGBBAA（CSS 形态）
    return '#' + h;                                                 // 6 位已是 CSS 同构
  }
  const unit = raw.match(UNIT_RE);
  if (unit) return Number(unit[1]);                                 // vp/fp/px → 裸数（1:1 口径）
  if (NUM_RE.test(raw)) return Number(raw);                         // 裸数去尾零（'10.0'→10）
  if (HEXINT_RE.test(raw)) return Number(raw);                      // 0xF1315 → 码点数值
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;                                                       // 其余按字符串原样
}

const kindOf = (v) =>
  typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean'
    : typeof v === 'string' && HEX_RE.test(v) ? 'color' : 'string';

// ── 产物文本 ──────────────────────────────────────────────────────────────
/** @param {Map<any, any>} table @param {any} stats @param {number=} [cut] */
function emit(table, stats, cut) {
  const body = JSON.stringify(Object.fromEntries([...table].map(([id, e]) => [String(id), e.value])));
  const kindCounts = {};
  for (const e of table.values()) { const k = kindOf(e.value); kindCounts[k] = (kindCounts[k] || 0) + 1; }
  const refs = Object.entries(stats.refSkipped).map(([k, n]) => `${k} ${n}`).join(' / ') || '（无）';
  const rules = [
    "  //   '28.0vp'/'14.0fp'/'21px' → 28/14/21（vp/fp/px 与 px 1:1 项目口径，同 main.js resolveResource 注释）",
    "  //   '10.0'/'1' → 10/1（裸数去尾零）；'0xF1315' → 989205（符号字形码点转数）",
    "  //   '#ff182431'（ArkUI #AARRGGBB）→ '#182431ff'（CSS #RRGGBBAA 重排——两种 8 位 hex 通道序不同，",
    "  //     直接透传会错位；走字符串是因为 fontColor 萰 cssPropSize→String(resolveResource(v))，CSS 8 位",
    "  //     hex 浏览器原生可吃，0xAARRGGBB number 会被当字符串拼坏）；6 位 '#RRGGBB' 原样（CSS 同构）",
    "  //   'true'/'false' → 布尔；其余字符串原样（'%1$d/%2$d' 等格式串也是字符串）",
  ].join('\n');
  return `// 自动生成：node tools/gen-sys-resources.mjs（勿手改）——E1-4 sys.* 系统资源表
// 运行时 main.js 的 resolveResource 对带数字 id 的 Resource 对象查 globalThis.__arkui_dom_resources
//（id→值）；本表直接填充该同名表，main.js 零改动。
// 来源：${SRC}
// 口径：同 id 多段（light/dark/locale/设备）取 base（light 主表）段；base 没有的 id 回退全文件
//       首次出现。dark 段对同 id 的暗色覆盖一律不收（dark 专属资源名在 base 段有自己的 id）。
// 统计：id 行 ${stats.idLines}（不合规 ${stats.unparsed}，全部 ${stats.sections} 个分段）；
//       收录 ${table.size} 条（number ${kindCounts.number || 0} / color ${kindCounts.color || 0} / string ${kindCounts.string || 0} / boolean ${kindCounts.boolean || 0}${cut ? `；体积护栏裁掉非三类 ${cut} 条` : ''}）；
//       base 直取 ${stats.fromBase} 条，回退首取 ${stats.fromFallback} 条；
//       dark 段 ${darkTable.size} 条（R141）；
//       跳过引用型 ${Object.values(stats.refSkipped).reduce((a, b) => a + b, 0)} 条（${refs}）。
// 换算规则：
${rules}
(function () {
  (/** @type {any} */ (globalThis)).__arkui_dom_resources = ${body};
  // R141：dark 段（WithTheme colorMode=2 时 resolveResource 优先查此表）
  (/** @type {any} */ (globalThis)).__arkui_dom_resources_dark = ${darkBody};
})();
`;
}

// ── 主流程 ────────────────────────────────────────────────────────────────
const { table, darkTable, stats } = parse();
const darkBody = JSON.stringify(Object.fromEntries([...darkTable].map(([id, v]) => [String(id), v])));
let cut = 0;
let text = emit(table, stats, 0);
if (Buffer.byteLength(text, 'utf8') > SIZE_BUDGET) {
  // 体积护栏：只收 number（float/integer）/color/string，裁掉 boolean 及其它异形
  const slim = new Map();
  for (const [id, e] of table) {
    if (kindOf(e.value) === 'number' || kindOf(e.value) === 'color' || kindOf(e.value) === 'string') {
      slim.set(id, e);
    } else cut++;
  }
  text = emit(slim, stats, cut);
}

if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== text) {
    console.error('❌ generated-sys-resources.js 与 SDK resources.txt 漂移——重跑 node tools/gen-sys-resources.mjs');
    process.exit(1);
  }
  console.log(`✅ generated-sys-resources 与源一致（${table.size + cut} 条 / 裁 ${cut}）`);
} else {
  fs.writeFileSync(OUT, text);
  const kb = (Buffer.byteLength(text, 'utf8') / 1024).toFixed(0);
  console.log(`✅ 已生成 ${path.relative(ROOT, OUT)}（收录 ${table.size} / 裁 ${cut} / 引用型跳过 `
    + `${Object.values(stats.refSkipped).reduce((a, b) => a + b, 0)} / 体积 ${kb}KB）`);
}
