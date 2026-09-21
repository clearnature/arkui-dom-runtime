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
| **语义分歧的**（必须抢在 CSS 同名前） | 专用处理函数 | `alignRules`、`maxLines`、`textOverflow`、`alignContent`、`tabBar`、**`Tabs.onChange`/`Swiper.onChange`**、**Swiper 的 `index`/`loop`/`autoPlay`/`interval`/`indicator`**、**Navigation 的 `navDestination`/`mode`**、**绘制类四件套的 `value`/`startAngle`/`colors`/`stars`/`stepSize`/`onChange`…**（值是状态、要重绘，不是样式） |
| **生命周期回调**（由栈操作派发） | 存进 `node.__navDestCbs` | **NavDestination 的 `onWillAppear`/`onWillShow`/`onShown`/`onReady`/`onWillHide`/`onHidden`/`onWillDisappear`/`onBackPressed`** |
| **`Grid` 轨道模板** `GRID_TRACK_PROPS` | `normalizeTrackList`（ArkUI 裸数字 = vp → CSS 必须带 `px`） | `columnsTemplate`、`rowsTemplate` |
| 尺寸类 `cssPropSize` | `toCssSize`（number → `px`）| `fontSize/width/height/padding/margin/borderRadius`、**`columnsGap`/`rowsGap`** |
| 原样透传 `cssPropRaw` | `String(resolveResource(v))` | `fontWeight/opacity/zIndex/flexGrow/aspectRatio` |
| 枚举类 `cssPropEnum` | 枚举值本身即 CSS 值 | `justifyContent/alignItems/textAlign/position` |
| **已识别但未实现** | 记 `layoutWarnings` 后**不 return**（语义丢失但值仍落 `data-*`） | `Grid.cellLength/maxCount/minCount/layoutDirection`、`Tabs.vertical/barMode/动画/回调…`、`Swiper.vertical/displayCount/动画/回调…`、**`Navigation.title/hideTitleBar/menus/…` 与 `NavDestination.title/…`（标题栏是可见差异，必须出声）** |
| **兜底** | `data-*` | 其余全部 |

> ⚠️ `alignContent` 的 ArkUI 语义是"**叠放子项的对齐**"（即 `Stack({alignContent})`），与 CSS 的 `align-content`（多行内容分布）**完全不是一回事**。所以它必须在 `cssPropEnum` **之前**被拦掉。同理 `alignRules`、`maxLines`、`textOverflow`、`tabBar`。
>
> 另外 `Stack` 的 `alignContent` 是 **create 选项**不是 setter，必须走 `applyCreateArgs`（L364），不是 `applyAttr`。
>
> ⚠️ **`onChange` 是分叉的**：`Slider` 之类是 DOM 事件，而 `Tabs` 的切换只能由运行时派发 → 必须按"栈顶节点有没有 `__tabsState`"分流。落成 `addEventListener('change')` 会得到一个**永不触发**的监听器（静默失效，比报错更难查）。
>
> ⚠️ **轨道模板的裸数字陷阱**：`columnsTemplate('100 1fr')` 直传会写出 `grid-template-columns: 100 1fr`——浏览器**整条声明作废且不报错**，表现为"Grid 完全没有列"。`normalizeTrackList` 把 `100`→`100px`、`50vp`→`50px`，同时保留 `1fr`/`auto`/`%`/`repeat()`/`minmax()`。断言不能只看字符串（`'100 1fr'` → `'100px 1fr'` 是字符串级），还要看**几何**（第 0 列真占 100px）——字符串对了但轨道没生效是可能的。

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

### 3.6 `Grid` / `Tabs` / `Swiper` 的契约（R9–R11，实测产物）

**`Grid` / `GridItem`**（`fixtures/pages/TabsGrid.ts`）：

```ts
Grid.create();
Grid.columnsTemplate('1fr 1fr 1fr');  Grid.rowsGap(4);  Grid.columnsGap(6);
Grid.width('100%');  Grid.height(120);  Grid.id('gridA');
{ /* GridItem.create(() => {}, false) + observedDeepRender()，同 ListItem */ }
Grid.pop();
```

`GridItem` 走的是 `ListItem` 那套 **deep-render** 特例（`create(deepFn, false)` + 外部 `observedDeepRender`），
轨道落位靠 CSS grid 的自动排布（ArkUI 默认 `GridDirection.Row`，与 CSS 的 row-major 一致）。

**`Tabs` / `TabContent`**（注意与 `GridItem` 的形态**不同**）：

```ts
Tabs.create({ barPosition: BarPosition.Start, index: 0, controller: this.tabCtrl });
Tabs.onChange((i: number) => { this.activeIdx = i; });
Tabs.width('100%');  Tabs.height(100);

TabContent.create(deepFn);        // ← 子构建器【当构造参数传】，不是 create() + 外部 deepRender
TabContent.tabBar('T0');
TabContent.pop();
// × 3 …
Tabs.pop();
```

落地的 DOM 结构（`Tabs` 自身在组件栈上，所以 `Tabs.width/height/onChange` 作用于**整体**）：

```
<div data-arkui-comp="Tabs">          flex column
  <div data-arkui-tabs-bar>           barPosition=Start 在前 / End 在后（Tabs.pop 时才定序并建项）
  <div data-arkui-tabs-content>       TabContent 挂这里 —— 不是 Tabs 自己
```

**为什么 `TabContent` 要"跳过"父节点另挂**：若直接挂进 `Tabs` 包装元素，它会和 tab bar 同级，
且 `Tabs.width()/height()` 会作用到内容区而不是整体。所以由 `TabContent` 认领 `__tabsContentEl`，
并把 `rec.parentNode` 也改指到内容区——**这一条不改会导致每次重渲染重建整个 bar**。
另外它是**自定义挂载点**，所以必须自己补 `data-arkui-comp` 标记（`mountNode` 才会打；本步漏掉时
`querySelectorAll('[data-arkui-comp="TabContent"]')` 返回 0——已实测踩过）。

**切面板的公共实现** `onlyOneVisible(entries, active)`：只显示活动项（`R11 Swiper` 将复用同一机制）。
`Tabs.pop()` 时才 `finalizeTabs`：按 `barPosition` 排定 bar 位置、按 `contents` 的标签重建 bar 项、
应用初始 `index`。切换路径有两条，都汇到 `setActiveTab(st, i, fire)`：`TabsController.changeIndex(n)`
与点击 bar 项；`fire=true` 时派发 `onChange`。

**语义要点**：切走的面板**不销毁**（ArkUI 保留实例，与 `router` 的页面栈同理）——
实现是 `display:none`，不是移除节点。越界 `changeIndex` 返回 `false` 并记 `layoutWarnings`，不静默。

**自省钩子** `__arkui_dom_tabsState(el)` → `{index, count, labels, barPosition, hasController, controller}`：
让断言能证明"控制器真绑上了、标签真来自 `tabBar`"，而不是只看"某个 div 的 `display` 恰好是 `none`"。

**`Swiper` / `SwiperController`**（`fixtures/pages/SwiperDemo.ts`）—— 结构比 `Tabs` 简单：

```ts
Swiper.create(this.ctrl);          // ← create 的参数就是【控制器实例本身】
Swiper.index(0);  Swiper.loop(false);  Swiper.autoPlay(false);
Swiper.indicator(true);  Swiper.interval(50);  Swiper.onChange(cb);
Swiper.width('100%');  Swiper.height(80);  Swiper.id('swiperA');
{ Text('s0'); Text('s1'); Text('s2'); }   // 每个子组件 = 一页，直接挂进 Swiper 元素
Swiper.pop();
```

⚠️ **本 SDK 的签名是 `Swiper(controller?: SwiperController)`，不是 options 对象**——
`index`/`loop`/`autoPlay` 全是**属性 setter**。这条是编译器判错（`'index' does not exist in type
'SwiperController'`）之后才查出来的：`swiper.d.ts` 的 `SwiperInterface` 只有一个重载。
**别凭印象写 `Swiper({index:0})`** —— 与 `Tabs({barPosition, index, controller})` 的形态不同。

与 `Tabs` 的两点结构差异：
1. **子项直接挂进 Swiper 元素**（栈顶即它），不需要像 `TabContent` 那样另认领内容区；
   所以 `Swiper.width/height/onChange` 自然作用于整体。
2. **指示点是覆盖层**：`Swiper.pop()` 时（此时才数得出页数）追加一个
   `[data-arkui-swiper-indicator]` 绝对定位容器 + N 个 `[data-arkui-swiper-dot]` 圆点。
   页面用 `[data-arkui-swiper-page]` 标记，所以"页"与"指示点"不会互相污染。

**语义要点**：
- `loop` 默认 **true**（与 ArkUI 一致）→ 越界**回卷**；`loop=false` 时越界 `changeIndex` 返回
  `false` + 记 `layoutWarnings`，而 `showNext`/`showPrevious` 在边界**停住**（合法语义，不记 warning）。
- `autoPlay` 用 `setInterval`；回调里先查 `st.node.isConnected`，页面被 `router` 换掉/`clearRoot`
  后**自动停表**（否则跨页面泄漏）。
- `finishAnimation(cb)` 直接回调（无动画）；`preloadItems` 返回已 resolve 的 Promise（所有页都是即时构建的）。
- **手势滑动未实现**（只有控制器/指示点/autoPlay 三条路径）→ 见 `CAPABILITY.md` 的"动画/手势"行。

**自省钩子** `__arkui_dom_swiperState(el)` → `{index, count, loop, autoPlay, interval, hasController, controller}`。

### 3.7 `Navigation` / `NavDestination` / `NavPathStack` 的契约（R12，实测产物）

与前两组都不同的一点：**builder 由运行时调用，不在页面的 `initialRender` 里**。

```ts
Navigation.create(this.stack, { moduleName, pagePath, isUserCreateStack: true });
Navigation.title('Home');
Navigation.navDestination({ builder: this.PageMap.bind(this) });   // ← 包一层对象取 .builder
Navigation.mode(NavigationMode.Stack);  Navigation.width('100%');  Navigation.id('navA');
{ …根内容子组件… }                    // 直接挂进 Navigation 元素
Navigation.pop();

// 运行时在压栈时调用 builder(name, param, parent?)：
NavDestination.create(deepFn, extraInfo);   // ← 子构建器同样是【构造参数】（同 TabContent）
NavDestination.title(name);
NavDestination.onWillAppear/…/onWillDisappear(cb);
NavDestination.pop();
```

**DOM 结构**：

```
<div data-arkui-comp="Navigation">            position:relative; overflow:hidden
  …根内容…                                    被覆盖但【不销毁】——"pop 后状态保留"就靠这条
  <div data-arkui-nav-destinations>           绝对定位覆盖层；空栈时 display:none
    <div data-arkui-comp="NavDestination">    只有栈顶那个可见（其余 display:none）
```

**实现要点**：

- **栈对象与 Navigation 状态共用同一个数组**（`stack._paths === st.paths`），避免两份状态漂移；
  `Navigation.create` 时把 `stack._nav` 指回来，这就是 `NavPathStack` 知道"该操作哪个 Navigation"的方式。
