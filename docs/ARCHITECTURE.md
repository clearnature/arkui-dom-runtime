# ArkUI DOM Runtime —— 架构

> 一句话：**不重写 ArkTS 编译器、不重写 ArkUI，只重写"渲染目标"**——把官方 `ets-loader` 的转换产物当作输入，实现它要求的运行时 API，输出 DOM。

本文是权威文档。数字来自 `node tools/stats.mjs`（`--json` 可机器可读），可用命令复现，不是估计值。

---

## 1. 问题定义与边界

ArmonyOS 应用的 UI 代码是 `.ets`（ArkTS）。官方工具链在 **Linux 上编译没问题**，但**跑不起来**，缺的是最后一环：

```
.ets  --ets-loader-->  .ts  --es2abc-->  .abc(字节码)  --ArkVM + ArkUI-->  屏幕
                                                          ^^^^^^^^^^^^^^^^
                                                          这一层华为只给了
                                                          Windows / macOS / 设备
```

Linux 上 `es2abc`（= `es2panda`）**完全可用**，`ark_aot_compiler` 也可用（需补两个库，见 `arkts-shim`）。真正缺的是**执行 `ViewPU` 那一侧**：

- `libarkui` / `RichPreviewer` 是闭源的，Linux 预览器的入口被一段 45 字节的桩代码挡住（已用 `objdump` 独立验证）
- ArkVM 有，但 ArkUI 的 native 实现没有 Linux 构建

**本项目的边界**：

| 在范围内 | 不在范围内 |
|---|---|
| 消费 `ets-loader` 的**产物**（文本 `.ts`） | 重新实现 `.ets` → `.ts` 的转换 |
| 实现产物要求的**运行时 API**（`ViewPU` 等） | 实现 ArkVM / `.abc` 解释器 |
| 把布局/状态/事件落到 **DOM + CSS** | 像素级复刻原生渲染（字体、光栅化） |
| 桌面（Electron）与浏览器两条落地路径 | 设备 / 模拟器（那是官方路径） |

**为什么不重写编译器**：`ets-loader` 就是 ArkTS 的**规范**。它是官方实现，包含所有语法糖的降级规则（`@State`→状态对象、`build()`→`observeComponentCreation2`、`struct`→`class extends ViewPU`）。从产物反推运行时，等价于"以官方编译器为规范做兼容实现"——比自行发明一套语义可靠得多，也保证**同一份 `.ets` 在设备和 Electron 上是同一套语义**。

---

## 2. 全局分层

```
┌──────────────────────────────────────────────────────────────────────────┐
│ L0  应用源码           *.ets  /  *.ts   (开发者写的东西，不改)              │
│     @Entry @Component struct / @State @Prop @Link @Provide @Consume @Watch│
└───────────────────────────────┬──────────────────────────────────────────┘
                                │  devecocli build  (官方工具，Linux 可用)
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ L1  ets-loader        .ets ──────────────► .ts                          │
│     产物落在 hvigor 缓存:                                                 │
│       entry/build/default/cache/default/default@CompileArkTS/            │
│         esmodule/debug/entry/src/main/ets/pages/<Page>.ts                │
│     ★ 这就是本项目的"规范"：运行时要实现的 API 全部由此定义                 │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │  node tools/extract.mjs  (transpileModule 去类型)
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ L2  可执行 JS          build/*.js                                        │
│     无 import/export 的页面 → 经典脚本（靠全局名）                          │
│     含 @ohos: import 的模块 → CommonJS + __arkui_dom_defineCommonJS(id,…)  │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │  <script src="runtime/*.js">  或  requireModule(id)
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ L3  运行时（本项目）                                                      │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ runtime/arkui-dom-runtime.js          (47.7 KB)  核心              │  │
│  │   ├ 状态管理     4 个 Observed/Synched 类 + @Watch 钩子             │  │
│  │   ├ elmtId 依赖   recordDep / markDependentsDirty / flush（微任务）  │  │
│  │   ├ ViewPU        组件栈、If/ForEach、子视图挂载、@Provide/@Consume  │  │
│  │   ├ 组件注册表    ensureComponent → Proxy（未实现属性不炸，落 data-*） │  │
│  │   ├ 布局          alignRules 六键 / 文本截断 / Stack 叠放 / Scroller  │  │
│  │   ├ LazyForEach   虚拟滚动（窗口化 + 上下 spacer）                   │  │
│  │   └ 路由/页面栈   loadRoute / navigateTo / navigateBack             │  │
│  ├────────────────────────────────────────────────────────────────────┤  │
│  │ runtime/generated-components.js       (57.6 KB)  149 个组件骨架      │  │
│  │   由 tools/gen-components.mjs 从 ets-loader 的 149 个组件 JSON 生成  │  │
│  ├────────────────────────────────────────────────────────────────────┤  │
│  │ runtime/ohos-shims.js                 (23.1 KB)  平台别名层 ④        │  │
│  │   10 个 @ohos:* 模块 + 持久化三级后端                                │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │  DOM / CSS
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ L4  宿主                                                                  │
│   浏览器  <div> 树 + localStorage（兜底后端）                              │
│   Electron 同一份 JS，额外通过 contextBridge 拿到真 Node fs → 真落盘       │
└──────────────────────────────────────────────────────────────────────────┘
```

**关键性质**：L1 之上是官方的，L3 之下是本项目的。**换宿主只影响 L4**——`runtime/` 三个文件在浏览器和 Electron 里**逐字节相同**（已由两套 runner 交叉验证）。

---

## 3. 转换产物的契约（逆向结果）

这一节是项目最重要的资产：运行时必须提供的 API 清单，逐条对应产物里的真实调用。

### 3.1 `struct` → `class extends ViewPU`

输入：

