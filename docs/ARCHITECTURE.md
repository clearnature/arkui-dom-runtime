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
  global 导出        103 个
  状态类            ObservedPropertySimplePU ObservedPropertyObjectPU SynchedPropertySimpleOneWayPU SynchedPropertySimpleTwoWayPU SynchedPropertyNesedObjectPU
  内置组件          Text Button Column Row Stack List ListItem If ForEach LazyForEach RelativeContainer Tabs TabContent Swiper Navigation NavDestination Progress Gauge DataPanel Rating
  内部钩子 __arkui_dom_*  24 个

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
  浏览器 run.sh     20 个：index rich leak layout widgets tabgrid swiper navdemo reldemo drawdemo measure lazy provide v2 observe async ability router netfile persist
  Electron          19 个：netfile layout rich index leak ability router widgets tabgrid swiper navdemo reldemo drawdemo measure lazy provide async v2 observe
  测试页            20 个
  fixtures 转换产物  18 个：AsyncIO Detail DrawDemo Home Index Layout Lazy Measure NavDemo NetFile Observe Provide RelDemo Rich SwiperDemo TabsGrid V2 Widgets

== 体积（源码，不含产物/Electron 运行时）==
  runtime          214.2 KB
  test             121.2 KB
  tools            37.6 KB
  electron(src)    15.5 KB
  docs             154.8 KB
  fixtures         132.3 KB

== 逐文件（文档"文件职责"表的来源）==
  runtime/arkui-dom-runtime.js     138659 B  135.4 KB
  runtime/generated-components.js   57617 B  56.3 KB
  runtime/ohos-shims.js             23066 B  22.5 KB
  tools/extract.mjs                  6457 B  6.3 KB
  tools/gen-components.mjs           7775 B  7.6 KB
  tools/serve.py                     2559 B  2.5 KB
  tools/stats.mjs                   13385 B  13.1 KB
  tools/preflight.mjs                5108 B  5.0 KB
  tools/check-all.sh                 3171 B  3.1 KB
  run.sh                            10260 B  10.0 KB
  electron/run.sh                    6868 B  6.7 KB
  electron/main.js                   6795 B  6.6 KB
  electron/preload.js                1961 B  1.9 KB
  package.json                       1207 B  1.2 KB
  .gitignore                          674 B  0.7 KB
  README.md                         38004 B  37.1 KB
  THIRD-PARTY-NOTICES.md             8256 B  8.1 KB
  docs/ARCHITECTURE.md              67027 B  65.5 KB
  docs/CAPABILITY.md                22491 B  22.0 KB
  docs/DEVELOPING.md                30147 B  29.4 KB
  docs/ROADMAP.md                   32345 B  31.6 KB
  docs/surface-measurement.md        6496 B  6.3 KB
  fixtures/pages/AsyncIO.ts          6206 B  6.1 KB
  fixtures/pages/Detail.ts           3097 B  3.0 KB
  fixtures/pages/DrawDemo.ts        10867 B  10.6 KB
  fixtures/pages/Home.ts             3232 B  3.2 KB
  fixtures/pages/Index.ts            2737 B  2.7 KB
  fixtures/pages/Layout.ts           3434 B  3.4 KB
  fixtures/pages/Lazy.ts             4485 B  4.4 KB
  fixtures/pages/Measure.ts          6262 B  6.1 KB
  fixtures/pages/NavDemo.ts         14129 B  13.8 KB
  fixtures/pages/NetFile.ts          5039 B  4.9 KB
  fixtures/pages/Observe.ts         11906 B  11.6 KB
  fixtures/pages/Provide.ts          6731 B  6.6 KB
  fixtures/pages/RelDemo.ts          9702 B  9.5 KB
  fixtures/pages/Rich.ts             9256 B  9.0 KB
  fixtures/pages/SwiperDemo.ts       7876 B  7.7 KB
  fixtures/pages/TabsGrid.ts        10513 B  10.3 KB
  fixtures/pages/V2.ts              13447 B  13.1 KB
  fixtures/pages/Widgets.ts          4600 B  4.5 KB
  test/ability.html                  4695 B  4.6 KB
  test/async.html                    5977 B  5.8 KB
  test/components.html               5566 B  5.4 KB
  test/drawdemo.html                12765 B  12.5 KB
  test/index.html                    3560 B  3.5 KB
  test/layout.html                   4135 B  4.0 KB
  test/lazy.html                     4380 B  4.3 KB
  test/leak.html                     3921 B  3.8 KB
  test/measure.html                  6072 B  5.9 KB
  test/navdemo.html                 13765 B  13.4 KB
  test/netfile.html                  5302 B  5.2 KB
  test/observe.html                  6232 B  6.1 KB
  test/opfs-probe.html               1620 B  1.6 KB
  test/provide.html                  4238 B  4.1 KB
  test/reldemo.html                  7328 B  7.2 KB
  test/rich.html                     3794 B  3.7 KB
  test/router.html                   4288 B  4.2 KB
  test/swiper.html                   9177 B  9.0 KB
  test/tabgrid.html                 10096 B  9.9 KB
  test/v2.html                       7235 B  7.1 KB