- **压栈顺序**：先 `paths.push(rec)` 再建树（builder 里若读 `size()`/`getAllPathName()` 应看到新状态）；
  建不出来（builder 没产出 `NavDestination`）就**回滚**，不留没有节点的幽灵路径项。
- **建树时把目标区压上组件栈**：`ViewStackProcessor.push(area)` → builder → `restore()`，
  这样 builder 里的 `NavDestination.create` 会挂进目标区，而不需要 `NavDestination` 自己去找父容器。
- **销毁要回收 elmtId**：`navDestroyDest` 移除节点后调 `purgeDetachedRecords()`。
  实测：3 层栈 + 若干次替换/移除后 `clear()`，记录数回到基线（25 → 25）。
- **生命周期派发**（`navFire`）：
  - 首次挂载：`willAppear → willShow → shown → ready`；再次显示只走 `willShow → shown`
  - 隐藏：`willHide → hidden`（先隐藏后 `display:none`）；销毁：`willDisappear` → 移出 DOM
  - 弹出多个时**从栈顶向下**处理，保证顺序
  - ⚠️ 顺序是按 `.d.ts` 的 JSDoc 语义（"about to be mounted/displayed" 早于 "displayed"）**推断**的，
    **未在真机上核对**；`onWillAppear` 的绝对时机也不同（真机在挂载前，本实现在子树挂载后）。
  - ⚠️ `onBackPressed` **没有触发源**：本运行时没有系统返回键（浏览器/Electron 不产生）。
    登记它会立刻记一条 `layoutWarnings` 而不是"存了不调"（静默失效）。
- **可见性 = 只有栈顶**：`navSyncVisibility(st)` 统一处理"隐藏旧的、显示新的"，
  并在切换时派发生命周期。**栈顶的节点被销毁时也要先 hide 再 destroy**。
- `moveToTop` **复用原实例**（只调 DOM 顺序、不重建），与真机一致；
  `replacePath` 则是"销毁旧的 + 建新的"，且**不派发 `onPop`**（替换不是弹出）。
  这两个语义差异是**推断**的（`.d.ts` 未写明），已在 `CAPABILITY.md` 标注。

**自省钩子** `__arkui_dom_navState(el)` → `{size, names, params, hasBuilder, mode, stack}`。

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

### 4.4 布局：`alignRules` 六键语义 + `Guideline` + `bias` + 多层锚链

ArkUI 的 `RelativeContainer` 用 6 个键，**分两组**（极易记错）：

```
水平：left / start（左边缘） / middle（水平中心） / right / end（右边缘）
垂直：top（上边缘）          / center（垂直中心） / bottom（下边缘）
```

> 键名有两套：`LocalizedAlignRuleOptions` 用 **start/end/middle + top/bottom/center**，
> 老版 `AlignRuleOption` 用 **left/right/middle + top/bottom/center**。
> （`.d.ts` 依据：`left?/start?/end?` 的 param 是 `HorizontalAlign`，`top?/bottom?/center?` 是 `VerticalAlign`。
> 所以 **`middle` 是水平的、`center` 是垂直的**。）两套都要认，否则本地化写法会静默漏支持。

```js
const ALIGN_FRAC = { start: 0, top: 0, center: 0.5, end: 1, bottom: 1 };
const isStart = (a) => a === 'start' || a === 'top';
const isEnd   = (a) => a === 'end'   || a === 'bottom';
const H_KEYS = new Set(['left', 'start', 'middle', 'right', 'end']);   // 靠它判断"这个键要定水平位置"
```

- 锚点有**三种**：容器（`'__container__'`）、**Guideline**（按 id）、**兄弟节点**（按 id）
- 实现方式：绝对定位 + 按锚点的 `offsetLeft/offsetWidth` 算 `left/top`
- 容器需要 `position: relative`，否则 `offsetTop` 基准错（踩过：`scrollToIndex` 因此偏 100px）

**① Guideline**（容器级属性 `guideLine([...])`）：

```ts
.guideLine([{ id: 'vline', direction: Axis.Vertical, position: { start: '30%' } }])
```

⚠️ **方向极易记反，以 `.d.ts` 的 JSDoc 为准**：

| `direction` | 是什么线 | 能锚的轴 | `position.start` 的量法 |
|---|---|---|---|
| `Axis.Vertical`（=0） | **竖线** | 子组件的**水平**位置 | 距容器**左**边 |
| `Axis.Horizontal`（=1） | **横线** | 子组件的**垂直**位置 | 距容器**上**边 |

**错轴使用时值恒为 0**（JSDoc 原话："the value is 0 when it is used as the anchor in the …"）。
参考线被建模成"零尺寸的盒子"（竖线 `{x, 0, w:0, h:ph}`），于是 `edgeAt` 对任意 align 都返回该偏移量。

⚠️ **`GuideLinePosition` 只有 `start`/`end`，没有 `percent`**（本 SDK 实测；ROADMAP 里原来那个
`{percent:30}` 例子是旧 API，已改）。百分比要用 `start: '30%'` 这种 Dimension 字符串。
`end` 表示"距容器右边/下边"。

**② bias**（同一轴两侧都锚定时决定落在区间里的哪一点）：

```ts
alignRules({ left: {...}, right: {...}, bias: { horizontal: 0.2 } })
```

- 权威默认值：`common.d.ts` 的 JSDoc 写着 **`@default {horizontal:0.5,vertical:0.5}`**
  → **"两侧都锚定但没写 bias"= 居中**，不是"bias 不生效"（我第一版就错在这儿）
- 语义原话："ratio of the distance to the left/upper anchor to the total distance between anchors"
  → 左边缘可行区间 `[L, (pw - R) - w]`，`x = L + t·(区间长度)`
- JSDoc 只要求 `>= 0`，所以只做下界钳制（>1 会外推到锚点之外）

**③ 多层锚链：不动点迭代**。锚链可能是**逆序声明**的（c 锚 b、b 锚 a，而 c 写在最前），
单趟解析会读到兄弟的旧位置。所以 `syncAlignRules` 反复扫到不动点（链长 N 需要 N 趟，
上限 `min(元素数+2, 12)`，超限记 warning 而不是静默给错值）。

⚠️ **对齐规则只登记、不立刻解析**。`applyAttr('alignRules')` 只存 `__alignRules`，真正的解析在
每轮 `syncAlignRules`（首渲染后 + 每次重渲染后）。理由：属性应用时锚点可能还没建出来
（逆序声明必然如此），立刻解析**既算错又会产生假警告**"找不到锚点 'x'"——实测留下 4 条假警告，
把警告通道弄脏了。

### 4.5 `LazyForEach` 虚拟滚动

产物：

```ts
LazyForEach.create("1", this, this.source, itemGen, keyGen);
LazyForEach.pop();
```

**核心模型：偏移永远由"逐项 advance 的前缀和"给出，而不是"序号 × 统一行高"。**

```
advance(i) = round((已实测高度(i) ?? estItemH) + gap)      // 取整：布局最终落在整像素上
offset(i)  = Σ advance(0..i-1)                             // 前缀和（Float64Array，脏了才重算）
totalH     = offset(total) - (total ? gap : 0)             // 最后一项后面没有 gap
窗口起点   = 二分 offset 找"最大的 i 使 offset(i) ≤ scrollTop"，再减 overscan
```

- **实测回填**：窗口渲染后逐项读 `offsetHeight` 写回 `heights`；变了就重建前缀并重排。
  未实测项用 `estItemH`，而 `estItemH` 取**已实测项的均值**（取第一项会错一半，且随窗口滑动来回翻）。
- **滚动锚定**：锚点 = 视口顶部那一项。它的偏移只由**它上面**的项决定，所以
  "改前缀前记旧偏移 → 改完取新偏移 → `scrollTop += (新 - 旧)`"就能让画面不跳。
  ⚠️ **两处顺序/时机极易错**（都实测踩过）：
  1. 必须等**实测高度与估计值全部写完**之后再取新偏移。先取偏移再改估计值 → 补偿量少算一截，
     `scrollToIndex` 目标会偏出十几像素。
  2. **spacer 高度要每次都按当前偏移重设**，不能只在"窗口变了"时设一次：窗口没变但前缀变了时，
     会留下"旧 spacer + 新模型"的错配（实测：DOM 里的项偏移比模型大 166px，整个窗口都错）。
- **容器间距用「块级 + 每项 `margin-bottom`」表达，不用 flex `gap`**：flex gap 会把 topSpacer
  也算作一个子项 → 每个窗口都多算一个 gap，模型与 DOM 永远差一个 gap。
  块级 + margin 下 `offset(i)` 恰好等于累计 advance，spacer 也不引入额外间距。
- **`scrollToIndex(i)` 的索引空间**：`querySelectorAll(ListItem)` 拿到的是**当前窗口**的渲染项，
  窗口内第 k 个渲染项对应的数据索引是 `window[0] + k`。直接取 `items[i]` 会把
  "渲染空间序号"当成"数据空间索引"（实测 `scrollToIndex(0)` 跳到了 100 段）。
  目标不在窗口内时用 `offsetOf(i)` 换算 → `meta.flush()` 同步补齐 → 才滚动。
- `setTimeout(0)` 合并滚动事件（不是 rAF，理由见 4.1）。
- 自省钩子 `__arkui_dom_lazyInfo(holder)` → `{total, measured, estItemH, estAdvance, gap, totalH, window, passes, offsetOf}`。

**实测（`run.sh lazyvh`，400 项变高 + 8 项全实测）**：
- 8 项全实测时 `totalH` 与 DOM 末项底部**逐像素相等**；每一项的 `offsetTop` 与模型**逐项相等**
- `scrollToIndex(100)` → 目标 `offsetTop - scrollTop = 0`；往返后仍为 0（不累积误差）
- 400 项里只渲染 4~5 个 DOM 节点

**已知限制**：`heights` 按**索引**存（数据源增删/重排后要整表失效，当前靠 `refresh` 重建窗口，
不做按 key 迁移）；`estItemH` 覆盖不到的深滚动位置，**总高是估计值**（只有"全实测"时才有精确总高）。

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

#### 4.7.1 后端自报：是文件系统就说，不是就别说（R21）

「能持久化」和「落到了文件系统」是**两件事**。localStorage 也能跨会话持久化，但它没有路径、没有目录、
有配额、清站点数据就消失 —— 把它说成"文件系统"就是撒谎。所以 `__arkui_dom_fs.describe()` 给出一张
**真值表**（不是随手定的：只有 node-fs 有 OS 可见路径；OPFS 是文件系统但对 OS 不可见）：

| 后端 | `isFileSystem` | `osVisiblePath` | 人话 |
|---|---|---|---|
| `node-fs` | true | true | 真文件系统（Node fs：真磁盘、OS 可见路径） |
| `opfs` | true | false | 文件系统（OPFS：浏览器管理的文件系统，无 OS 可见路径） |
| `localStorage` | false | false | **非真文件系统**（键值存储，无路径、有配额、清站点数据即失效） |

`text()` 给出一行人话，测试直接**打印并断言**它 —— 让"看起来持久化"无处藏身：