```ts
@Entry @Component
struct ProvideDemo {
  @Provide('theme') theme: string = 'dark';
  @Consume('theme') themeIn: string;          // 在子组件里
  @State watched: number = 0;
  @Watch('onWatchedChange') @State log: string = '';
  build() { Text.create('child:' + this.theme); Text.fontSize(12); Text.pop(); }
}
```

产物（`fixtures/pages/Provide.ts`，节选，逐字）：

```ts
if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface ProvideDemo_Params { theme?: string; watched?: number; log?: string; }

class ProvideDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") { this.paramsGenerator_ = paramsLambda; }
        this.__theme = new ObservedPropertySimplePU('dark', this, "theme");
        this.addProvidedVar("theme", this.__theme, false);
        this.__watched = new ObservedPropertySimplePU(0, this, "watched");
        this.__log     = new ObservedPropertySimplePU('', this, "log");
        this.setInitiallyProvidedValue(params);
        this.declareWatch("watched", this.onWatchedChange);
        this.finalizeConstruction();
    }
    updateStateVars(params: ProvideDemo_Params) { … }
    purgeVariableDependenciesOnElmtId(rmElmtId) { … }
    aboutToBeDeleted() { …; SubscriberManager.Get().delete(this.id__()); }
    private __theme: ObservedPropertyAbstractPU<string>;
    get theme() { return this.__theme.get(); }
    set theme(newValue: string) { this.__theme.set(newValue); }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('child:' + this.theme);
            Text.fontSize(12);
        }, Text);
        Text.pop();
    }
    rerender() { this.updateDirtyElements(); }
}
```

**运行时必须实现**（`arkui-dom-runtime.js`）：

| 产物调用 | 运行时实现 | 位置 |
|---|---|---|
| `class X extends ViewPU` + `super(parent, __localStorage, elmtId, extraInfo)` | `class ViewPU` | L183 |
| `new ObservedPropertySimplePU(init, view, name)` | 状态类，带 `get/set/purgeDependencyOnElmtId` | L65 |
| `new ObservedPropertyObjectPU` / `SynchedPropertySimple*PU` | @State 对象 / @Prop / @Link | L84 / L103 / L122 |
| `addProvidedVar(name, prop, allowOverride)` | `@Provide` 注册到 `__providedVars` | L218 |
| `initializeConsume('name', 'prop')` | 沿 `__parent` 链上溯取**同一个属性实例** | L229 |
| `reInitializeConsume__Internal` | `@Reusable` 复用时的重绑定 | L238 |
| `declareWatch('prop', cb)` | 把回调挂到属性实例的 `watch` | L246 |
| `new SynchedPropertyNesedObjectPU(src, this, "item")` | **@ObjectLink**：订阅 `@Observed` 实例（见 §3.5） | L217 |
| `observeComponentCreation2(fn, Class)` | 分配 elmtId、记录 updateFunc、执行、**不动组件栈** | L202 |
| `ifElseBranchUpdateFunction(branchId, fn)` | 同一 elmtId 下按 branchId 换子树 | L251 |
| `forEachUpdateFunction(elmtId, arr, itemGen, keyGen)` | 数组变化才重建（键级 diff 待优化） | L276 |
| `ViewPU.create(childView)` | 子视图挂到 `display:contents` 容器 | L293 |
| `updateStateVarsOfChildByElmtId` | 父重渲染时推参给子 | L216 |
| `finalizeConstruction` / `purgeVariableDependenciesOnElmtId` / `aboutToBeDeletedInternal` | 直接建在 `ViewPU.prototype` 上的空实现（产物自己会 `Reflect.set`） | L190-194 |

> ⚠️ `observeComponentCreation2` **不 push 组件栈**：产物在执行完 `updateFunc` 后会紧跟 `Class.pop()`，首渲染由 `pop()` 收尾。如果这里也 push，栈会双倍增长——这是最早踩的坑之一。

### 3.2 内置组件：`Class.create(...)` / 属性 setter / `Class.pop()`

产物形式固定：

```ts
Text.create('hello');       // 或 Text.create('hello').fontSize(20) 的展开形式
Text.fontSize(20);
Text.fontColor('#333');
Column.create({ space: 8 });
Column.pop();
```

运行时契约（`ensureComponent`，L569）：

1. **动态实例化**：用 `Proxy` 包一个 `function C(){}`，`C.componentName = name`
   - `get(key)` 命中 `create` / `createWith*` / 任意 `/^create/` / `pop` → 工厂方法
   - 其余任意 key → **属性 setter**，落到 `applyAttr(ViewStackProcessor.top(), key, v)`
2. **工厂名不统一**：官方既有 `create`，也有 `createWithLabel`、`createWithIcon`、`createWithChild`（`Button`）。用 `FACTORIES` 显式登记 + `/^create/` 兜底
3. **`create` 的三种情况**：
   - `rec.node` 已存在且 `__arkuiComp === name` → 复用节点（重渲染路径）
   - `rec.node` 存在但组件不同 → 复用容器（`If`/`ForEach` 的容器节点）
   - 否则 → `domFactory(args)` 新建 → 绑 `scroller` → `mountNode`
   - 最后 `ViewStackProcessor.push(node)`
4. **`pop()` → `ViewStackProcessor.pop()`**
5. **`ListItem` / `GridItem` 特例**：产物是 `ListItem.create(deepFn, true)`，首渲染要展开子树（`deepRender`）**但不能递归再进**——用 `deepRendering` Set 做重入保护

**为什么用 Proxy 而不是穷举**：149 个组件 × 平均 9 个属性 ≈ 1200 个 setter。手写不可能。Proxy 让**任意未实现属性也不崩溃**，走 `applyAttr` 的兜底：

```js
try { node.dataset[prop] = JSON.stringify(value); }
catch { node.dataset[prop] = String(value); }
```

这条兜底是**架构级的容错**：未实现的语义退化为"信息不丢（落 `data-*`）+ 不炸"，可被测试断言、可被后续按需升级为真实布局。

### 3.3 已实现的属性映射

