/*
 * 从 ets-loader 的组件元数据生成 DOM 组件骨架注册表。
 *
 * 输入: <CLT>/sdk/default/openharmony/ets/build-tools/ets-loader/components/*.json
 *       每个文件形如 { "name": "Text", "children": [...], "attrs": [...] }
 * 输出: runtime/generated-components.js —— 经典脚本，挂 globalThis.__ARKUI_COMPONENTS
 *
 * 为什么生成而不是手写：150 个组件 × 几十个属性是机械劳动；元数据里 attrs 是
 * 平铺的属性名清单，正好可以驱动"属性 setter 要不要预声明"。人手只需要补
 * 【DOM 映射画像】(容器的 flex 方向、leaf 的标签、输入类控件的 type 等)。
 *
 * 用法: node tools/gen-components.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';

const CLT = '/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools';
const SRC_DIR = path.join(CLT, 'sdk/default/openharmony/ets/build-tools/ets-loader/components');
const OUT = path.resolve('runtime/generated-components.js');

// ── DOM 画像：按组件名给出标签与基础样式（未列出的走默认 div/block）──
// 规则：容器给 flex/relative，输入类给对应原生控件，媒体给对应标签，绘图给 SVG。
const CONTAINERS = {
  Column: { flexDirection: 'column' }, Row: { flexDirection: 'row' },
  Flex: { flexDirection: 'row', flexWrap: 'wrap' }, Stack: { position: 'relative' },
  // 滚动容器一律 position:relative：这样后代 offsetTop 以它为基准（Scroller.scrollToIndex 依赖）
  List: { display: 'flex', flexDirection: 'column', overflow: 'auto', position: 'relative' },
  Grid: { display: 'grid', overflow: 'auto', position: 'relative' },
  GridRow: { display: 'grid' }, GridCol: {},
  Scroll: { overflow: 'auto', display: 'block', position: 'relative' },
  Swiper: { position: 'relative', overflow: 'hidden' }, Tabs: { display: 'block' },
  TabContent: { display: 'block' }, Refresh: { display: 'block' },
  RelativeContainer: { position: 'relative', display: 'block' },
  SideBarContainer: { display: 'flex' }, Navigation: { display: 'block' },
  Navigator: { display: 'block' }, Panel: { display: 'block' }, WaterFlow: { display: 'flex' },
  Badge: { position: 'relative', display: 'inline-block' }, Counter: { display: 'inline-flex' },
  FlowItem: {}, GridItem: {}, ListItem: { display: 'block' }, ScrollableCommon: {},
  // 容器型但习惯上单子：下面这些仍按容器处理
  Button: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
};

const LEAF_TAGS = {
  Text: 'div', Span: 'span', ContainerSpan: 'span', SymbolSpan: 'span', Marquee: 'span',
  Image: 'img', ImageSpan: 'span', Video: 'video', Web: 'iframe', Canvas: 'canvas',
  XComponent: 'canvas', TextInput: 'input', TextArea: 'textarea', Search: 'input',
  Checkbox: 'input', Radio: 'input', Toggle: 'input', Slider: 'input', Select: 'select',
  Rating: 'div', Progress: 'progress', LoadingProgress: 'div', Divider: 'hr',
  Blank: 'div', QRCode: 'canvas', Gauge: 'div', DataPanel: 'div',
  Circle: 'circle', Ellipse: 'ellipse', Line: 'line', Path: 'path', Polygon: 'polygon',
  Polyline: 'polyline', Rect: 'rect', Shape: 'svg',
  DatePicker: 'div', TimePicker: 'div', TextPicker: 'div', CalendarPicker: 'div',
  Calendar: 'div', Marker: 'div', Particle: 'div', ParticleComponent: 'div',
};

// 输入类控件的原生 type
const INPUT_TYPE = {
  Checkbox: 'checkbox', Radio: 'radio', Toggle: 'checkbox', Slider: 'range',
  TextInput: 'text', Search: 'search',
};

// 工厂方法名（官方不统一：Button 用 createWithLabel）
const FACTORIES = {
  Button: ['create', 'createWithLabel', 'createWithIcon', 'createWithChild'],
  TextInput: ['create'], Image: ['create', 'createWithUri'],
};

// 只有这些组件在真实 ArkUI 里是"不可见容器"（If/ForEach 之类已手写，不在元数据里）
const SKIP = new Set(['common_attrs', 'Common']);

function profileOf(name, meta) {
  const isContainer = name in CONTAINERS || (Array.isArray(meta.children) && meta.children.length > 0
    && !(name in LEAF_TAGS));
  const tag = LEAF_TAGS[name] || 'div';
  const base = isContainer ? Object.assign({ display: 'flex' }, CONTAINERS[name] || {}) : {};
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    base.display = 'inline-block';
  }
  if (name === 'Blank') { base.flexGrow = '1'; base.alignSelf = 'stretch'; }
  return {
    tag,
    isContainer,
    baseStyle: base,
    inputType: INPUT_TYPE[name] || null,
    factories: FACTORIES[name] || ['create'],
  };
}

const names = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.json')).sort();
const out = {};
const skipped = [];
for (const f of names) {
  const meta = JSON.parse(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'));
  const name = meta.name;
  if (!name || SKIP.has(name)) { skipped.push(f); continue; }
  out[name] = {
    attrs: meta.attrs || [],
    children: meta.children || [],
    file: f,
    ...profileOf(name, meta),
  };
}

const banner = `/*
 * 自动生成，请勿手改 —— 由 tools/gen-components.mjs 从
 * <CLT>/sdk/default/openharmony/ets/build-tools/ets-loader/components/*.json 生成。
 * 重新生成： node tools/gen-components.mjs
 * 组件数: ${Object.keys(out).length}
 */