```
浏览器  FS backend=localStorage isFileSystem=false osVisiblePath=false root=(localStorage) | OPFS 探测 ok=false 卡在=getDirectory() 200ms
Electron FS backend=node-fs isFileSystem=true osVisiblePath=true root=<repo>/electron/data | OPFS 探测 ok=true 28ms
```

**探测（不是把注释当结论）**：`__arkui_dom_fs.probeOpfs(budget)` 真的去 OPFS 里走一遍
（`getDirectory` → `getFileHandle(create)` → `createWritable` → `write+close` → **读回** → 清理），
**每一步带超时**，返回 `{ok, failedAt, error, ms, timeoutMs, steps[{name, ok, ms}]}`；
启动时也会自动探一次（fire-and-forget，`startupProbe` 可 await，避免测试竞态）。
同一台机器上**两端结论不同**，这正是要报出来的东西：headless Chrome 卡在第一步
（`getDirectory()` 200ms 超时），而 Electron 的 Chromium 里 6 步全过（28ms）。

**两条不变量**：

1. **"我们没启用"≠"不可用"**。默认不启用 OPFS 是为了确定性（两次运行必须选到同一后端，
   见上），所以在 `probe.ok===true` 时自报必须说【可用】（并说明为何未启用），
   绝不许说成"不可用"。断言直接钉住：`opfsProbe.ok && notes` 里不得出现"不可用"。
2. **探测必须【有界】**。失败路径上 `getDirectory()` 可能**永不 resolve**，所以连"清理"都不能 await
   一个没有超时的调用 —— 早先这里 await 了它，把 200ms 的探测撑成 **2172ms**（实测踩到）。

**一条被破坏验证逼着加强的断言**：非 OS 可见后端"不冒充真路径"，最初写成
`!p.startsWith('/')`；破坏验证时把 `realPath` 换成 `() => 'B5: 骗你一个真路径'`，
**断言照样通过**（那个串不以 `/` 开头）。也就是说：只否定"像路径"的写法，任何别的串都能蒙过去。
改成要求**明确声明**之后（要么 `opfs://` 这样的 scheme、要么写"无真实路径"），
把 `realPath` 换成 `(p) => p`（原样吐回 vfs 路径 `/vfs/files/demo.txt`）就立刻被抓住。

### 4.8 页面栈与导航

- `pageStack` 存 `{ path, view }`——**存 view 是为了保留页面实例**（状态不丢）
- `navigateTo`：push 新页
- `navigateBack`：pop 当前**丢弃**，上一页**复用同一个 view 实例** → 状态自然保留
- 对外只暴露 `__arkui_dom_pageStack` 为**路径数组**（内部结构不外泄）
- `router` 模块的参数存在 `paramsByUrl: Map<url, params>`，`getParams()` 读回

### 4.9 绘制类组件的两种画法（SVG / CSS）

`Progress` / `Gauge` / `DataPanel` / `Rating`（R13）都是"数据来自 create 选项 + 形状由属性定"。
DOM 侧有两条路，按形状天然二分：

| 组件 | 用什么画 | 为什么 |
|---|---|---|
| `Progress`（Linear/Capsule） | **div + `--progress` 自定义属性 + 百分比宽度** | 条形用 CSS 最简，且 `--progress` 是个可断言的百分比出口 |
| `Progress`（Ring/Eclipse/ScaleRing） | **SVG 圆**（`<circle>` + `stroke-dasharray`） | 圆弧只能矢量画 |
| `Gauge` | **SVG 弧**（`<path d="M…A…">` + `stroke-dasharray`） | 需要任意起止角的分段弧 |
| `DataPanel`（Circle） | **CSS `conic-gradient`** | 环形分段用锥形渐变一行搞定，不必画 SVG |
| `DataPanel`（Line） | **flex 行 + 百分比宽度** | 分段条 |
| `Rating` | **内联 SVG 星 + 半星裁切覆盖层** | 星形需要路径；半星用 50% 宽的 `overflow:hidden` 覆盖层 |

**四个必须记住的实现要点**：

1. **弧长用 `pathLength="100"` 归一化** — 这样 `stroke-dasharray` 的第一个数**直接就是百分比**。
   否则断言只能去反推 `2πr`，脆而且难读。`Gauge` 的分段色与 `Progress` 的环都靠这一手。
2. **整圆不能只画一条 arc** — `startAngle=0 / endAngle=360` 是 **`.d.ts` 的默认值**，而一条
   SVG arc 的起终点重合时会**渲染成空**。必须拆成两个半圆（`arcPath` 里 `sweep >= 360` 分支）。
   ⚠️ 这条分支是"默认情形"，最容易漏测 —— 我的第一版 fixture 只有半圆，等于没测。
3. **角度约定照 `.d.ts` 的 JSDoc**：**0 点 = 0 度、顺时针为正**（即 `x = cx + r·sin θ`、
   `y = cy - r·cos θ`）。断言只钉"起点在顶部/底部中央（x≈cx 且 y 在中心的上/下侧）"，
   **不**钉具体半径 —— 半径 `r = min(w,h)/2 - strokeWidth/2` 是本实现的选择，不是规范。
4. **绘制要等尺寸生效**：形状在 `create` 时定，但 `.width/.height` 是之后才应用的，
   那时 `offsetWidth` 还是 0。所以真正的绘制放在 `syncDrawings`（与 `syncAlignRules` 同一时机：
   首渲染后 + 每次重渲染后）。**create 时只建骨架。**

**颜色与资源**：`Gauge.colors` 的权重按**和归一化**（`.d.ts` 只说"weight"、没说是否要求和为 1，
取归一化以同时兼容 `[0.5,0.5]` 与 `[3,7]` 两种写法），**权重为 0 的段按 JSDoc 不绘制**。
`Rating.starStyle` 是**图片 URI** —— 本运行时没有资源管线，加载不了，所以**退化为内置星形并记警告**
（不静默画成"看起来对"的星）。

### 4.10 文本测量：让浏览器自己排版，而不是自己模拟（R15）

实现的是真实平台模块 **`@ohos:measure`**（`runtime/ohos-shims.js`），不是自造 API。

| API | 权威语义（`.d.ts` 的 JSDoc） | 本实现 |
|---|---|---|
| `MeasureText.measureText(options): number` | **总是量单行**；`constraintWidth`/`maxLines` 等布局约束**不影响结果** | 离屏元素 `white-space:nowrap` + 不限宽，取 `getBoundingClientRect().width` |
| `MeasureText.measureTextSize(options): SizeOptions` | 受约束的**宽高，单位 px** | 离屏元素给 `width=constraintWidth`，让浏览器换行；用 `Range.getClientRects()` 数行 |

**关键取向：测量"真实布局"，不做"按字符宽度累加"的模拟。** 离屏元素 + 浏览器排版 →
字距、字体回退、禁则处理的答案**与真实渲染一致**（实测 `measureTextSize` 的宽高与同文本同宽度的
真实 `Text` DOM **逐像素相等**）。模拟实现一定会在这三处与渲染分叉，而这条 API 的用途恰恰是"预算尺寸"。

**离屏宿主不能用 `display:none`** —— 那样没有布局，量出来全是 0。用
`position:absolute; left:-100000px; visibility:hidden`。

**数行**：`Range.getClientRects()` 每个行盒一个 rect（复杂情况下同一行会有多段）→ 按 `top` 去重。

⚠️ **一个必须记住的"断言盲区"**：`measureTextSize` 只回 `width`/`height`，而
`height = 行数 × 单行高` —— **行数在算式里会被约掉**。所以"从高度反推行数"的断言
**无法验证数行本身**（实测：把数行改成恒返回 1，反推出来的行数依然是 4，断言全过）。
→ 所以额外暴露了自省钩子 **`__arkui_dom_countLines(el)`**（与 `measureTextSize` 内部用的是同一个
原始函数），让"数行"能被**直接**断言。**教训：如果某个中间量在最终结果里被约掉，就必须单独把它暴露出来。**

**已知限制**：`textContent` / 尺寸若传 `Resource` 引用 → 没有资源管线，按默认值处理并记警告；
百分比约束离屏测量无父容器、按像素处理并记警告；`measureTextSize` 在当前 SDK 里**已标 `@deprecated
since 18`**（官方建议改用 `UIContext.getMeasureUtils()`）——本实现只做了前者，页面若走
`this.getUIContext()` 会得到响亮的 `TypeError`（不是静默错值）。

### 4.11 `onAreaChange` 与自定义布局协议（R17）

R17 的原始描述（"`onMeasureSize`/`onAreaChange` 回传尺寸"）**前提是错的**，实测后拆成两件互不相关的事：

**① `onAreaChange(cb)`** —— 链式 `CommonMethod`，是"回传真实尺寸"的那条：

```ts
Text('a').width(120).height(30).onAreaChange((oldV: Area, newV: Area) => { … })
```

`.d.ts` JSDoc 的权威语义：`newValue` = 变化后的**宽高** + **相对父元素**的坐标 + **相对页面左上角**的坐标。
`Area = {width, height, position:{x,y}, globalPosition:{x,y}}`。

实现：**渲染后**由 `syncAreas()` 按真实几何（`getBoundingClientRect` + `offsetLeft/Top`）派发，
只在面积真的变了（或首次）时触发；`oldValue` 取上一次派发时记下的真实值。
→ **绝对不能在 `applyAttr` 里立刻派发**（那时还没布局，与不变量 18 同一条纪律）。

⚠️ **"首次布局也派发一次（oldValue 全 0）"是我按实践惯例定的**，真机 JSDoc 只说"面积变化时触发"，
**此点未在真机核对**。

**② `onMeasureSize` / `onPlaceChildren`** —— **不是链式属性**，而是**组件结构体上的方法**，
即 ArkUI 的**自定义布局协议**（`common.d.ts`）：

```ts
onMeasureSize?(selfLayoutInfo: GeometryInfo, children: Array<Measurable>, constraint: ConstraintSizeOptions): SizeResult;
onPlaceChildren?(selfLayoutInfo: GeometryInfo, children: Array<Layoutable>, constraint: ConstraintSizeOptions): void;
```

- **必须成对实现**（JSDoc 明确），否则布局不显示
- **返回的 `SizeResult` 优先级高于组件自身声明的 `width/height`**（JSDoc 明确）
- `Measurable.measure(constraint)` 要回**真实测量**的尺寸；`Layoutable.layout(position)` 负责摆放
- `ConstraintSizeOptions` 只有 **min/max 四界**（没有固定宽高）；`SizeResult`/`MeasureResult` 是 **px 数字**

**实测（决定实现方式的两条硬约束）**：
1. **`@Entry` 的 `build` 只能有一个【容器】根节点**（编译器原话："In an '@Entry' decorated component,
   the 'build' method can have only one root node, which must be a container component"）→
   所以"多子项 builder 模式"只适用于**非 `@Entry` 的嵌套 `@Component`**。测出这条之前我写了两次都编译失败。