`applyAttr`（L534）按顺序分派，**顺序即语义优先级**：

| 类别 | 处理 | 例子 |
|---|---|---|
| 函数值 | `addEventListener(prop.replace(/^on/,'').toLowerCase(), fn)` | `onClick` → `click` |
| `id` | `node.id` | 测试靠它定位 |
| **语义分歧的**（必须抢在 CSS 同名前） | 专用处理函数 | `alignRules`、`maxLines`、`textOverflow`、`alignContent` |
| 尺寸类 `cssPropSize` | `toCssSize`（number → `px`）| `fontSize/width/height/padding/margin/borderRadius` |
| 原样透传 `cssPropRaw` | `String(resolveResource(v))` | `fontWeight/opacity/zIndex/flexGrow/aspectRatio` |
| 枚举类 `cssPropEnum` | 枚举值本身即 CSS 值 | `justifyContent/alignItems/textAlign/position/columnsTemplate` |
| **兜底** | `data-*` | 其余全部 |

> ⚠️ `alignContent` 的 ArkUI 语义是"**叠放子项的对齐**"（即 `Stack({alignContent})`），与 CSS 的 `align-content`（多行内容分布）**完全不是一回事**。所以它必须在 `cssPropEnum` **之前**被拦掉。同理 `alignRules`、`maxLines`、`textOverflow`。
>
> 另外 `Stack` 的 `alignContent` 是 **create 选项**不是 setter，必须走 `applyCreateArgs`（L364），不是 `applyAttr`。

### 3.4 状态管理 v2 的契约（与 v1 机制完全不同）

v1 和 v2 **不是"版本号不同"，是两套机制**：

| | v1（`@Component`） | v2（`@ComponentV2`） |
|---|---|---|
| 基类 | `class X extends ViewPU` | `class X extends ViewV2` |
| `super(...)` | `super(parent, __localStorage, elmtId, extraInfo)` | `super(parent, elmtId, extraInfo)` ← **少一个参数** |
| 状态承载 | **包装对象**：`this.__theme = new ObservedPropertySimplePU('dark', this, "theme")` | **裸字段**：`this.count = 0` |
| 观测来源 | 状态类的 `get/set` | **装饰器在原型上装的访问器** |
| `@Provide` | `this.addProvidedVar("theme", this.__theme, false)` | `@Provider('v2theme') theme` |
| `@Consume` | `this.__theme = this.initializeConsume('theme', "theme")` | `@Consumer('v2theme') theme` + `this.resetConsumer(...)` |
| `@Watch` | `this.declareWatch("watched", this.onWatchedChange)` | `@Monitor('count')` 放在**方法**上 |
| 判脏 | `propDeps` 以状态对象为键 | `propDeps` 以**每实例每字段的单元**为键 |

所以 **v2 不是"再加几个状态类"，而是要实现一整个装饰器层**。

#### 产物的装饰器调用形态（`__decorate` 助手的形状决定）

ts 4.9 编译出的 `__decorate(decorators, target, key, desc)` 会按实参个数分派：

```js
// 属性：4 个实参 → 装饰器收到 (proto, "label", undefined)
__decorate([Param], V2Child.prototype, "label", void 0);

// 方法/访问器：desc === null → 助手先取真实描述符，装饰器收到 (proto, key, desc)
__decorate([Monitor('inner')], V2Child.prototype, "onInnerChange", null);
__decorate([Computed], V2Child.prototype, "doubled", null);   // desc = {get, set, ...}

// 类：只有 2 个实参 → 装饰器收到 (Cls)，且【必须返回该类】
TaskItem = __decorate([ObservedV2], TaskItem);
```

对应运行时的 11 个装饰器（`arkui-dom-runtime.js`，状态管理 v2 段）：

| 装饰器 | 形态 | 实现要点 |
|---|---|---|
| `Param` / `Local` / `Once` | 属性 | 在原型上装 getter/setter，值存 `this['__v2slot_' + key]` |
| `Event` | 属性 | 同上，但**不记依赖、不发通知**（纯回调槽） |
| `Trace` | 属性 | 与 `Local` 同一套访问器；用在 `@ObservedV2` 类上做深度观测 |
| `Provider(name)` | 工厂 → 属性 | 装访问器 + 登记 `name`，由 `ViewV2.finalizeConstruction` 注册到 `__providedVars` |
| `Consumer(name)` | 工厂 → 属性 | 装访问器 + 登记；`finalizeConstruction` 里沿 `__parent` 绑定到提供者的**字段** |
| `Monitor(...keys)` | 工厂 → 方法 | 登记 `key → 方法名`；字段变更时回调 |
| `Computed` | 访问器 | **不缓存**：直接返回原描述符（理由见下） |
| `ObservedV2` | 类 | `v2Info(target.prototype)` 后**返回 target** |

#### `ViewV2` 的方法契约

产物会调这些名字（全部实测得到）：

```
initParam(name, v)          resetParam(name, v)      updateParam(name, v)
resetConsumer(name, def)    resetComputed(name)      resetMonitorsOnReuse()
resetStateVarsOnReuse(p)    finalizeConstruction()   observeComponentCreation2(...)
updateStateVarsOfChildByElmtId(...)                  static create(childView)
```

`ViewV2` **继承** `ViewPU` 并补 `super(parent, undefined, elmtId, extraInfo)`——组件栈、elmtId 依赖追踪、批量重渲染、子视图挂载全部复用。这是 v2 能用 ~200 行实现的原因。

#### 两个刻意的设计决定

**① `@Computed` 不缓存。** getter 体求值时正处在目标 elmtId 的渲染上下文里（`currentNodeElmtId`），它读到的每个字段都会**直接把依赖记到那个 elmtId 上**——"传递依赖"因此天然成立，也就不需要缓存与失效逻辑。代价是每次重渲染都重算；用性能换了"不可能算错"。`resetComputed(name)` 因此是空实现。