```

**"149 / 149" 的准确含义**：149 个组件**名字**都能建出 DOM 节点（不崩、有基础标签/样式）。其中 **64 个有真实 DOM 画像**（10 手写 + 54 骨架），**85 个只落 `data-*`**（能建出来但视觉上是个 `div`）。这不等于"实现了 149 个组件"。

**诚实的能力边界**（详见 `docs/CAPABILITY.md`）：

| 维度 | 状态 |
|---|---|
| ArkTS 语法（装饰器/struct/build/控制流） | ✅ 官方产物完整覆盖 |
| 状态管理 v1（`@State/@Prop/@Link/@Provide/@Consume/@Watch`） | ✅ 有测试（`run.sh provide`） |
| 状态管理 v1 深度观测（`@Observed` + `@ObjectLink`） | ✅ 有测试（`run.sh observe`，20 条断言；含"非 `@Observed` 嵌套对象内部变更**不**触发重渲染"的负向断言） |
| 状态管理 v2（`@ComponentV2/@Local/@Param/@Once/@Event/@Monitor/@Provider/@Consumer/@ObservedV2/@Trace/@Computed`） | ✅ 有测试（`run.sh v2`，26 条断言，浏览器 + Electron 双通过） |
| v2 的已知简化 | ⚠️ `@Computed` 不缓存；`IMonitor.dirty` 每次赋值一条且 `path` 非点分路径；`@Reusable` 复用路径未实测 |
| 布局 | ✅ 有测试（`run.sh reldemo` + `run.sh measure`）：`alignRules` 六键两套键名、**多层锚链**（不动点迭代，逆序声明也对）、`Guideline`（`start`/`end` + 错轴为 0）、`bias`（含 0.5 默认值）；**仍无约束求解器**（不支持 `chainMode` 链式排列、环状锚定只记警告） |
| `Grid` / `GridItem` 轨道布局 | ✅ 有测试（`run.sh tabgrid`）：`columnsTemplate`/`rowsTemplate` 真实轨道（含 ArkUI 裸数字 vp→px 归一化）、`columnsGap`/`rowsGap`、跨行换行（几何断言） |
| `Tabs` / `TabContent` 切换 | ✅ 有测试（`run.sh tabgrid`）：`barPosition`、`index`、`TabsController.changeIndex`、`onChange`、点击 bar 切换、切走的面板不销毁 |
| `Swiper` 轮播 | ✅ 有测试（`run.sh swiper`）：`index`/`loop`（含回卷与边界停住）/`autoPlay`+`interval`/`indicator` 圆点/`SwiperController.showNext`·`showPrevious`·`changeIndex`、切走的页不销毁 |
| 虚拟滚动 | ✅ 1000 项 → 11 节点 |
| 平台模块 | ⚠️ 10 个实现了；`media`/`notification`/`startAbilityForResult` 等未实现 |
| 持久化 | ✅ Electron 真磁盘（shell 级验证）；浏览器 `localStorage` |
| 动画 / 手势 | ❌ 未实现（`Swiper` 也无手势滑动，只有控制器/指示点/autoPlay 三条切换路径） |
| **绘制类四件套** `Progress`/`Gauge`/`DataPanel`/`Rating` | ✅ 有测试（`run.sh drawdemo`，47 条断言）：`--progress` 百分比 + 无障碍属性、进度环、`Gauge` 任意起止角/整圆/分段色/min-max、`DataPanel` 环（`conic-gradient` 累计色标）与线（几何宽度）、`Rating` 满星/半星/`onChange`/`starStyle` 告警 |
| `Navigation` 栈导航 | ✅ 有测试（`run.sh navdemo`，72 条断言）：`NavPathStack` 的 push/pop/popToName/popToIndex/replacePath/removeByName/moveToTop/clear/查询族 + `onPop` 回调、`NavDestination` 生命周期、根内容状态保留、目标销毁后 elmtId 零泄漏 |
| 85 个骨架组件的视觉语义 | ❌ 仅 `data-*` |

---

## 7. 文件职责

| 文件 | 体积 | 职责 | 改它的时机 |
|---|---|---|---|
| `runtime/arkui-dom-runtime.js` | 135.4 KB | v1 状态类 + 深度观测（`@Observed`/`@ObjectLink`）、`ViewPU`/`ViewV2`、装饰器层、组件栈、布局（`alignRules` 多层锚链 + `Guideline` + `bias`、`Grid` 轨道）、`Tabs`/`TabContent`+`TabsController`、`Swiper`+`SwiperController`、`Navigation`/`NavDestination`+`NavPathStack`、**绘制类四件套**（SVG/CSS）、`LazyForEach`、路由 | 实现新语义（**手写优先**） |
| `runtime/generated-components.js` | 56.3 KB | 149 个组件骨架（**生成物**） | **不手改**；改 `tools/gen-components.mjs` 后重新生成，`--check` 会守门 |
| `runtime/ohos-shims.js` | 22.5 KB | `@ohos:*` 模块 + 持久化后端 | 新增平台模块 |
| `tools/extract.mjs` | 6.3 KB | hvigor 缓存 `.ts` → 可执行 `.js`；**装饰器作用域内绑定前奏 + 未就绪守卫**（§3.4） | 产物形态/装饰器集合变化时 |
| `tools/gen-components.mjs` | 7.6 KB | ets-loader 组件 JSON → 骨架注册表（`--check` 只校验不写） | 组件元数据/画像规则更新时 |
| `tools/serve.py` | 2.5 KB | 静态服务 + `/echo` + `/slow`（测超时） | 需要新测试端点时 |
| `tools/stats.mjs` | 13.0 KB | 本文档所有数字的来源（`--json` 机器可读）；**`--check-doc`/`--write-doc` 守 §6 引用块** | 覆盖范围变化时 |
| `tools/preflight.mjs` | 5.0 KB | 环境自检（工具链/宿主/可执行位） | 外部依赖变化时 |
| `tools/check-all.sh` | 3.1 KB | 一条命令做完验收（5 步），退出码只看被调命令 | 新增验收步骤时 |
| `run.sh` | 10.0 KB | 浏览器 20 用例驱动 | 新增用例 |
| `electron/run.sh` | 6.7 KB | Electron 19 用例 + 磁盘验证 | 新增用例 |
| `electron/main.js` | 6.6 KB | 主进程：offscreen 截图、**像素级**空白检测 | 截图/验证策略变化时 |
| `electron/preload.js` | 1.9 KB | `contextBridge` 暴露 Node fs | 宿主能力变化时 |
| `fixtures/pages/*.ts` | 132 KB | **冻结的**官方转换产物（18 个，含 `V2.ts`/`Observe.ts`/`TabsGrid.ts`/`SwiperDemo.ts`/`NavDemo.ts`/`RelDemo.ts`/`DrawDemo.ts`） | 几乎不改（见不变量 5） |
| `test/*.html` | 121 KB | 断言页（读 `#result` 节点文本） | 新增用例 |

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