2. **带链式属性的自定义组件会被编译器包一层 `__Common__`**：
   `KidLayout().id('kid')` → `__Common__.create(true); __Common__.id('kid'); … __Common__.pop();`。
   `__Common__` **不在 149 组件注册表里**，不实现就 `ReferenceError`。

实现（`runCustomLayout`，由 `ViewPU.create` 在 `childView.initialRender()` 之后触发）：

```
子节点      = 该组件 builder 直接产出的元素（在它的 display:contents 容器里）
measure(c)  = 把 min/max 约束写到该子项上，再读【真实 rect】→ 回 px（不做任何估算）
selfLayout  = host（带 .id() 的那层，可能是 __Common__ 包装器）覆盖【之前】的真实尺寸 + 边框/内外边距
constraint  = 父容器的真实内容盒 → {minWidth:0, maxWidth, minHeight:0, maxHeight}
onMeasureSize 的返回 → 写到 host 上（覆盖声明尺寸）→ 若尺寸还没稳定，再来一趟（上限 3 趟）
layout(pos) → 该子项 position:absolute + left/top
```

**为什么尺寸施加在 host 而不是容器**：`onMeasureSize` 回的是"组件自身"的尺寸，而 `.id()` 也标在组件上
—— 二者必须是同一个盒子，否则"组件的尺寸"和"带 id 的盒子"会分裂。

自省钩子 `__arkui_dom_customLayout(el)` → `{measured, children, selfSize, constraint, returned, measures, layoutCalls, passes}`。

**已知限制**：`measure()` 是**永久**把约束写到子项上（真机是"请求尺寸"、父容器随后决定）；
`onMeasureSize` 会被调用多趟以收敛（趟数记在 `passes`，上限 3）；`getMargin/Padding/BorderWidth`
回的是计算样式的四边值；实现了 `onMeasureSize` 却没有 `onPlaceChildren` 时会记警告。

### 4.12 图像信息 `@ohos.multimedia.image`（R18）

**模块名要更正**：ROADMAP 写的是 `@ohos:media`，实际是 **`@ohos.multimedia.image`**
（`@ohos.multimedia.media` 是音视频播放那套，两回事）。产物里是 `import image from "@ohos:multimedia.image"`。

```ts
const src: image.ImageSource = image.createImageSource('/test-assets/known-7x3.png');
src.getImageInfo().then((info: image.ImageInfo) => { info.size.width … info.mimeType … });
```

- `ImageSource.getImageInfo()` 三种形态：`Promise<ImageInfo>` / `(cb)` / `getImageInfoSync()`
- `ImageInfo { size: Size{width,height}, density, stride, pixelFormat, alphaType, mimeType, isHdr }`

**两条实现取向**：

1. **解码交给浏览器**（`fetch` → `blob` → `createImageBitmap`），不自己解析 PNG/JPEG 头 ——
   宽高来自真实解码器。同 R15 的"让浏览器自己排版"。
2. **`mimeType` 必须嗅探真实字节的魔数，不能用 HTTP 响应的 `Content-Type`**。
   依据：`.d.ts` 的 JSDoc 原话是 **"Actual image format (MIME type)"** —— 是**解码后的真实格式**。
   文件改名或服务端配置错时，响应头与真实格式会不一致。
   → 所以 `test-assets/` 里专门放了一张**伪装文件**（PNG 字节、`.jpg` 扩展名）来钉这条语义。
   认不出的格式才退回响应头，**但会记警告**（否则会把"没识别"伪装成"识别对了"）。

**`getImageInfoSync()` 的取舍**：同步 API 等不了解码。所以**只回已解码的缓存**；
没有缓存就**响亮抛错**，绝不编一个尺寸出来（编出来的尺寸会让调用方拿到假数据继续跑）。

**失败路径**：404/网络错误都抛 BusinessError 形状的错（`code: 62980103`），
**错误信息里带出问题的 URI**（可操作，而不是只说"失败"）。
回调形态成功时也传 `{code: 0}`（产物是 `if (err.code)`，传 `null` 会 `TypeError` —— R5 起的老规矩）。

**已知限制**：只实现了 `createImageSource(uri)` + `getImageInfo*` + `release`；
`PixelMap`/`ImagePacker`/`ImageReceiver`/`createImageSource(buf|fd)` 等未实现（调用会响亮报错）。
`stride`/`density`/`pixelFormat`/`alphaType` 回常量 0（未从解码器取真实值）。

### 4.13 通知 `@ohos.notificationManager`（R19）

**权威来源** `@ohos.notificationManager.d.ts`：`publish(request: NotificationRequest): Promise<void>`
**并有 `(request, AsyncCallback<void>)` 重载**；`cancel(id)` / `cancelAll()` / `isNotificationEnabled()`；
`ContentType` 六个枚举值（`BASIC_TEXT`…`SYSTEM_LIVE_VIEW`）。

**核心问题**：DOM 里**没有"系统通知"这一层**。"实现了"与"看起来实现了"的区别全在一点上——
**投递路径必须如实说自己走到哪一步**。所以每次 `publish` 都记下三样东西：
`via`（`host-Notification` / `record-only`）、`hostPermission`、`reason`。

**不变量**：**只有 `via='host-Notification'` 且 `hostPermission='granted'` 才算"确证送达"，
其余一切情况都必须写出非空 `reason`。** 这条由断言直接守着（见 §7 的 `measnotify`），
破坏验证里专门注入了"`via` 说走了宿主但 `reason` 留空"的**谎报送达**实现，被该断言精确抓住。

为什么不能压成两档——两端实测（同一条断言、期望值不同）：

```
浏览器（Chrome headless） via=host-Notification permission=default reason=宿主通知权限为 default（已创建通知对象，是否真的弹出由宿主决定）
Electron                  via=host-Notification permission=granted reason=-（确证送达，hostCreated 计数 +1）
```

`permission='default'` 时**浏览器照样能 `new Notification()` 成功**（不抛错、权限也没被拒），
若把它当成"已送达"，就是最典型的"看起来发了"。

**降级告警的边界**（两端语义刻意不同）：浏览器没有系统通知是**预期**降级 → 只写 `__arkui_dom_logs`；
Electron（preload 注入过 `global.__arkui_dom_nodeFs`）里"没送达"意味着用户看不到通知 → 进
`__arkui_dom_layout_warnings`。用 `nodeFs` 判端而不是 `navigator.userAgent`：判端依据取"能力注入"
这一既有的、单点的信号。`test/measnotify.html` 把宿主 `Notification` 换成 `permission='denied'` 的替身
来量这条边界，**两端期望值不同**（浏览器 0 条 / Electron 1 条），并且同时断言替身的**构造次数为 0**——
不允许"先构造再吞掉"。

**内容解析**：`content` 里按 `normal` → `longText` → `multiLine` 取显示文本（`kind` 记下取的是哪段）；
`picture`/`conversation` **不认就响亮失败**（DOM 表达不了图片通知，与其假装发了不如报错）。
空的 `content` 抛 BusinessError（`code: 401`）且**错误信息点名 `content`**。

**回调重载的语义**：也必须**异步**触发（`Promise.resolve().then(...)`），且该重载返回 `undefined`
而非 Promise（对应 `.d.ts` 的 `void` 重载）。这条单独有断言——同步触发会让调用方的"回调先于后续代码"
假设悄悄不成立。

**已知限制**：`picture`/`conversation` 内容类型不渲染；`sound`/`vibration`/`slotType`/`badge`/`group` 忽略；
通知点击回调 `on('click')` 未实现；**不做系统级断言**（不依赖桌面环境真的弹出，只看宿主对象是否被创建与权限）。

### 4.14 ability 栈：`startAbilityForResult` / `terminateSelf*`（R20）

**⚠️ 前提更正（实测）**：ROADMAP 写的"`onResult` 回调"在 API 26 SDK 里**不存在**——
`grep -r onAbilityResult <SDK>/ets/api/` **0 命中**。stage 模型里结果**只**从
`startAbilityForResult` 回来：`(want, options?): Promise<AbilityResult>` 或
`(want, callback: AsyncCallback<AbilityResult>)` / `(want, options, callback)`。
ROADMAP 的验收随之改成"Promise 形态与回调形态都拿到由 want 算出的 resultCode"。

**ability = 一份生命周期 + 一个窗口**。运行时维护一个栈：

- 根 ability 由 `__arkui_dom_startAbility(AbilityClass, {rootEl})` 起，渲染进调用方给的 `rootEl`；
- 子 ability 由 `context.startAbility(want)` / `context.startAbilityForResult(want, …)` 起，
  渲染进**新建的窗口容器**（`div[data-arkui-ability-window]`，盖满全屏、`z-index:20`）——
  真机上被启动的 ability 就在新窗口里，所以"起了第二个 ability"在 DOM 里是**看得见**的；
- `context.terminateSelf()` / `terminateSelfWithResult(param)` 结束自己：**先**
  `onWindowStageDestroy` → `onDestroy`，**再**移除窗口容器 + `purgeDetachedRecords()`，**最后**把结果交给调用方。

**为什么要在终止时抓 `textContent`**：关窗是"证据消失"的时刻。窗口移除前把它的文本存进
`__arkui_dom_abilityWindows().history[]`，测试才能断言"那个窗口**真的渲染过**被启动方的页面"，
而不是只看到一行"我建过窗口"的日志。破坏验证里"只记账不摘 DOM"与"渲染进调用方的根"
两种错法都被这条抓到。

**`loadRoute` 是单例状态**（`rootNode` + `pageStack`），所以子 ability 渲染期间要把"当前窗口"
切过去、跑完切回来（`withAbilityWindow`）。**已知限制**：子 ability 的**异步**重渲染不在支持范围
（它必须在自己生命周期内完成渲染）——本条由"切换窗口"的实现方式决定，不是疏忽。

**一个必须的次序**：结果接收者（Promise 的 resolve / AsyncCallback）要在**跑子 ability 生命周期之前**
登记好。因为子 ability 完全可能在自己的 `onWindowStageCreate` 里**同步**就
`terminateSelfWithResult`（本项目的 fixture 就是这么做的——"拿到结果就走"是常见形态）。
把这个次序写反，结果不会报错，而是**永远不回来**（破坏验证 B8 验证了这条有断言守着）。

**其他契约**：`terminateSelf*` **幂等**（重复调用不重复交结果）；AsyncCallback 一律**异步**回调
（同 R19）；`terminateSelf()`（不带结果）时调用方 Promise 得到 `{resultCode: 0}` ——
`.d.ts` **没有规定**这个值，是本实现的约定（见已知限制），断言只钉"调用方不会挂住"。

**已知限制**：只启动 `__arkui_dom_startAbility` 注册的那**一个类**（不按 `want.abilityName` 路由，
也没有 `requestCode`）；`StartOptions`（`windowMode` 等）接受但不解释；多窗口的层叠/返回栈
（真机上按返回键关掉上层）未实现；`startAbility` 的 `PermissionDenied`/可见性等错误码未实现。

### 4.15 轻提示与对话框 `@ohos.promptAction`（R20）

**权威来源** `@ohos.promptAction.d.ts`：

