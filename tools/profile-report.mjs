#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// cpuprofile 热点分析（R161 profiling 切片）——优化器 v3 的立项依据。
//
// 输入：electron/main.js ARKUI_PROFILE=1 产出的 V8 采样 profile（build/<页>.cpuprofile）。
// 口径：hitCount = 采样落在该函数栈顶的次数（self time）；总量=全部 hitCount 之和。
//       采样间隔 100µs → 1 hit ≈ 0.1ms。
// 输出：每文件一段——TOP 函数表（self %）+ 分类桶（engine 内核分片按函数名前缀
//       无法区分，桶按文件 URL：runtime 引擎 / generated-components / ohos-shims /
//       页面模块 / [GC]/[program]/[idle] 系统项）。
//
// 用法：node tools/profile-report.mjs build/perfbig.cpuprofile [more.cpuprofile ...]
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2);
if (!files.length) { console.error('用法: node tools/profile-report.mjs <x.cpuprofile> [...]'); process.exit(2); }

const bucketOf = (url) => {
  if (/generated-components\.js/.test(url)) return '组件声明面 generated-components';
  if (/ohos-shims\.js/.test(url)) return '平台垫片 ohos-shims';
  if (/arkui-dom-runtime\.js/.test(url)) return '引擎内核 runtime';
  if (/(module|app)\.js/.test(url)) return '页面模块 build/*';
  if (!url || url === '' || /^\[/.test(url)) return '宿主/匿名';
  return path.basename(url);
};

for (const f of files) {
  const p = JSON.parse(fs.readFileSync(f, 'utf8'));
  const total = p.nodes.reduce((a, n) => a + (n.hitCount || 0), 0);
  if (!total) { console.log(`\n## ${f}\n（零采样——页面没跑或 profiler 未启动）`); continue; }

  // ── 桶汇总（函数按 名字@URL 合并——同函数跨调用上下文是不同 node）──
  const buckets = new Map();
  const fnMap = new Map();
  for (const n of p.nodes) {
    const hits = n.hitCount || 0;
    if (!hits) continue;
    const cf = n.callFrame || {};
    const name = cf.functionName || '(匿名)';
    const url = cf.url || '';
    const b = /GC|garbage|program|idle|root|v8/.test(name) && !url ? name
      : bucketOf(url);
    buckets.set(b, (buckets.get(b) || 0) + hits);
    const key = `${name}@${url}`;
    const prev = fnMap.get(key) || { name, url: url ? url.split('/').pop() : '', hits: 0 };
    prev.hits += hits;
    fnMap.set(key, prev);
  }
  const fns = [...fnMap.values()].sort((a, b) => b.hits - a.hits);

  console.log(`\n## ${f.split('/').pop()}（总采样 ${total} ≈ ${(total * 0.1 / 1000).toFixed(2)}s CPU）\n`);
  console.log('### 分类桶（self time）');
  for (const [b, h] of [...buckets.entries()].sort((x, y) => y[1] - x[1])) {
    console.log(`| ${b.padEnd(28)} | ${h.toString().padStart(6)} | ${(h / total * 100).toFixed(1).padStart(5)}% |`);
  }
  console.log('\n### TOP 25 函数（self time）');
  for (const { name, url, hits } of fns.slice(0, 25)) {
    console.log(`| ${name.slice(0, 52).padEnd(52)} | ${url.slice(0, 26).padEnd(26)} | ${hits.toString().padStart(6)} | ${(hits / total * 100).toFixed(1).padStart(5)}% |`);
  }
}
