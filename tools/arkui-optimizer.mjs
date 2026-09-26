/*
 * arkui-optimizer v1（R75）：ets-loader 产物的静态/动态属性分裂
 *
 * 输入：extract.mjs 转出的 JS（ViewPU 协议形态）。变换：
 *   在所有 observeComponentCreation2 回调（签名含 isInitialRender 的箭头函数）体内，
 *   把【静态属性语句】包进 `if (isInitialRender) { … }`——重渲染时跳过，首渲染照常。
 *
 * 语句分类（只处理"组件属性调用"语句 `X.attr(args)`）：
 *   · attr ∈ {create, createWithLabel, pop}        → 永远不动（复用/出栈协议）
 *   · 参数在嵌套函数体外引用了 this（如 Text.create('n='+this.count)）→ 动态，不动
 *   · 其余（含 onClick(...) 这类"注册一次"的处理器——this 只在函数体内）→ 静态，守卫
 *
 * 保真边界（v1）：ForEach/If 控制流语句原样保留；不做跨语句分析；不做新运行时协议——
 *   生成物仍是 ViewPU 协议（R69 spike 证明上限，v1 先证明机械与保真）。
 *
 * 用法：extract.mjs --optimize ｜ 或 CLI：node tools/arkui-optimizer.mjs in.js out.js
 */
import fs from 'node:fs';

/** 该节点内（不含嵌套函数体）是否引用 this */
function refsThisOutsideFunctions(ts, node) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isFunctionExpression(n) || ts.isArrowFunction(n)) return; // 嵌套函数体内的 this 是另一个 this
    if (n.kind === ts.SyntaxKind.ThisKeyword) { found = true; return; }
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

const ALWAYS_KEEP = new Set(['create', 'createWithLabel', 'pop']);

function transformSource(ts, sf) {
  const visitor = (node) => {
    // 目标：observeComponentCreation2 回调（二参且第二参名为 isInitialRender）
    if (ts.isArrowFunction(node) && node.parameters.length >= 2 &&
        ts.isIdentifier(node.parameters[1].name) && node.parameters[1].name.text === 'isInitialRender') {
      const guardName = node.parameters[1].name.text;
      if (ts.isBlock(node.body)) {
        // 先深访 body：嵌套在 ForEach.create(...) 里的内层 observeComponentCreation2 回调
        // 也要被处理（updateArrowFunction 不会自动重访子树）
        const body = ts.visitEachChild(node.body, visitor, ts.nullTransformationContext);
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
          if (ac && !ALWAYS_KEEP.has(ac.attr) && !refsThisOutsideFunctions(ts, stmt)) {
            statics.push(stmt);                      // 静态：守卫（保序：连续静态合并进同一 if）
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
    }
    return ts.visitEachChild(node, visitor, ts.nullTransformationContext);
  };
  return ts.transform(sf, [(context) => (node) => ts.visitEachChild(node, visitor, context)]).transformed[0];
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