```ts
function showToast(options: ShowToastOptions): void;                       // 返回 void（不是 Promise）
function showDialog(options: ShowDialogOptions): Promise<ShowDialogSuccessResponse>;
function showDialog(options, callback: AsyncCallback<ShowDialogSuccessResponse>): void;
interface ShowDialogSuccessResponse { index: number }   // 被点按钮在 buttons 里的下标，从 0 起
```

**三个"不写下来就会猜错"的细节**，全部照 `.d.ts` 实现并断言：

1. `duration`：默认 **1500**；范围 **[1500, 10000]**；**小于 1500 用默认值**、**大于 10000 取上限**。
   自省里同时留 `durationRaw` 与 `effectiveDuration`——只断言"记了个数"没有意义，
   测试还断言 **1500ms 的两条真的自动消失、10000ms 的那条还在**（生效时长真的生效）。
2. `message` 是**必填**（401 "Mandatory parameters are left unspecified"）→ 缺了就响亮失败并点名字段。
3. 这两个全局函数**自 API 18 起 deprecated**（`@useinstead UIContext.PromptAction#showToast/showDialog`）。
   本实现做的是产物里实际调用的全局形态；`UIContext#getPromptAction` 未实现（见已知限制）。

**抛还是拒？——靠编译器的警告差异定音**（"先测量"的又一例）：
构建时编译器对 `showToast({...})`（void 版）报
**"Function may throw exceptions. Special handling is required."**，对
`showDialog({...}).then(...)`（Promise 版）**不报**。→ 实现取
**void 版同步抛（`throw` 401）、Promise 版走 reject**；fixture 里也据此一条用 `try/catch`、
一条用 `.catch` 接（补上 try/catch 后那批 "may throw" 警告归零，反过来印证了这个解释）。

**为什么"没有按钮的对话框"要响亮失败**：`buttons` 在类型上是可选的，但没有按钮就没有结束方式，
而"点遮罩结束"时 resolve 出的 `index` 在 `.d.ts` 里**没有规定**（`autoCancel` 默认 true 却没说结果的形状）。
与其造一个"永远点不掉"的假对话框，不如 reject 401 并说明要传 `buttons: [{text, color}]`。
断言钉住两点：**只有一个对话框节点**（没偷偷造第二个）且**错误信息点名 buttons**。

**挂载点与幂等**：toast/对话框都挂 `document.body`（不挂进页面根，页面重渲染不会清掉；
真机上它们属于窗口），`z-index` 高于 ability 窗口；`settle` 幂等（连点两次只结算一次）。

**已知限制**：`buttons` 为空一律拒绝（理由见上）；`autoCancel`/`isModal`/`maskRect`/`alignment`/
`offset`/`showInSubWindow` 仅接受不解释（**不实现点遮罩关闭**）；`closeToast`/`openToast`/
`showActionMenu` 未实现（调用即响亮报错）；`string | Resource` 里的 `Resource` 不解析
（DOM 侧没有资源表，落 `[资源引用未解析]`）。

### 4.16 显式动画 `animateTo` / `animateToImmediately`（R22）

**⚠️ 调用约定（实测产物）**：源码里写的是**全局** `animateTo(value, event)`（声明在
`ets/component/common.d.ts`），编译后是 **`Context.animateTo(...)`** —— `Context` 是**自由变量**。
所以运行时必须提供全局 `Context` 对象；只挂一个裸名 `animateTo` 会 `ReferenceError`。
（`Curve`/`PlayMode` 同样是自由变量，一并挂上。）

```ts
declare function animateTo(value: AnimateParam, event: () => void): void;               // 自 API 18 deprecated
declare function animateToImmediately(value: AnimateParam, event: () => void): void;    // since 12
// AnimateParam: duration? 默认 **1000**；curve? 默认 **Curve.EaseInOut**；delay? 默认 0；iterations? 默认 1；…
// Curve 13 个成员（Linear…Friction，0 基）；PlayMode 4 个（Normal/Reverse/Alternate/AlternateReverse）
```

**语义**：`animateTo(param, fn)` = "把 `fn()` 引起的状态变更变成一次过渡"。DOM 里能表达的是 **CSS transition**
（不是 ArkUI 的插值引擎）：

1. `fn()` 改状态 → **同步 `flush()`**（不变量 7 允许关键路径同步刷新）；
2. 刷新期间，`rerenderElmt` 把**这次真的被重渲染的节点**收集进动画窗口 —— 这比"整棵子树"或
   "查所有元素"都准：**谁的状态变了就动谁**（`__arkui_dom_animations()` 的 `els` 就是它的计数）；
3. 给这些节点挂 `transition: all <duration>ms <curve> <delay>ms`，并打 `data-arkui-anim="<seq>"`；
4. 到点（`duration + delay + 30ms`）清掉（恢复它们原来的内联 transition 值），并调 `onFinish`。

**`duration: 0` 不进动画**：不挂 transition、不标记、`els` 记 0、`endedBy='duration-0'`，
但 `fn()` 里的状态变更**照常落地** —— 这正是 ROADMAP 的验收点。注意断言的写法：
这次往往只有个别节点会被重渲染，**查"你以为的那个元素"会假通过**，判据必须是
"调用返回时**没有任何**节点被标记"，而且要在**同一 tick 内**读（隔一个 tick 会被清理掉、变成竞态）。

**`transitionend` 只作旁证，不用它清理**：多属性过渡会多次触发（先到的那个不代表整体结束），
而无头环境里**根本不来**。所以清理一律按时间到点，另外把 `sawTransitionEnd` 记进历史 ——
它诚实地分开两件事：**"我们挂上又按期清了"** vs **"浏览器真的跑了过渡"**。实测两端不同：

```
headless Chrome  te=false（过渡不进合成器，transitionend 不来）
Electron         te=true （框宽变化的那几次过渡真的跑完并触发）
```

（这条**不做断言**：它是宿主能力差异，不是实现是否正确；只进诊断行与文档。）

**参数降级要出声**（`iterations≠1` / `playMode≠Normal` / `tempo≠1` / `expectedFrameRateRange` / `ICurve` 曲线）
—— CSS transition 表达不了它们（transition 只跑一次、单向）→ 一律写 `layoutWarnings`，
绝不静默按"看着像"的方式执行。`fn()` 没有引起任何重渲染时也出声
（`.d.ts` 明确警告不要在 `aboutToAppear`/`aboutToDisappear` 里用 `animateTo`）。

**已知限制**：**`transition`（组件出现/消失动画）未实现** —— 它按不变量 3 落 `data-*`，不假装动画，
仍留在 ROADMAP 待办里（不把没做的算进 R22 的验收）；`animateToImmediately` 与 `animateTo` 在本运行时
**等价**（真机差异是"不等 vsync 立即投递"，CSS 里没有对应物）；动画只挂"被重渲染的节点"，
因此**父容器尺寸变化带动子节点位移**这类连带位移不会被单独过渡
（CSS 布局会跟着变，但过渡只作用在被改的那个元素上）。

### 4.16b 出现/消失过渡 `transition`（R22 收口）

`transition` 与 `animateTo` 是**两种不同的机制**，别混：`animateTo` 管"状态变更引发的过渡"，
`transition` 管"**组件被插入/删除**时的转场"。

产物形态（实测 `fixtures/pages/TransitionDemo.ts`）：
- `Text.transition({ opacity: 0, translate: { x: 0, y: 40 } })` —— `transition` 是**属性**（走 builder 栈）；
- `TransitionEffect` / `TransitionType` / `TransitionEdge` 是**自由变量** → 运行时挂全局；
- 两参重载 `Text.transition(effect, (transitionIn) => {…})` 真会传两个实参 → 生成的属性方法必须
  **透传全部实参**（原来是 `function (v)`，第二个参数会被静默丢掉）；
- 调用顺序是 `create → 属性 → pop`，所以**规格晚于挂载才到** → 出现动画由 `registerTransition` 触发，
  `mountNode` 只打 `__arkuiFreshMount` 标记（见坑 78）。

两个挂钩点：
- **插入**：属性登记处跑 `runEnterTransition` —— 先落到偏离态、**强制一次重排**把起始值提交掉，
  再带 transition 回常态。刻意不用 rAF（headless 里 rAF 节流不确定，见坑 ⑧）。
- **删除**：`if/else` 分支切换与 `ForEach` 重建原本是 `rec.node.textContent = ''`，现在走
  `detachChildren()`：**带消失过渡的子节点留在 DOM 里把动画走完，到点再摘**（与 `animateTo` 同款的
  `duration+delay+30ms` 收口，`transitionend` 只当见证不当依据）。**不延迟摘除就不可能有消失动画**。
  代价：过渡期间节点**仍占布局位**（真机亦然，但同容器其它项的重排看得出来）。

时长来源**两档**（本机制最要紧的差别）：`TransitionEffect` 自带 `.animation()` → 用它（不需要 animateTo）；
`TransitionOptions` 没有时间字段 → 用**外层 animateTo 窗口**的参数（窗口的曲线在 `win.rec.curveCss` 上，
读错字段只会静默丢曲线）；两者都没有 → AnimateParam 默认 1000ms / Linear，并把 `source` 记成
`default`（自省里能分辨"兜底"与"设备值"）。

方向门控：`TransitionType.Insert/Delete` 不匹配的方向**立刻摘/不动**且不留记录；`asymmetric` 两个方向
各用各的链与参数；`onFinish` 收到 `transitionIn`（插入 true / 删除 false）。

自省：`__arkui_dom_transitions()` → `registered`（形状/方向/summary/有无 onFinish）+
`runs`（`dir`/`duration`/`delay`/`curve`/`source`/`offText`/`endedBy`/`sawTransitionEnd`）。

**仍缺**：`SLIDE`/`SLIDE_SWITCH` 的参数 `.d.ts` 没给 → 近似并出声（推断）；`centerX`/`centerY`、
`translate.z` 未实现；`Tabs`/`Swiper`/`LazyForEach` 窗口变化与 `Navigation` 转场等**其它删除路径**仍立刻摘除。

### 4.17 手势：两层栈 + 指针识别器（R23）

**⚠️ 调用约定（实测产物）**：**两层栈**，全部是自由变量（不走 import）：

```js
globalThis.Gesture.create(GesturePriority.Low);   // ① 打开手势作用域（名字来自 ets-loader）
PanGesture.create({ fingers: 1, direction: PanDirection.All, distance: 5 });
PanGesture.onActionStart(cb); PanGesture.onActionUpdate(cb); PanGesture.onActionEnd(cb);
PanGesture.pop();                                 // ② 收一个手势
globalThis.Gesture.pop();                         // ③ 关作用域 → 挂到"当前节点"上
```

「当前节点」= **组件栈顶**（`ViewStackProcessor.top()`）：手势作用域嵌在组件的构建器里
（`Row…Gesture.create…Gesture.pop…Row.pop`），关作用域时栈顶正是那个组件。
所以产物里**没有** `.gesture()` 这样的属性方法 —— 不需要实现它（生成了反而会误导）。