**② 装饰器不挂 global。** `Event` 既是 v2 装饰器名，**也是浏览器全局**——而 runtime 自己（`Scroller` 里的 `new Event('scroll')`）和 `test/lazy.html` 都在用 `new Event(...)`。挂到 global 会把滚动事件直接打断。
所以运行时只导出装饰器表 `__arkui_dom_decorators`，由 `tools/extract.mjs` 在产物里生成**作用域内**的绑定前奏：

```js
// build/v2.js 的开头（自动生成）
(function () {
const { ViewV2, Param, Local, Once, Event, Monitor, Computed, Provider, Consumer, ObservedV2, Trace } = (globalThis.__arkui_dom_decorators || {});
if (typeof ViewV2 === 'undefined') { throw new Error('[arkui-dom] 需要先加载 runtime/arkui-dom-runtime.js（提供 __arkui_dom_decorators）'); }
...
})();
```

门禁用 `__decorate(` 是否出现在**编译产物**里——它只在源码用了装饰器时才被 ts 发出，所以 11 个 v1 页面的产物（实测 `__decorate` 出现 0 次）完全不受影响；拿到前奏的页面才多包一层 IIFE，让 `const` 不外泄。

#### `IMonitor` 的形状以 SDK 的 `.d.ts` 为准

`@Monitor` 回调的入参**不是**随手设计的对象。权威定义在
`<CLT>/sdk/default/openharmony/ets/build-tools/ets-loader/declarations/common.d.ts`：

```ts
declare interface IMonitor {
  dirty: Array<string>;                                    // 变更的路径（键名）
  value<T>(path?: string): IMonitorValue<T> | undefined;    // 不传 path 时返回 dirty[0] 的值对
}
declare interface IMonitorValue<T> { before: T; now: T; path: string; }
```

> 我最初按 `{dirty: [{path, value, before, kind}]}` 实现，被 ArkTS 编译器当场判错
> （`Property 'value' does not exist on type 'string'`）。**这类形状问题不该靠猜——SDK 里有 `.d.ts`，去读它。**
>
> 已知简化：一次赋值只产生一条 `dirty`（ArkUI 会把同一批变更合并），且 `path` 是字段名而非 `items.0.name` 这样的点分路径。

#### `@Once` 必须同时是 `@Param`

由 ArkTS 编译器强制（`When a variable decorated with '@Once', it must also be decorated with '@Param'`）。
写成 `@Once mode` 会**构建失败**。正确写法：`@Once @Param mode: string`。

### 3.5 V1 深度观测的契约（`@Observed` / `@ObjectLink`）

V1 与 V2 的深度观测模型**不同**，这一点容易搞混：

| | V1（`@Observed`） | V2（`@ObservedV2` + `@Trace`） |
|---|---|---|
| 装饰粒度 | **整个类**（字段上什么都不写） | 类 + **逐字段** `@Trace` |
| 观测范围 | 该类的**所有自身字段** | **只有**标了 `@Trace` 的字段 |
| 产物里的形态 | `Item = __decorate([Observed], Item);` | `__decorate([Trace], Item.prototype, "name", void 0)` |

**产物里没有字段名可用**（V1 不在字段上放装饰器）→ 装不了原型访问器 → **只能用 `Proxy` 拦 `set`**。
（ArkUI 真机也是这个做法：`ObservedObject.createNew` 返回 Proxy。）

订阅侧的产物形态（实测）：

```js
// @ObjectLink item: Item;  编译成：
this.__item = new SynchedPropertyNesedObjectPU(params.item, this, "item");
//                                ^^^^^^ 官方拼写错误（应为 Nested）——不能"顺手改对"，
//                                       产物里写的就是这个名字，改了直接 ReferenceError
this.__item.set(params.item);          // setInitiallyProvidedValue / updateStateVars 都调
this.__item.purgeDependencyOnElmtId(elmtId);
this.__item.aboutToBeDeleted();
```

> **产物不会自己调 subscribe。** 全文搜 `subscribe` / `ObservedObject` / `addSubscriber` 都是 0 次
> ——订阅必须由运行时在构造 `SynchedPropertyNesedObjectPU` 时隐式完成。

**运行时的实现路径**：复用已有的 `propDeps` 依赖机制，但依赖键从"状态对象"换成"**对象实例的通知单元**"：

```
Observed(Base)  →  返回 class extends Base，构造函数返回 makeObservedProxy(this)
makeObservedProxy(target)
  ├ cell = {...}                       ← 通知单元
  ├ Proxy set 陷阱：值真变了 → markDependentsDirty(cell)
  └ observedCells.set(proxy, cell)     ← WeakMap，供订阅时按对象取单元
SynchedPropertyNesedObjectPU.get()   → recordDep(cell) ; return source
```

于是 `items[0].name = 'renamed'` ⇒ Proxy 的 `set` ⇒ `markDependentsDirty` ⇒
读过该对象的 elmtId 全部重渲染，**数组长度完全没变**。

**观测边界（有负向断言守着）**：

```
@Observed class Item { name: string; child: Meta }   // Meta 不是 @Observed
item.name = 'x'          → 通知 ✅
item.child = new Meta()  → 通知 ✅（这是 Item 的字段写入）
item.child.label = 'x'   → 不通知 ✗（Meta 内部，未观测）
```
最后一条不是 bug，是与真机一致的语义。它同样是**不静默**的：`@ObjectLink` 绑到非 `@Observed`
对象上时，`SynchedPropertyNesedObjectPU.set` 会往 `layoutWarnings` 里写一条明确说明。

---

## 4. 核心机制

### 4.1 elmtId 依赖追踪 + 微任务批量重渲染

产物每次 `observeComponentCreation2` 分配一个自增 `elmtId`。**依赖关系在数据被 `get()` 时建立**：

```js
// 状态类的 get()
get() {
  recordDep(this);            // 把 __prop 记到 currentNodeElmtId 头上
  return this.__value;
}
```

