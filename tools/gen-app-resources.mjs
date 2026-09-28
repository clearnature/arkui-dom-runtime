// 生成 runtime/src/generated-app-resources.js（R128：app.* 资源表——id/type/name + 值 + 媒体路径）
//   node tools/gen-app-resources.mjs            # 生成
//   node tools/gen-app-resources.mjs --check    # 只校验（漂移即非 0 退出）
// 源 = harmony-proj/entry/src/main/resources（element JSON 值 + media 文件）
//      + entry/build/.../ids_map/id_defined.json（编译器分配的 id ↔ type/name）
// ⚠️ 产物 fixture（fixtures/pages/*.ts）里的 Resource 字面量带【编译期展开的 id】——
//    重排资源后 id 会变：先重编 harmony-proj、重冻结受影响 fixture、再重跑本生成器。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RES = path.join(ROOT, 'harmony-proj/entry/src/main/resources/base');
const IDS = path.join(ROOT, 'harmony-proj/entry/build/default/intermediates/res/default/ids_map/id_defined.json');
const OUT = path.join(ROOT, 'runtime/src/generated-app-resources.js');

const element = {};
for (const t of ['string', 'color', 'float', 'integer']) {
  const f = path.join(RES, 'element', `${t}.json`);
  if (!fs.existsSync(f)) continue;
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  element[t] = Object.fromEntries((j[t] || []).map((e) => [e.name, e.value]));
}
const MEDIA_TYPES = new Set(['media']);
const media = {};
const mediaDir = path.join(RES, 'media');
for (const f of fs.readdirSync(mediaDir)) {
  if (/\.(png|jpg|jpeg|webp|gif|svg)$/i.test(f)) {
    media[f.replace(/\.[^.]+$/, '')] = `harmony-proj/entry/src/main/resources/base/media/${f}`;
  }
}
const ids = JSON.parse(fs.readFileSync(IDS, 'utf8')).record
  .filter((r) => element[r.type] !== undefined || MEDIA_TYPES.has(r.type))
  .map((r) => ({ id: parseInt(r.id, 16), type: r.type, name: r.name }));

const emit =
  `// 自动生成：node tools/gen-app-resources.mjs（勿手改）——R128 app.* 资源表\n` +
  `// 源 = harmony-proj 资源 + 编译器 ids_map；fixture 里的 Resource 字面量按 id 查此表\n` +
  `(function () {\n` +
  `  /** @type {any} */ (globalThis).__arkui_app_res = {\n` +
  `    byId: ${JSON.stringify(Object.fromEntries(ids.map((r) => [r.id, { type: r.type, name: r.name }])))},\n` +
  `    values: ${JSON.stringify(element)},\n` +
  `    media: ${JSON.stringify(media)},\n` +
  `  };\n` +
  `})();\n`;

if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== emit) {
    console.error('❌ generated-app-resources.js 与资源/ids_map 漂移——重跑 node tools/gen-app-resources.mjs');
    process.exit(1);
  }
  console.log('✅ generated-app-resources 与源一致');
} else {
  fs.writeFileSync(OUT, emit);
  console.log(`✅ 已生成 ${path.relative(ROOT, OUT)}（byId ${ids.length} 条 / media ${Object.keys(media).length} 个）`);
}
