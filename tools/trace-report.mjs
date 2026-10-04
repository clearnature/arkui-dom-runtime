#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// trace-report.mjs —— CDP Tracing 拆解（R164 DOM 专项量化档）
//
// 输入：electron/main.js ARKUI_TRACE=1 产出的 build/<页>.trace.json。
// 口径：按线程扫事件栈算【互斥时间】（exclusive = 自身 dur − 直接子事件之和），
//       嵌套不双计——style/layout/paint 是互斥兄弟相，bucket 求和即真占比。
// 输出：bucket 表（style/layout/paint/script/other 互斥 ms + %）+ top 事件名。
//
// 用法：node tools/trace-report.mjs build/stress10k.trace.json [more...]
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) { console.error('用法: node tools/trace-report.mjs <x.trace.json> [...]'); process.exit(2); }

// Blink 真实事件名是 legacy 形态（LocalFrameView::performLayout / Document::recalcStyle
// / InlineNode::ShapeText…）——分类按实测 TOP 名单校准（R164 首采校正）
const BUCKETS = [
  ['style 样式重算', /recalcStyle|RecalculateStyles|StyleInvalidator|UpdateStyle|InvalidateLayout|Interpolation/],
  ['layout 布局+排版', /performLayout|^Layout$|rebuildLayoutTree|LayoutTree|ShapeText|LayoutShift/],
  ['paint 绘制合成', /PrePaint|\bPaint\b|Raster|Compositing|Commit/],
  ['parse 解析', /parseOnBackgroundParsing|CSSParser|TextResourceDecoder|v8\.compile|EvaluateScript/],
  ['script 脚本回调', /TimerFire|RunMicrotasks|EventDispatch|FunctionCall|v8\.|BlinkGC|GC_|AsyncTask/],
];
const bucketOf = (name) => {
  for (const [b, re] of BUCKETS) if (re.test(name)) return b;
  return 'other 其他';
};

for (const f of files) {
  const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
  const evs = (doc.traceEvents || []).filter((e) => e && e.dur > 0 && typeof e.ts === 'number');
  if (!evs.length) { console.log(`\n## ${f}\n（零有效事件——页面没跑或类别没采到）`); continue; }

  // 按线程分组扫栈求互斥时间
  const byTid = new Map();
  for (const e of evs) {
    if (!byTid.has(e.tid)) byTid.set(e.tid, []);
    byTid.get(e.tid).push(e);
  }
  const exclusive = new Map();   // name → µs
  let spanUs = 0;
  for (const [, list] of byTid) {
    list.sort((a, b) => a.ts - b.ts);
    const stack = [];            // {ts, dur, childUs}
    const pop = (e) => exclusive.set(e.name, (exclusive.get(e.name) || 0) + Math.max(0, e.dur - e.childUs));
    spanUs = Math.max(spanUs, list[list.length - 1].ts + list[list.length - 1].dur - list[0].ts);
    for (const e of list) {
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.ts + top.dur >= e.ts + e.dur || (top.ts <= e.ts && e.ts + e.dur <= top.ts + top.dur)) break;
        stack.pop(); pop(top);
      }
      if (stack.length) stack[stack.length - 1].childUs += e.dur;
      stack.push({ ts: e.ts, dur: e.dur, childUs: 0, name: e.name });
    }
    while (stack.length) pop(stack.pop());
  }

  const buckets = new Map();
  let totalEx = 0;
  for (const [name, us] of exclusive) {
    const b = bucketOf(name);
    buckets.set(b, (buckets.get(b) || 0) + us);
    totalEx += us;
  }
  const ms = (us) => (us / 1000).toFixed(1);
  console.log(`\n## ${f.split('/').pop()}（互斥合计 ${ms(totalEx)}ms / 窗口 ${ms(spanUs)}ms，事件 ${evs.length}）\n`);
  console.log('### bucket（互斥时间，嵌套不双计）');
  for (const [b, us] of [...buckets.entries()].sort((a, b2) => b2[1] - a[1])) {
    console.log(`| ${b.padEnd(14)} | ${ms(us).padStart(9)}ms | ${totalEx ? (us / totalEx * 100).toFixed(1) : 0}% |`);
  }
  console.log('\n### TOP 15 事件名（互斥）');
  const sorted = [...exclusive.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [name, us] of sorted) {
    console.log(`| ${name.slice(0, 46).padEnd(46)} | ${ms(us).padStart(9)}ms | ${(us / totalEx * 100).toFixed(1)}% |`);
  }
}