- `currentNodeElmtId` 在 `observeComponentCreation2` 内部被临时设成当前 elmtId（**执行完立刻还原**）
- `set(v)` → 值变则 `markDependentsDirty(this)` → 该属性的所有依赖者 `markDirty(elmtId)` → `scheduleFlush()`
- `flush()` 遍历脏集合，逐个 `rerenderElmt(elmtId)`：重跑它在 ≥2 次渲染时的 `updateFunc(elmtId, false)`
- `purgeDetachedRecords()` 清掉已脱离 DOM 的 elmtId 记录（防止 `If`/`ForEach` 换分支后泄漏）

**为什么用微任务而不是 `requestAnimationFrame`**：headless Chrome 里 rAF 节流**不确定**——`lazy` 单独跑能过、`run.sh all` 里就挂。改成 `setTimeout(0)` 合并 + `scrollToIndex` 场景同步 `flush()`，测试从"等固定 tick"改成"轮询"。**确定性优先于贴合浏览器渲染节奏**。

### 4.2 状态类矩阵

| ArkTS 装饰器 | 用到的类 | 语义 |
|---|---|---|
| `@State`（简单值） | `ObservedPropertySimplePU` | 值比较，自己就是源 |
| `@State`（对象/数组） | `ObservedPropertyObjectPU` | 同上，但不深比较 |
| `@Prop` | `SynchedPropertySimpleOneWayPU` | 父→子单向同步 |
| `@Link` | `SynchedPropertySimpleTwoWayPU` | 双向；`set` 回写父 |
| `@Provide` / `@Consume` | 复用 `ObservedPropertySimplePU` + `ViewPU.__providedVars` | **不是复制值，是共享实例** |
| `@Watch` | 属性实例上的 `watch` 回调数组 | `set` 成功后触发 |

> `@Consume` 的关键实现是**返回提供者的属性实例本身**（`initializeConsume` → `_findProvided` 沿 `__parent` 上溯）。这样依赖追踪**天然生效**：子组件 `get()` 时记录的是自己的 elmtId，但属性是同一个对象，父改它也脏。找不到祖先时退化为本地占位属性并记 `layoutWarnings`，**不抛异常**——一个页面里的装饰器误用不该让整页白屏。

### 4.3 v2 的观测：原型访问器 + 每实例每字段的依赖单元

v1 的依赖键是**状态对象**（每个实例每个字段一个 `ObservedPropertySimplePU`）。v2 没有状态对象，所以：

```
v2Cell(inst, key)  →  一个 {__v2: true, __name: key} 单元，存在 v2InstCells: WeakMap<inst, Map<key, cell>>
```

- 装在哪：`Object.defineProperty(proto, key, {get, set})`，值存实例上的 `this['__v2slot_' + key]`
- `get()`：`recordDep(v2Cell(this, key))` → 复用 v1 的 `propDeps` / `markDependentsDirty` / `flush` **全套**
- `set(v)`：写槽 → `markDependentsDirty(cell)` → 值真变则 `fireV2Monitors`
- 粒度选**实例 × 字段**而不是原型 × 字段：后者会让同类的多个实例互相触发多余重渲染（正确但有性能与可预测性代价）

**为什么 `@Trace` 是选择性的**（有测试断言这一点）：

```
@ObservedV2 class TaskItem { @Trace name: string;  id: number; }
item.name = 'x'   → 装了访问器 → 记过依赖的 elmtId 变脏 → 重渲染 ✅
item.id = 99      → 没装访问器 → 无人变脏 → 不重渲染 ✅（不是"漏了"，是设计如此）
```

**`@Provider`/`@Consumer` 的绑定时机**：产物在普通构造路径里**根本不调** `resetConsumer`（只在 `resetStateVarsOnReuse` 里调）。所以绑定必须由运行时主动做，位置就在 `ViewV2.finalizeConstruction()`——产物在每个子类构造函数末尾调它，此刻祖先实例已存在、本实例字段也已赋值。**这个时机是实测出来的，不是设计出来的。**

注册到 `__providedVars` 的对象同时提供 `get`/`set`，所以 **v1 的 `@Consume` 和 v2 的 `@Consumer` 可以互相解析**（v1 的 `initializeConsume` 期望拿到带 `get/set` 的 prop 对象）。

### 4.4 布局：`alignRules` 六键语义

ArkUI 的 `RelativeContainer` 用 6 个键，**分两组**（极易记错）：

```
水平：left（左边缘） / middle（水平中心） / right（右边缘）
垂直：top（上边缘）  / center（垂直中心） / bottom（下边缘）
```

```js
const ALIGN_FRAC = { start: 0, top: 0, center: 0.5, end: 1, bottom: 1 };
const isStart = (a) => a === 'start' || a === 'top';
const isEnd   = (a) => a === 'end'   || a === 'bottom';
```

- 锚点可以是容器（`{ anchor: '__container__', align: HorizontalAlign.Start }`）或**兄弟节点**（`{ anchor: 'otherBtn', align: ... }`）
- 实现方式：绝对定位 + 按容器/兄弟的 `offsetLeft/offsetWidth` 算 `left/top`
- 容器需要 `position: relative`，否则 `offsetTop` 基准错（踩过：`scrollToIndex` 因此偏 100px）
- 只支持**一层**锚链，无约束求解器、无 `Guideline`、无 `bias`

### 4.5 `LazyForEach` 虚拟滚动

产物：

```ts
LazyForEach.create("1", this, this.source, itemGen, keyGen);
LazyForEach.pop();
```

实现要点（`createLazyForEach`，L718）：