`;
const body = `(function (global) {
  'use strict';
  global.__ARKUI_COMPONENTS = ${JSON.stringify(out, null, 1)};
})(typeof globalThis !== 'undefined' ? globalThis : self);
`;
const generated = banner + body;
const checkOnly = process.argv.includes('--check');
// 注意：string.length 是 UTF-16 码元数，不是字节数（banner 里有中文，3 字节/字）。
// 报告体积一律用 Buffer.byteLength，否则会得出"文件比生成长 48 字节"这种假差异。
const bytes = (s) => Buffer.byteLength(s, 'utf8');

// --check：只比对，不落盘。生成物是提交物，一旦与生成器脱钩（有人手改过、
// 或元数据/画像规则变了没重生成），必须让 CI 看见，而不是静默覆盖掉差别。
if (checkOnly) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  if (current === generated) {
    console.log(`✅ ${path.relative(process.cwd(), OUT)} 与生成器一致（${Object.keys(out).length} 个组件，${bytes(generated)} 字节）`);
    process.exit(0);
  }
  console.error(`❌ ${path.relative(process.cwd(), OUT)} 与生成器不一致`);
  console.error(current === null
    ? '   文件不存在'
    : `   文件 ${bytes(current)} 字节 / 生成器 ${bytes(generated)} 字节`);
  if (current !== null) {
    // 给出第一处差异的行号，省去全文件 diff 的成本
    const a = current.split('\n'), b = generated.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.error(`   首个差异在第 ${i + 1} 行：`);
        console.error(`     现有    ${JSON.stringify(a[i] ?? '<缺>' )}`);
        console.error(`     应生成  ${JSON.stringify(b[i] ?? '<缺>' )}`);
        break;
      }
    }
  }
  console.error('   修复： node tools/gen-components.mjs');
  process.exit(1);
}

fs.writeFileSync(OUT, generated);

const containers = Object.values(out).filter((c) => c.isContainer).length;
console.log(`组件元数据读取 ${names.length} 个文件 → 注册 ${Object.keys(out).length} 个组件`);
console.log(`  容器 ${containers} / 叶子 ${Object.keys(out).length - containers}；跳过 ${skipped.length}（${skipped.join(',')}）`);
console.log(`  输出: ${OUT} (${(banner + body).length} 字节)`);
console.log(`  抽样: ${['Text', 'Column', 'Button', 'Image', 'TextInput', 'Slider', 'Progress', 'Grid']
  .filter((n) => out[n]).map((n) => `${n}(${out[n].tag}${out[n].isContainer ? ',容器' : ''})`).join(' ')}`);