**挂载按"渲染批次"替换**：`Gesture.pop()` 先把记录攒进 `pendingGestureAttach`，到微任务再统一
`attachGestures`。这样"同一次渲染里的多个作用域"是**合并**、"下一次渲染"是**替换** ——
否则重渲染会把回调叠成两份，一次手势触发两次回调（这类"翻倍"bug 很难从断言里看出来）。

**识别器全部基于真实 DOM pointer 事件**（`pointerdown/move/up/cancel` + `setPointerCapture`），
合成事件与真实指针走同一条路。语义（照 `.d.ts`）：

| 手势 | 触发条件 | 事件字段 |
|---|---|---|
| `TapGesture` | `count`（默认 1）次点击归组（窗口 300ms），位移容差 10px | `repeat`（第一组 false，后续 true） |
| `LongPressGesture` | 按住 `duration`（默认 500）；`repeat:true` 则按周期重复 | `repeat` |
| `PanGesture` | 位移 ≥ `distance`（默认 5）才 Start，之后每次 move 是 Update，抬手 End | `offsetX/offsetY`（相对按下点） |
| `SwipeGesture` | 抬手时按平均速度 ≥ `speed`（默认 100 **vp/s**）+ 方向匹配 | `angle`（水平向右为 0，顺时针正）、`speed` |
| `PinchGesture` | 两指距离变化 ≥ `distance`（默认 5） | `scale`（当前距离 / **第二指按下时**的基准距离） |

**一个真踩到的 bug**：`PinchGesture` 的基准距离必须在**第二个指针按下时**取。写成"第一次 move 时取"，
第一帧的移动就成了基准 → `scale` 永远是 1（识别器静默失效；破坏验证⑤复现出 3 条红）。

**已知限制**（前两条已由 4.17b 补上）：`RotationGesture`/`GestureGroup` 未实现
（`RotationGesture` 只在类型表里登记，没有识别器）；`priorityGesture`/`parallelGesture` 未实现；
**优先级与冲突仲裁**（`GesturePriority`/`GestureMode`/`GestureMask`）只记录不参与决策 ——
同一元素上多个手势**并列触发**；`onActionCancel` 只在 `pointercancel` 时派发；`fingerList` 恒为空数组。

### 4.17b 手势分组与优先级仲裁（R23 收口）

**先看产物**（`fixtures/pages/GestureGroupDemo.ts`）。三条约定决定了实现形态：

1. **三个属性只差一个实参**：`.gesture`→`Gesture.create(GesturePriority.Low)`、
   `.priorityGesture`→`High`、`.parallelGesture`→`Parallel`；`Gesture.create` 是**两参**的
   （第二参 `GestureMask`）。
2. **这些枚举名来自 ets-loader，不是 `.d.ts`**：`ets-loader/lib/pre_define.js` 里
   `GESTURE_ENUM_KEY="GesturePriority"` + `GESTURE_ENUM_VALUE_LOW/HIGH/PARALLEL="Low"/"High"/"Parallel"`，
   经 `createPropertyAccessExpression(Identifier("GesturePriority"), Identifier(gestureMap.get(attr)))` 发射。
   `.d.ts` 里的 `GesturePriority { NORMAL = 0, PRIORITY = 1 }` 是**另一套**（API 12 `addGesture` 用）。
   运行时两套都要提供（`NORMAL=Low`、`PRIORITY=High`，`Parallel` 是产物独有的第三档）。
   —— 这是 4.17 留下的 bug：只定义了 `{NORMAL, PRIORITY}`，于是 `GesturePriority.Low` 是 `undefined`，
   **三个属性在运行时完全区分不开**。
3. **`GestureGroup` 是容器式的 create/pop**：`GestureGroup.create(mode)` → `onCancel` →
   组内各手势 `create/on*/pop`（`pushGestureRecord` 归入**最近的组**）→ `GestureGroup.pop()`（组进**作用域**）。
   组的识别状态（`winner`/`stage`/`anyRecognized`）挂在组记录上，识别时由 `rec.__group` 反查。

**仲裁分两层，互不干扰**：

- **元素级（父子包含链）**：在 `pointerdown` 时**一次性定下**，识别循环只查结论（`gestureArbState`）。
  依据是 `CommonMethod` 的文档原文：`gesture`="子组件优先"、`priorityGesture`="父组件优先"、
  `parallelGesture`="准冒泡、父子都响应"、`GestureMask.IgnoreInternal`="禁用子组件手势"。
  做法：pointer 事件**由内向外冒泡** → 内层先"认领"，外层后到可覆盖；档位 `block > high > parallel > low`，
  同级按"内层优先"；`parallel` 不参与独占但**始终可触发**。指针捕获只交给**最内层**参战元素
  （捕获只改 target，事件仍沿祖先链冒泡，所以链上每个元素都还收得到）。
- **组级（`GestureGroup` 三态）**：Exclusive 先认出者独占、其余作废；Sequence 用 `stage` 按序推进
  且"只有最后一个能收 `onActionEnd`"；Parallel 互不影响。会话收尾（全部抬手 / `pointercancel`）时
  `settleGroups()` 判 `onCancel` 并把状态归零。

**两个"静默失效"级的坑**（都由断言抓出，见 `docs/DEVELOPING.md` 坑 81/82）：
`pointerup` 会**继续往外冒泡**，会话状态若被最内层先删掉，外层就查不到仲裁结论、被压制的祖先会**误触发**
（改成只由**冒泡路径上最后参战的那个元素**删）；识别器在"回调被组门控挡下"时若照样把 `started` 置真，
被挡的手势此后**永远发不出 `onActionStart`**（改成 `fireGesture` 返回"有没有被放行"，只在放行时推进状态）。

**已知限制**：组/仲裁语义按 `.d.ts` 文档注释实现，**不是真机实测**（本机没有 ArkVM）；
`RotationGesture` 起始线取第二指按下时的连线（`.d.ts` 写"detected 时"，差异上界即 `angle` 阈值）；
`IgnoreInternal` 按文档正文实现为"压制所有后代（含并行）"；同一元素内的多个作用域按元素取最高档，
不逐手势区分；多指分别落在不同元素时按"每个指针各自认领"处理（近似）；`fingerList` 仍恒为空。

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
14. **`on<X>` 不一定是 DOM 事件**。凡是有内部状态容器的节点（`Tabs`/`Swiper`），以及**由运行时派发的生命周期
    回调**（`NavDestination` 的 `onWillAppear`…），都必须在通用事件分支**之前**被拦截、由运行时自行派发。
    退化成 `addEventListener('change')` 会得到一个**永不触发**的监听器——页面看着正常，回调从不执行
    （比报错难查得多）。同理，`Tabs`/`Swiper` 的**语义属性**（`index`/`loop`/`autoPlay`/`indicator`…）与
    `Navigation` 的 `navDestination`/`mode` 值是状态不是样式，必须在落 `data-*` 之前截进 state。
    **反过来说：如果某个回调在本运行时里根本没有触发源（如没有系统返回键的 `onBackPressed`），
    登记时就要出声**——"存了不调"是最坏的一种静默。
15. **自定义挂载点要自己维护两条不变量**：① 打上 `data-arkui-comp` 标记（`mountNode` 会打，绕过它就得自己打，
    否则外部 `querySelectorAll` 查不到，表现为"组件不存在"）；② `rec.parentNode` 指向**真实**挂载点
    （重渲染靠它恢复位置，指错会重建整棵兄弟结构，如 `Tabs` 的 tab bar）。
16. **单位必须显式归一化**。ArkUI 的裸数字是 vp，CSS 无单位数值会让**整条声明作废且不报错**。
    凡是把 ArkUI 值透传成 CSS 语法的地方（轨道模板、长度），都要显式转换，并用**几何断言**兜底。
17. **由运行时驱动的子树构建，必须"预压容器 → 调 builder → 还原栈 → 校验产出"**。
    `Navigation` 的 builder 不在 `initialRender` 里，是运行时在压栈时调的：先把目标容器 push 到
    组件栈上（这样 builder 里的组件才有正确的挂载点），`restore()` 之后**必须校验产出**
    （builder 可能因为 `if/else` 没覆盖该 name 而什么都没建）——校验失败要**回滚**状态并出声，
    不能留一个"路径项存在但节点不存在"的幽灵。同一模式适用于 `TabContent`/`ListItem` 的深渲染。
18. **凡是要"读真实几何/尺寸"才能算的东西，一律不许在属性应用时做** —— 那时这些量还不存在。
    统一放到**渲染后的同步阶段**（`syncAlignRules` / `syncDrawings`，首渲染后 + 每次重渲染后各一遍）：
    - `alignRules` 的锚点解析（锚点兄弟可能还没建出来，逆序声明必然如此）
    - 弧的半径（`.width/.height` 是 create 之后才应用的，create 时 `offsetWidth` 是 0）
    - `guideLine` 的位置（要容器尺寸）
    违反这条的症状是双重的：**算出错值** + **留下一堆假警告**（把警告通道弄脏）。
19. **`onAreaChange` / 自定义布局协议同属"要真实几何"那一类**，也都放在渲染后同步阶段
    （`syncAreas`）；`ViewPU.create` 里对子组件的 `onMeasureSize` 检测必须发生在
    `childView.initialRender()` **之后**（那时子节点才存在，`measure()` 才有东西可量）。
    协议里**返回的尺寸优先**于声明尺寸，施加在"带 `.id()` 的那一层"（可能是编译器合成的 `__Common__`）。
20. **`runtime/arkui-dom-runtime.js` 是拼接产物，源在 `runtime/src/`**。手写语义一律加在源分片里
    （目前 `main.js` = 除过渡一节外的全部，`transition.js` = 出现/消失过渡），改完跑
    `npm run build:runtime` 重拼；产物入库，靠 `npm run check` 第 3 步（`build-runtime --check`）
    守"产物 = 源"。**为什么必须"源拆、产物不拆"**：分片共享同一个闭包
    （`elmtRecords`/`propDeps`/`ViewStackProcessor`/`animWindow`…），其中 `animWindow` 还是
    **可变绑定**（动画分片里 `let` 重新赋值、批量重渲染段在块外读它并 push）——拆成多个 `<script>`
    就得把 6 个导入名 + 3 个导出名显式穿线，并让 30 处 HTML 的加载顺序变成新的失败模式。
    分片**不是**独立可运行的 JS（同一个 IIFE 体内的连续若干段），所以"改完必须拼出来跑测试"。

---

## 6. 覆盖范围（可复现的数字）

**本块有守卫**：`npm run check` 的第 3 步（`stats --check-doc`）会逐行比对下面这块与
`node tools/stats.mjs` 的实际输出，漂移即非 0 退出；修复用 `npm run stats:write-doc`（就地重写）。
改完本文档就要重跑一次——**本块含文档自身的体积，是自引用**（收敛性见 `tools/stats.mjs` 的注释）。

`node tools/stats.mjs` 的实测输出：