- holder：`display:flex; flex-direction:column`，**继承父容器的 `gap`**
- 窗口：`[floor(scrollTop / estItemH) - overscan, + viewport/itemH + 2*overscan]`
- 上下各一个 spacer 维持总高度（滚动条长度正确）
- `setTimeout(0)` 合并（不是 rAF，理由见 4.1）
- `scrollToIndex` 到未渲染目标：先用 `lazyMeta` 估算 → `meta.flush()` **同步**补齐，然后才滚动
- 实测：**1000 项 → 11 个真实 DOM 节点**

### 4.6 平台层：`@ohos:*` 别名层 + CommonJS 装载

产物里的 `import x from "@ohos:xxx"` 经 `--cjs` 转译后是 `require("@ohos:xxx").default`。

- `defineOhosModule(name, impl)` 同时接受 `@ohos:x` 与 `x` 两种写法
- `ohosRequire(spec)` 返回 `{ default, ...impl }` 以兼容 TS 的 default interop
- `defineCommonJS(id, factory)` / `requireModule(id)`：**避免 `fetch` + `eval`**（`file://` 与 CSP 会拦），产物直接用 `<script>` 注册

**已实现 10 个模块**：

```
hilog  router  window  net.http
data.preferences  file.fs
app.ability.UIAbility  app.ability.Want
app.ability.AbilityConstant  app.ability.ConfigurationConstant
```

`net.http` 是**真 fetch**；`file.fs` 是**真落盘**（见下）。

### 4.7 持久化：三级后端，按优先级降级

```
① Node 真 fs      Electron: preload.js 经 contextBridge 暴露 __arkui_dom_nodeFs
                  → 写的是磁盘上的真文件
② OPFS            浏览器: navigator.storage.getDirectory()
                  → headless Chrome 里会挂起，默认不用
③ localStorage    兜底: 单键 'arkui_vfs_v1' 存整个 VFS 快照
```

- 强制选择：`global.__arkui_dom_force_backend = 'opfs' | ...`、`__arkui_dom_enable_opfs = true`
- OPFS 请求失败会 `switchToLocalStorage(reason)` 并**记录原因**，不静默
- `file.fs` 是同步 API（`openSync/writeSync/readSync/closeSync`），`fd` 从 3 开始自增，`handle` 表在内存里但**内容在盘上**
- `data.preferences` 落在 `/vfs/files/pref_<name>.json`

> **为什么要两级验证**：浏览器 `localStorage` 是"看起来持久化"。用户明确要求"**不能存内存，断电就丢**"。所以 Electron 侧做**三阶段**验证：① 页面内断言写入成功 → ② 跨进程重新加载后再读 → ③ **shell 层面直接检查磁盘文件内容**。第 ③ 步是唯一有说服力的证据。

### 4.8 页面栈与导航

- `pageStack` 存 `{ path, view }`——**存 view 是为了保留页面实例**（状态不丢）
- `navigateTo`：push 新页
- `navigateBack`：pop 当前**丢弃**，上一页**复用同一个 view 实例** → 状态自然保留
- 对外只暴露 `__arkui_dom_pageStack` 为**路径数组**（内部结构不外泄）
- `router` 模块的参数存在 `paramsByUrl: Map<url, params>`，`getParams()` 读回

---

## 5. 架构不变量

改动时必须保持：

1. **`runtime/` 三个文件与宿主无关**。不得出现 `require('fs')`、`electron`、`process` 之类的直接依赖——宿主能力一律走 `global.__arkui_dom_*` 注入点。
2. **手写实现优先于生成骨架**。`registerGeneratedComponents()` 里 `if (components[name]) continue` 是硬约束：补一个组件的正确做法是**手写**，而不是改生成器输出。
3. **未实现的语义必须"不炸 + 信息不丢"**。任何新组件/属性在未实现时落 `data-*`，绝不 `throw`。
4. **不得改写 `ets-loader` 的产物**。产物是规范。要适配就改运行时。
5. **`fixtures/` 里的 `.ts` 是冻结的**。改了它，测试就不再证明"官方产物能跑"。
6. **测试必须真断言，不能 grep 文本**。`grep 'ALL PASS'` 曾匹配到 `<script>` 源码里的字符串常量而永远通过（踩过）。
7. **重渲染路径必须确定性**。合并调度用 `setTimeout(0)`，关键路径允许同步 `flush()`。不用 rAF。
8. **每一步都要有可复现的验收命令**。文档里的数字必须能由 `tools/stats.mjs` 复现。
9. **装饰器不挂 global**，一律走 `__arkui_dom_decorators` + 抽取时生成的作用域内绑定。理由：`Event` 与浏览器全局同名（见 §3.4）。
10. **形状以官方声明为准，不靠猜**。`IMonitor`/`IMonitorValue` 这类接口，权威定义在 SDK 的 `.d.ts` 里；组件工厂名、方法契约以 `ets-loader` 的产物为准。
11. **v2 的表现必须可自省**。测试除了断言渲染结果，还应断言"装饰器确实在原型上装了访问器"（`__arkui_dom_v2Introspect()`）——否则"渲染碰巧对了"和"机制正确"分不开。
12. **装饰器绑定必须响亮失败**。TS 的 `__decorate` 助手对 **falsy 装饰器是静默跳过**的：
    `__decorate([undefined], Item)` 不报错、原样返回类。所以 `extract.mjs` 生成的前奏里有一道
    守卫，逐个检查绑定到的名字是不是函数，不是就 `throw`。**加新装饰器时，必须同时改两处**
    （运行时的 `decorators` 表 + `extract.mjs` 的 `DECORATOR_NAMES`），否则会静默失效（见 §3.4）。
13. **V1 深度观测的边界要与真机一致**，不要"顺手扩大"：`@Observed` 只观测该类的自身字段，
    嵌套的非 `@Observed` 对象内部变更**不应**触发重渲染。这条有负向断言守着；
    遇到绑定失败要记 `layoutWarnings`，不静默。

---

## 6. 覆盖范围（可复现的数字）

`node tools/stats.mjs` 的实测输出：

