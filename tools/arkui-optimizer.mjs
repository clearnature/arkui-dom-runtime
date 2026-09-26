/*
 * arkui-optimizer v1.1（R75/R78）：ets-loader 产物的静态/动态属性分裂
 *
 * 输入：extract.mjs 转出的 JS（ViewPU 协议形态）。变换：
 *   在所有 observeComponentCreation2 回调（签名含 isInitialRender 的箭头函数）体内，
 *   把【静态属性语句】包进 `if (isInitialRender) { … }`——重渲染时跳过，首渲染照常。
 *
 * 语句分类（只处理"组件属性调用"语句 `X.attr(args)`）：
 *   · attr ∈ {create, createWithLabel, pop}        → 永远不动（复用/出栈协议）
 *   · 参数在嵌套函数体外引用了 this → 动态，不动
 *   · 参数在嵌套函数体外引用了作用域链上的任何参数名（如 itemGen 的 it/_item——
 *     v1.1 对抗自检修复：只查 this 会把 .fontSize(it.length) 这类闭包参数依赖
 *     误判成静态守卫）→ 动态，不动
 *   · 其余（含 onClick(...) 这类"注册一次"的处理器）→ 静态，守卫
 *
 * 保真边界（v1.1）：ForEach/If 控制流语句原样保留；不做跨语句分析；不做新运行时协议——
 *   生成物仍是 ViewPU 协议。
 *
 * 工具链坑：ets-loader 定制版 TS 的 ts.transform 要求 context 工厂式 transformer
 * （`(context) => (node) => …`），普通 visitor 直接传会炸 `transform2 is not a function`。
 *
 * 用法：extract.mjs --optimize ｜ 或 CLI：node tools/arkui-optimizer.mjs in.js out.js
 */
import fs from 'node:fs';

const ALWAYS_KEEP = new Set(['create', 'createWithLabel', 'pop']);

/** 该节点内（不含嵌套函数体）是否引用 this 或 inScope 中的名字 */
function refsDynamicName(ts, node, inScope) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isFunctionExpression(n) || ts.isArrowFunction(n)) return; // 嵌套函数体内的名字是另一层作用域
    if (n.kind === ts.SyntaxKind.ThisKeyword) { found = true; return; }
    if (ts.isIdentifier(n) && inScope.has(n.text)) { found = true; return; }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

/** 语句是否形如 `X.attr(...)` 且 X 是大写开头的组件标识符 */
function asAttrCall(ts, stmt) {
  if (!ts.isExpressionStatement(stmt)) return null;
  const e = stmt.expression;
  if (!ts.isCallExpression(e) || !ts.isPropertyAccessExpression(e.expression)) return null;
  const obj = e.expression.expression;
  const attr = e.expression.name.text;
  if (!ts.isIdentifier(obj)) return null;
  if (!/^[A-Z]/.test(obj.text)) return null;
  return { attr, node: stmt };
}

function transformSource(ts, sf) {
  const inScope = new Set();   // 作用域链上可见的参数名（跨箭头累积，进入时加/退出时删）

  const visitor = (node) => {
    let added = [];
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      for (const p of node.parameters) {
        if (ts.isIdentifier(p.name)) { inScope.add(p.name.text); added.push(p.name.text); }
      }
    }
    const result = classifyIfTarget(ts, inScope, visitor, node);
    for (const n of added) inScope.delete(n);
    return result;
  };
  return ts.transform(sf, [(context) => (node) => ts.visitEachChild(node, visitor, context)]).transformed[0];
}

/** 目标回调（二参且第二参名为 isInitialRender 的箭头）：分裂 body 语句 */
function classifyIfTarget(ts, inScope, visitor, node) {
  if (!(ts.isArrowFunction(node) && node.parameters.length >= 2 &&
        ts.isIdentifier(node.parameters[1].name) && node.parameters[1].name.text === 'isInitialRender' &&
        ts.isBlock(node.body))) {
    return ts.visitEachChild(node, visitor, ts.nullTransformationContext);
  }
  const guardName = node.parameters[1].name.text;
  // 先深访 body：嵌套在 ForEach.create(...) 里的内层 observeComponentCreation2 回调
  // 也要被处理（updateArrowFunction 不会自动重访子树）。深访时本箭头参数已在 inScope——
  // 内层语句若引用它们会被保守判动态（安全方向）。
  for (const p of node.parameters) {
    if (ts.isIdentifier(p.name)) inScope.add(p.name.text);
  }
  const body = ts.visitEachChild(node.body, visitor, ts.nullTransformationContext);
  for (const p of node.parameters) {
    if (ts.isIdentifier(p.name)) inScope.delete(p.name.text);
  }

  const kept = [];
  const statics = [];
  const flushStatics = () => {
    if (!statics.length) return;
    kept.push(ts.factory.createIfStatement(
      ts.factory.createIdentifier(guardName),
      ts.factory.createBlock(statics, true)
    ));
    statics.length = 0;
  };
  for (const stmt of body.statements) {
    const ac = asAttrCall(ts, stmt);
    if (ac && !ALWAYS_KEEP.has(ac.attr) && !refsDynamicName(ts, stmt, inScope)) {
      statics.push(stmt);                      // 静态：守卫（连续静态合并进同一 if 保序）
    } else {
      flushStatics();
      kept.push(stmt);
    }
  }
  flushStatics();
  return ts.factory.updateArrowFunction(
    node, node.modifiers, node.typeParameters, node.parameters,
    node.type, node.equalsGreaterThanToken,
    ts.factory.updateBlock(body, kept));
}

/** 优化一段 JS 文本，返回新文本 */
export function optimizeJs(source, ts) {
  const sf = ts.createSourceFile('opt.js', source, ts.ScriptTarget.ES2021, true, ts.ScriptKind.JS);
  const out = transformSource(ts, sf);
  const printer = ts.createPrinter({ removeComments: false });
  return printer.printFile(out);
}

// CLI：node tools/arkui-optimizer.mjs <in> <out>
if (process.argv[1] && process.argv[1].endsWith('arkui-optimizer.mjs') && process.argv.length >= 4) {
  const { createRequire } = await import('node:module');
  const _require = createRequire(import.meta.url);
  const tsPath = '/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools' +
    '/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/typescript';
  const ts = _require(tsPath);
  const out = optimizeJs(fs.readFileSync(process.argv[2], 'utf8'), ts);
  fs.writeFileSync(process.argv[3], out);
  console.log(`arkui-optimizer: ${process.argv[2]} -> ${process.argv[3]} (${out.length} B)`);
}