```
== 组件库 ==
  ets-loader 注册名    149
  手写实现（真布局语义）17：Text Button Column Row Stack List ListItem RelativeContainer Tabs TabContent Swiper Navigation NavDestination Progress Gauge DataPanel Rating
  控制流宏（非组件）    3：If ForEach LazyForEach
  骨架·有 DOM 画像     51（容器 22 / 叶子 29）
  骨架·仅 data-*       81
  ⇒ 可建出的组件名      149 / 149
  原生输入类控件       6
  属性元数据总数       1078（平均 7.2／组件，最多 TextInput=70）

== 运行时 API ==
  global 导出        154 个
  状态类            ObservedPropertySimplePU ObservedPropertyObjectPU SynchedPropertySimpleOneWayPU SynchedPropertySimpleTwoWayPU SynchedPropertyNesedObjectPU
  内置组件          Text Button Column Row Stack List ListItem If ForEach LazyForEach RelativeContainer Tabs TabContent Swiper Navigation NavDestination Progress Gauge DataPanel Rating
  内部钩子 __arkui_dom_*  30 个

== 状态管理 ==
  v1  状态类        5 个（包装对象模型）
  v1  深度观测      @Observed 已实现（Proxy 拦截字段写入） + @ObjectLink 已实现（SynchedPropertyNesedObjectPU，官方拼写如此）
  v2  基类          ViewV2 已实现（extends ViewPU）
  v2  装饰器        11 个：ViewV2 Param Local Once Event Monitor Computed Provider Consumer ObservedV2 Trace
  注入方式          作用域内绑定（__arkui_dom_decorators），不挂 global —— 见 ARCHITECTURE.md §3.4
  装饰器表合计      12 个（含 v1 的 Observed）

== 平台模块（@ohos:*）==
  14 个：app.ability.AbilityConstant app.ability.ConfigurationConstant app.ability.UIAbility app.ability.Want data.preferences file.fs hilog measure multimedia.image net.http notificationManager promptAction router window

== 用例矩阵 ==
  浏览器 run.sh     31 个：index rich leak layout widgets tabgrid swiper navdemo reldemo drawdemo textmeasure lazyvh measarea measimage measnotify measure lazy provide v2 observe async ability promptaction realfs animdemo gesturedemo transitiondemo gesturegroupdemo router netfile persist
  Electron          30 个：netfile layout rich index leak ability router widgets tabgrid swiper navdemo reldemo drawdemo textmeasure lazyvh measarea measimage measnotify promptaction realfs animdemo gesturedemo transitiondemo gesturegroupdemo measure lazy provide async v2 observe
  测试页            31 个
  fixtures 转换产物  29 个：AnimDemo AsyncIO Callee Detail DrawDemo GestureDemo GestureGroupDemo Home Index Layout Lazy LazyVar MeasArea MeasImage MeasNotify Measure NavDemo NetFile Observe PromptAct Provide RelDemo Rich SwiperDemo TabsGrid TextMeasure TransitionDemo V2 Widgets

== 体积（源码，不含产物/Electron 运行时）==
  runtime          328.4 KB
  runtime(src)     215.7 KB
  test             239.3 KB
  tools            52.7 KB
  electron(src)    19.2 KB
  docs             339.5 KB
  fixtures         236.4 KB

== 逐文件（文档"文件职责"表的来源）==
  runtime/arkui-dom-runtime.js        220899 B  215.7 KB
  runtime/generated-components.js      57617 B  56.3 KB
  runtime/ohos-shims.js                57789 B  56.4 KB
  tools/extract.mjs                     6563 B  6.4 KB
  tools/gen-components.mjs              7775 B  7.6 KB
  tools/serve.py                        3887 B  3.8 KB
  tools/stats.mjs                      14005 B  13.7 KB
  tools/assert-counts.mjs               7476 B  7.3 KB
  tools/preflight.mjs                   5397 B  5.3 KB
  tools/check-all.sh                    3673 B  3.6 KB
  tools/build-runtime.mjs               5138 B  5.0 KB
  run.sh                               16406 B  16.0 KB
  electron/run.sh                      10652 B  10.4 KB
  electron/main.js                      6795 B  6.6 KB
  electron/preload.js                   1961 B  1.9 KB
  package.json                          1321 B  1.3 KB
  .gitignore                             674 B  0.7 KB
  README.md                            76854 B  75.1 KB
  THIRD-PARTY-NOTICES.md                8256 B  8.1 KB
  docs/ARCHITECTURE.md                112835 B  110.2 KB
  docs/CAPABILITY.md                   34482 B  33.7 KB
  docs/DEVELOPING.md                   55338 B  54.0 KB
  docs/ROADMAP.md                      77928 B  76.1 KB
  docs/surface-measurement.md           6496 B  6.3 KB
  docs/SESSION-2026-09-20.md           12842 B  12.5 KB
  runtime/src/main.js                 197167 B  192.5 KB
  runtime/src/transition.js            23757 B  23.2 KB
  fixtures/pages/AnimDemo.ts            6451 B  6.3 KB
  fixtures/pages/AsyncIO.ts             6206 B  6.1 KB
  fixtures/pages/Callee.ts              1726 B  1.7 KB
  fixtures/pages/Detail.ts              3097 B  3.0 KB
  fixtures/pages/DrawDemo.ts           10867 B  10.6 KB
  fixtures/pages/GestureDemo.ts         6561 B  6.4 KB
  fixtures/pages/GestureGroupDemo.ts   20489 B  20.0 KB
  fixtures/pages/Home.ts                3232 B  3.2 KB
  fixtures/pages/Index.ts               2737 B  2.7 KB
  fixtures/pages/Layout.ts              3434 B  3.4 KB
  fixtures/pages/Lazy.ts                4485 B  4.4 KB
  fixtures/pages/LazyVar.ts             7774 B  7.6 KB
  fixtures/pages/MeasArea.ts            8522 B  8.3 KB
  fixtures/pages/MeasImage.ts          12199 B  11.9 KB
  fixtures/pages/MeasNotify.ts          5355 B  5.2 KB
  fixtures/pages/Measure.ts             6262 B  6.1 KB
  fixtures/pages/NavDemo.ts            14129 B  13.8 KB
  fixtures/pages/NetFile.ts             5039 B  4.9 KB
  fixtures/pages/Observe.ts            11906 B  11.6 KB
  fixtures/pages/PromptAct.ts           6916 B  6.8 KB
  fixtures/pages/Provide.ts             6731 B  6.6 KB
  fixtures/pages/RelDemo.ts             9702 B  9.5 KB
  fixtures/pages/Rich.ts                9256 B  9.0 KB
  fixtures/pages/SwiperDemo.ts          7876 B  7.7 KB
  fixtures/pages/TabsGrid.ts           10513 B  10.3 KB
  fixtures/pages/TextMeasure.ts        11625 B  11.4 KB
  fixtures/pages/TransitionDemo.ts     14311 B  14.0 KB
  fixtures/pages/V2.ts                 13447 B  13.1 KB
  fixtures/pages/Widgets.ts             4600 B  4.5 KB
  test/ability.html                     4695 B  4.6 KB
  test/animdemo.html                   11498 B  11.2 KB
  test/async.html                       5977 B  5.8 KB
  test/components.html                  5566 B  5.4 KB
  test/drawdemo.html                   12765 B  12.5 KB
  test/gesturedemo.html                 9875 B  9.6 KB
  test/gesturegroupdemo.html           14791 B  14.4 KB
  test/index.html                       3560 B  3.5 KB
  test/layout.html                      4135 B  4.0 KB
  test/lazy.html                        4380 B  4.3 KB
  test/lazyvar.html                    10093 B  9.9 KB
  test/leak.html                        3921 B  3.8 KB
  test/measarea.html                    9231 B  9.0 KB
  test/measimage.html                   5110 B  5.0 KB
  test/measnotify.html                 10722 B  10.5 KB
  test/measure.html                     6072 B  5.9 KB
  test/navdemo.html                    13765 B  13.4 KB
  test/netfile.html                     5302 B  5.2 KB
  test/observe.html                     6232 B  6.1 KB
  test/opfs-probe.html                  1620 B  1.6 KB
  test/promptaction.html               12719 B  12.4 KB
  test/provide.html                     4238 B  4.1 KB
  test/realfs.html                     10788 B  10.5 KB
  test/reldemo.html                     7328 B  7.2 KB
  test/rich.html                        3794 B  3.7 KB
  test/router.html                      4288 B  4.2 KB
  test/swiper.html                      9177 B  9.0 KB
  test/tabgrid.html                    10096 B  9.9 KB
  test/textmeasure.html                 9021 B  8.8 KB
  test/transitiondemo.html             17007 B  16.6 KB
  test/v2.html                          7235 B  7.1 KB
```

**"149 / 149" 的准确含义**：149 个组件**名字**都能建出 DOM 节点（不崩、有基础标签/样式）。其中 **64 个有真实 DOM 画像**（10 手写 + 54 骨架），**85 个只落 `data-*`**（能建出来但视觉上是个 `div`）。这不等于"实现了 149 个组件"。

**诚实的能力边界**（详见 `docs/CAPABILITY.md`）：