```
== 组件库 ==
  ets-loader 注册名    149
  手写实现（真布局语义）8：Text Button Column Row Stack List ListItem RelativeContainer
  控制流宏（非组件）    3：If ForEach LazyForEach
  骨架·有 DOM 画像     56（容器 26 / 叶子 30）
  骨架·仅 data-*       85
  ⇒ 可建出的组件名      149 / 149
  原生输入类控件       6
  属性元数据总数       1211（平均 8.1／组件，最多 TextInput=70）

== 运行时 API ==
  global 导出        50 个
  状态类            ObservedPropertySimplePU ObservedPropertyObjectPU SynchedPropertySimpleOneWayPU SynchedPropertySimpleTwoWayPU SynchedPropertyNesedObjectPU
  内置组件          Text Button Column Row Stack List ListItem If ForEach LazyForEach RelativeContainer
  内部钩子 __arkui_dom_*  18 个

== 状态管理 ==
  v1  状态类        5 个（包装对象模型）
  v1  深度观测      @Observed 已实现（Proxy 拦截字段写入） + @ObjectLink 已实现（SynchedPropertyNesedObjectPU，官方拼写如此）
  v2  基类          ViewV2 已实现（extends ViewPU）
  v2  装饰器        11 个：ViewV2 Param Local Once Event Monitor Computed Provider Consumer ObservedV2 Trace
  注入方式          作用域内绑定（__arkui_dom_decorators），不挂 global —— 见 ARCHITECTURE.md §3.4
  装饰器表合计      12 个（含 v1 的 Observed）

== 平台模块（@ohos:*）==
  10 个：app.ability.AbilityConstant app.ability.ConfigurationConstant app.ability.UIAbility app.ability.Want data.preferences file.fs hilog net.http router window

== 用例矩阵 ==
  浏览器 run.sh     15 个：index rich leak layout widgets measure lazy provide v2 observe async ability router netfile persist
  Electron          14 个：netfile layout rich index leak ability router widgets measure lazy provide async v2 observe
  测试页            15 个
  fixtures 转换产物  13 个：AsyncIO Detail Home Index Layout Lazy Measure NetFile Observe Provide Rich V2 Widgets

== 体积（源码，不含产物/Electron 运行时）==
  runtime          142.7 KB
  test             68.8 KB
  tools            33.2 KB
  electron(src)    14.7 KB
  docs             93.6 KB
  fixtures         80.5 KB

== 逐文件（文档"文件职责"表的来源）==
  runtime/arkui-dom-runtime.js      65444 B  63.9 KB
  runtime/generated-components.js   57617 B  56.3 KB
  runtime/ohos-shims.js             23066 B  22.5 KB
  tools/extract.mjs                  6457 B  6.3 KB
  tools/gen-components.mjs           7775 B  7.6 KB
  tools/serve.py                     2559 B  2.5 KB
  tools/stats.mjs                    9295 B  9.1 KB
  tools/preflight.mjs                5108 B  5.0 KB
  tools/check-all.sh                 2792 B  2.7 KB
  run.sh                             9225 B  9.0 KB
  electron/run.sh                    6103 B  6.0 KB
  electron/main.js                   6795 B  6.6 KB
  electron/preload.js                1961 B  1.9 KB
  package.json                       1089 B  1.1 KB
  .gitignore                          674 B  0.7 KB
  README.md                         22654 B  22.1 KB
  docs/ARCHITECTURE.md              42708 B  41.7 KB
  docs/CAPABILITY.md                11641 B  11.4 KB
  docs/DEVELOPING.md                19253 B  18.8 KB
  docs/ROADMAP.md                   15725 B  15.4 KB
  docs/surface-measurement.md        6496 B  6.3 KB
  fixtures/pages/AsyncIO.ts          6206 B  6.1 KB
  fixtures/pages/Detail.ts           3097 B  3.0 KB
  fixtures/pages/Home.ts             3232 B  3.2 KB
  fixtures/pages/Index.ts            2737 B  2.7 KB
  fixtures/pages/Layout.ts           3434 B  3.4 KB
  fixtures/pages/Lazy.ts             4485 B  4.4 KB
  fixtures/pages/Measure.ts          6262 B  6.1 KB
  fixtures/pages/NetFile.ts          5039 B  4.9 KB
  fixtures/pages/Observe.ts         11906 B  11.6 KB
  fixtures/pages/Provide.ts          6731 B  6.6 KB
  fixtures/pages/Rich.ts             9256 B  9.0 KB
  fixtures/pages/V2.ts              13447 B  13.1 KB
  fixtures/pages/Widgets.ts          4600 B  4.5 KB
  test/ability.html                  4695 B  4.6 KB
  test/async.html                    5977 B  5.8 KB
  test/components.html               4985 B  4.9 KB
  test/index.html                    3560 B  3.5 KB
  test/layout.html                   4135 B  4.0 KB
  test/lazy.html                     4380 B  4.3 KB
  test/leak.html                     3921 B  3.8 KB
  test/measure.html                  6072 B  5.9 KB
  test/netfile.html                  5302 B  5.2 KB
  test/observe.html                  6232 B  6.1 KB
  test/opfs-probe.html               1620 B  1.6 KB
  test/provide.html                  4238 B  4.1 KB
  test/rich.html                     3794 B  3.7 KB
  test/router.html                   4288 B  4.2 KB
  test/v2.html                       7235 B  7.1 KB
```

**"149 / 149" 的准确含义**：149 个组件**名字**都能建出 DOM 节点（不崩、有基础标签/样式）。其中 **64 个有真实 DOM 画像**（8 手写 + 56 骨架），**85 个只落 `data-*`**（能建出来但视觉上是个 `div`）。这不等于"实现了 149 个组件"。

**诚实的能力边界**（详见 `docs/CAPABILITY.md`）：

| 维度 | 状态 |
|---|---|
| ArkTS 语法（装饰器/struct/build/控制流） | ✅ 官方产物完整覆盖 |
| 状态管理 v1（`@State/@Prop/@Link/@Provide/@Consume/@Watch`） | ✅ 有测试（`run.sh provide`） |
| 状态管理 v1 深度观测（`@Observed` + `@ObjectLink`） | ✅ 有测试（`run.sh observe`，20 条断言；含"非 `@Observed` 嵌套对象内部变更**不**触发重渲染"的负向断言） |
| 状态管理 v2（`@ComponentV2/@Local/@Param/@Once/@Event/@Monitor/@Provider/@Consumer/@ObservedV2/@Trace/@Computed`） | ✅ 有测试（`run.sh v2`，26 条断言，浏览器 + Electron 双通过） |
| v2 的已知简化 | ⚠️ `@Computed` 不缓存；`IMonitor.dirty` 每次赋值一条且 `path` 非点分路径；`@Reusable` 复用路径未实测 |
| 布局 | ⚠️ 部分：`alignRules` 仅一层锚链，无约束求解器 |
| 虚拟滚动 | ✅ 1000 项 → 11 节点 |
| 平台模块 | ⚠️ 10 个实现了；`media`/`notification`/`startAbilityForResult` 等未实现 |
| 持久化 | ✅ Electron 真磁盘（shell 级验证）；浏览器 `localStorage` |
| 动画 / 手势 | ❌ 未实现 |
| `Navigation` / `Tabs` 切换 / `Swiper` | ⚠️ 骨架可建，无切换语义 |
| 85 个骨架组件的视觉语义 | ❌ 仅 `data-*` |

---

## 7. 文件职责

| 文件 | 体积 | 职责 | 改它的时机 |
|---|---|---|---|
| `runtime/arkui-dom-runtime.js` | 63.9 KB | v1 状态类 + 深度观测（`@Observed`/`@ObjectLink`）、`ViewPU`/`ViewV2`、装饰器层、组件栈、布局、`LazyForEach`、路由 | 实现新语义（**手写优先**） |
| `runtime/generated-components.js` | 56.3 KB | 149 个组件骨架（**生成物**） | **不手改**；改 `tools/gen-components.mjs` 后重新生成，`--check` 会守门 |
| `runtime/ohos-shims.js` | 22.5 KB | `@ohos:*` 模块 + 持久化后端 | 新增平台模块 |
| `tools/extract.mjs` | 6.3 KB | hvigor 缓存 `.ts` → 可执行 `.js`；**装饰器作用域内绑定前奏 + 未就绪守卫**（§3.4） | 产物形态/装饰器集合变化时 |
| `tools/gen-components.mjs` | 7.6 KB | ets-loader 组件 JSON → 骨架注册表（`--check` 只校验不写） | 组件元数据/画像规则更新时 |
| `tools/serve.py` | 2.5 KB | 静态服务 + `/echo` + `/slow`（测超时） | 需要新测试端点时 |
| `tools/stats.mjs` | 8.3 KB | 本文档所有数字的来源（`--json` 机器可读） | 覆盖范围变化时 |
| `tools/preflight.mjs` | 5.0 KB | 环境自检（工具链/宿主/可执行位） | 外部依赖变化时 |
| `tools/check-all.sh` | 2.7 KB | 一条命令做完验收，退出码只看被调命令 | 新增验收步骤时 |
| `run.sh` | 9.0 KB | 浏览器 15 用例驱动 | 新增用例 |
| `electron/run.sh` | 6.0 KB | Electron 14 用例 + 磁盘验证 | 新增用例 |
| `electron/main.js` | 6.6 KB | 主进程：offscreen 截图、**像素级**空白检测 | 截图/验证策略变化时 |
| `electron/preload.js` | 1.9 KB | `contextBridge` 暴露 Node fs | 宿主能力变化时 |
| `fixtures/pages/*.ts` | 80.5 KB | **冻结的**官方转换产物（13 个，含 `V2.ts`/`Observe.ts`） | 几乎不改（见不变量 5） |
| `test/*.html` | 68.8 KB | 断言页（读 `#result` 节点文本） | 新增用例 |

---

## 8. 相关文档

- `docs/CAPABILITY.md` —— 能力矩阵与已知限制（面向使用者）
- `docs/DEVELOPING.md` —— 开发指南：怎么加组件、加模块、加用例，以及**踩过的坑**
- `docs/ROADMAP.md` —— 原子任务清单，每项带验收命令
- `docs/surface-measurement.md` —— ①.5 阶段的接口面测量（历史记录）
- `README.md` —— 快速开始

## 9. 外部依赖与参考

| 依赖 | 位置 | 说明 |
|---|---|---|
| HarmonyOS CLT 26.0.0.821 | `/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools` | `ets-loader` 与其自带 TypeScript 4.9.5 |
| **SDK 的 `.d.ts` 声明** | `<CLT>/sdk/default/openharmony/ets/build-tools/ets-loader/declarations/` | `IMonitor`/`IMonitorValue` 等接口的**权威形状**来源 |
| **组件元数据** | `<CLT>/.../ets-loader/components/*.json` | 150 个文件 → 149 个组件注册表 |
| Electron 44.2.0 | `~/.cache/electron/electron-v44.2.0-linux-x64.zip` | 启动需 `--no-sandbox --disable-gpu` |
| `libhilog.so` / `libshared_libz.so` | `/data/training/cli/arkts-shim/lib/` | 补 CLT 缺失库，使 `ark_aot_compiler` 可用 |
| **许可与出处** | **`THIRD-PARTY-NOTICES.md`（本仓库根）** | 第三方组件许可清单：`.d.ts` 是 Apache-2.0，`ets-loader`/`components/*.json` **未声明**，CLT 顶层是 DevEco EULA |
| `arkts-shim` 分析 | `/data/training/cli/arkts-shim/README.md` | 含"Linux 预览器被 45 字节桩阻塞"的 `objdump` 证据 |