| 维度 | 状态 |
|---|---|
| ArkTS 语法（装饰器/struct/build/控制流） | ✅ 官方产物完整覆盖 |
| 状态管理 v1（`@State/@Prop/@Link/@Provide/@Consume/@Watch`） | ✅ 有测试（`run.sh provide`） |
| 状态管理 v1 深度观测（`@Observed` + `@ObjectLink`） | ✅ 有测试（`run.sh observe`，19 条断言；含"非 `@Observed` 嵌套对象内部变更**不**触发重渲染"的负向断言） |
| 状态管理 v2（`@ComponentV2/@Local/@Param/@Once/@Event/@Monitor/@Provider/@Consumer/@ObservedV2/@Trace/@Computed`） | ✅ 有测试（`run.sh v2`，25 条断言，浏览器 + Electron 双通过） |
| v2 的已知简化 | ⚠️ `@Computed` 不缓存；`IMonitor.dirty` 每次赋值一条且 `path` 非点分路径；`@Reusable` 复用路径未实测 |
| 布局 | ✅ 有测试（`run.sh reldemo` + `run.sh measure`）：`alignRules` 六键两套键名、**多层锚链**（不动点迭代，逆序声明也对）、`Guideline`（`start`/`end` + 错轴为 0）、`bias`（含 0.5 默认值）；**仍无约束求解器**（不支持 `chainMode` 链式排列、环状锚定只记警告） |
| `Grid` / `GridItem` 轨道布局 | ✅ 有测试（`run.sh tabgrid`）：`columnsTemplate`/`rowsTemplate` 真实轨道（含 ArkUI 裸数字 vp→px 归一化）、`columnsGap`/`rowsGap`、跨行换行（几何断言） |
| `Tabs` / `TabContent` 切换 | ✅ 有测试（`run.sh tabgrid`）：`barPosition`、`index`、`TabsController.changeIndex`、`onChange`、点击 bar 切换、切走的面板不销毁 |
| `Swiper` 轮播 | ✅ 有测试（`run.sh swiper`）：`index`/`loop`（含回卷与边界停住）/`autoPlay`+`interval`/`indicator` 圆点/`SwiperController.showNext`·`showPrevious`·`changeIndex`、切走的页不销毁 |
| 虚拟滚动（含**变高列表项**） | ✅ 有测试（`run.sh lazyvh`）：偏移 = 逐项 advance 的前缀和、渲染后实测回填、`estItemH` 取已实测均值、滚动锚定、`scrollToIndex` 精确落顶、偏移模型与 DOM **逐项相等**；400 项 → 4~5 个节点 |
| **ability 结果链路**（`startAbilityForResult` + `terminateSelfWithResult`/`terminateSelf`） | ✅ 有测试（`run.sh promptaction`）：被启动方在新窗口里渲染自己的页面、`resultCode`/`want` 由 want 算出（写死会被抓）、Promise 与 AsyncCallback 两条形态、结束次序 `onWindowStageDestroy → onDestroy`、无结果结束不挂住 |
| **轻提示与对话框 `@ohos.promptAction`** | ✅ 有测试（`run.sh promptaction`）：`showToast` 的 `duration` 默认/夹取 **真的生效**（1500ms 到期消失、10000ms 仍在）、缺 `message` 同步抛 401；`showDialog` 的 DOM 节点与按钮顺序、点按钮 resolve `{index}` 并消失、`buttons` 为空响亮失败 |
| **通知 `@ohos.notificationManager`** | ✅ 有测试（`run.sh measnotify`）：`publish`/`cancel`/`cancelAll`/`isNotificationEnabled` + **回调重载**（异步、返回 `void`）；`content` 真解析（`normal`/`longText`/`multiLine`）、空 `content` 响亮失败；**三档投递路径**（`via`/`hostPermission`/`reason`）——不能确证送达就必须写出原因；Electron 侧 `hostCreated` 递增且 `permission=granted` |
| **显式动画 `animateTo`/`animateToImmediately`** | ✅ 有测试（`run.sh animdemo`）：`fn()` 的状态变更落地 **且** 被重渲染的节点带上 `transition`（duration/curve/delay 都对）；`duration:0` **不进动画**但值照变；窗口结束清掉 transition 且 `onFinish` 被调；默认 `duration=1000`；`iterations`/`playMode` 等降级**出声**；`fn()` 无可动目标时出声 |
| **手势 Pan/Tap/LongPress/Swipe/Pinch** | ✅ 有测试（`run.sh gesturedemo`）：5 个元素各挂对类型；**合成 pan 序列后 `offsetX/offsetY` 与合成位移一致**（横向 40,0 / 竖向 0,40）；`distance` 阈值、`TapGesture.count` 归组与 `repeat`、长按 `duration` 且**移动即取消**、`SwipeGesture.speed`（vp/s）与 `angle`、`PinchGesture.scale`（距离比）逐项有断言，且都有反向用例 |
| 平台模块 | ✅ 14 个：`hilog`/`app.ability.*`/`window`/`router`/`data.preferences`/`file.fs`/`net.http`/**`measure`**/**`multimedia.image`**/**`notificationManager`**/**`promptAction`**；其余（`media`/`UIContext`/…）未实现 → 调用时给可操作报错 |
| **`onAreaChange`** | ✅ 有测试（`run.sh measarea`）：回调的 `newValue.width/height` **等于真实 `getBoundingClientRect()`**、尺寸变化后再次触发且 `oldValue` 是上一次的真实值 |
| **自定义布局协议** `onMeasureSize`+`onPlaceChildren` | ✅ 有测试（`run.sh measarea`）：`Measurable.measure(constraint)` 回**真实测量**、返回的 `SizeResult` **覆盖**声明尺寸、`Layoutable.layout(position)` 真的摆放（几何断言）、收敛有上限 |
| 文本真实测量 | ✅ 有测试（`run.sh textmeasure`）：`@ohos:measure` 的 `measureText`（单行、忽略约束）/`measureTextSize`（约束宽高、`maxLines` 夹高、`lineHeight`）；**与同文本同宽度的真实 Text DOM 逐像素一致**；`__arkui_dom_countLines` 直接断言行数 |
| 持久化 | ✅ Electron 真磁盘（shell 级验证）；浏览器 `localStorage` |
| 动画 / 手势 | ❌ 未实现（`Swiper` 也无手势滑动，只有控制器/指示点/autoPlay 三条切换路径） |
| **绘制类四件套** `Progress`/`Gauge`/`DataPanel`/`Rating` | ✅ 有测试（`run.sh drawdemo`，47 条断言）：`--progress` 百分比 + 无障碍属性、进度环、`Gauge` 任意起止角/整圆/分段色/min-max、`DataPanel` 环（`conic-gradient` 累计色标）与线（几何宽度）、`Rating` 满星/半星/`onChange`/`starStyle` 告警 |
| `Navigation` 栈导航 | ✅ 有测试（`run.sh navdemo`，72 条断言）：`NavPathStack` 的 push/pop/popToName/popToIndex/replacePath/removeByName/moveToTop/clear/查询族 + `onPop` 回调、`NavDestination` 生命周期、根内容状态保留、目标销毁后 elmtId 零泄漏 |
| 85 个骨架组件的视觉语义 | ❌ 仅 `data-*` |

---

## 7. 文件职责

| 文件 | 体积 | 职责 | 改它的时机 |
|---|---|---|---|
| `runtime/arkui-dom-runtime.js` | 215.7 KB | **拼接产物**：`tools/build-runtime.mjs` 把 `runtime/src/` 的分片按 `// @include` 标记拼成（语义内容见下面两行源分片）。为什么不做成多个 `<script>`：分片共享同一个闭包（`elmtRecords`/`ViewStackProcessor`/`animWindow`…，其中 `animWindow` 还是可变绑定），且 30 个手写 HTML 与 Electron 都按固定顺序加载这一个文件 | **不手改**；改 `runtime/src/` 后 `npm run build:runtime`；`build-runtime --check` 守门（在 `npm run check` 第 3 步） |
| `runtime/src/main.js` | 192.5 KB | **手写源**（除 `transition` 一节外的全部）：v1 状态类 + 深度观测（`@Observed`/`@ObjectLink`）、`ViewPU`/`ViewV2`、装饰器层、组件栈、布局（`alignRules` 多层锚链 + `Guideline` + `bias`、`Grid` 轨道）、`Tabs`/`TabContent`+`TabsController`、`Swiper`+`SwiperController`、`Navigation`/`NavDestination`+`NavPathStack`、**绘制类四件套**（SVG/CSS）、`LazyForEach`、路由、**ability 栈**（`startAbilityForResult`/`terminateSelf*`）、**显式动画**（`Context.animateTo` → CSS transition）、**手势**（两层栈 + pointer 识别器 + `GestureGroup` 三态 + 元素级优先级仲裁） | 实现新语义（**手写优先**） |
| `runtime/src/transition.js` | 23.2 KB | **手写源**：出现/消失过渡一节（`TransitionOptions` / `TransitionEffect` / `TransitionType` 方向门控 / `detachChildren` 延迟摘除） | 改过渡语义 |
| `runtime/generated-components.js` | 56.3 KB | 149 个组件骨架（**生成物**） | **不手改**；改 `tools/gen-components.mjs` 后重新生成，`--check` 会守门 |
| `runtime/ohos-shims.js` | 56.4 KB | `@ohos:*` 模块（14 个，含 **`measure`**/**`multimedia.image`**/**`notificationManager`**/**`promptAction`**）+ 持久化后端（含 R21 的探测与自报）+ 文本/图像测量原语 | 新增平台模块 |
| `tools/extract.mjs` | 6.4 KB | hvigor 缓存 `.ts` → 可执行 `.js`；**装饰器作用域内绑定前奏 + 未就绪守卫**（§3.4） | 产物形态/装饰器集合变化时 |
| `tools/gen-components.mjs` | 7.6 KB | ets-loader 组件 JSON → 骨架注册表（`--check` 只校验不写） | 组件元数据/画像规则更新时 |
| `tools/build-runtime.mjs` | 5.0 KB | `runtime/src/` 分片 → `runtime/arkui-dom-runtime.js`（`--check` 只校验不写；孤儿分片/成环/漏展开都报错） | 分片布局变化时 |
| `tools/serve.py` | 3.8 KB | 静态服务（含显式图片 MIME + **禁用缓存头**，见坑表 76）+ `/echo` + `/slow`（测超时） | 需要新测试端点/资产类型时 |
| `tools/stats.mjs` | 13.7 KB | 本文档所有数字的来源（`--json` 机器可读）；**`--check-doc`/`--write-doc` 守 §6 引用块** | 覆盖范围变化时 |
| `tools/assert-counts.mjs` | 7.3 KB | 断言计数守门（运行期 emit 的 PASS 行 ↔ 文档声明的「N 条断言」，见坑表 77） | 声明写法/扫描范围变化时 |
| `tools/preflight.mjs` | 5.3 KB | 环境自检（工具链/宿主/可执行位） | 外部依赖变化时 |
| `tools/check-all.sh` | 3.6 KB | 一条命令做完验收（6 步），退出码只看被调命令 | 新增验收步骤时 |
| `run.sh` | 16.0 KB | 浏览器 31 用例驱动 | 新增用例 |
| `electron/run.sh` | 10.4 KB | Electron 30 用例 + 磁盘验证 | 新增用例 |
| `electron/main.js` | 6.6 KB | 主进程：offscreen 截图、**像素级**空白检测 | 截图/验证策略变化时 |
| `electron/preload.js` | 1.9 KB | `contextBridge` 暴露 Node fs | 宿主能力变化时 |
| `fixtures/pages/*.ts` | 229.9 KB | **冻结的**官方转换产物（29 个，含 `V2.ts`/`Observe.ts`/`TabsGrid.ts`/`SwiperDemo.ts`/`NavDemo.ts`/`RelDemo.ts`/`DrawDemo.ts`/`TextMeasure.ts`/`LazyVar.ts`/`MeasArea.ts`/`MeasImage.ts`/`MeasNotify.ts`/`PromptAct.ts`/`Callee.ts`/`AnimDemo.ts`/`GestureDemo.ts`/`TransitionDemo.ts`/`GestureGroupDemo.ts`），另有 `fixtures/entryability/*.ts`（`EntryAbility.ts`/`PromptAbility.ts`，6.5 KB） | 几乎不改（见不变量 5） |
| `test/*.html` | 239.3 KB | 断言页（31 个；读 `#result` 节点文本） | 新增用例 |
| `test-assets/*` | 1.1 KB | **已知尺寸的测试图片**（PNG/JPEG/伪装文件）。必须进仓库——放 `/tmp` 会在重启后失效（R5 的教训） | 需要新资产时 |

---

## 8. 相关文档

- `docs/CAPABILITY.md` —— 能力矩阵与已知限制（面向使用者）
- `docs/DEVELOPING.md` —— 开发指南：怎么加组件、加模块、加用例，以及**踩过的坑**
- `docs/ROADMAP.md` —— 原子任务清单，每项带验收命令
- `docs/SESSION-2026-09-20.md` —— **一次会话的快照归档**（逐提交表、方法论沉淀、犯过的错、交接须知）。
  非权威状态：持续状态看 ROADMAP/CAPABILITY
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
