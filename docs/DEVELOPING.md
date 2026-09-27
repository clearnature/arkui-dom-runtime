# ArkUI DOM Runtime —— 开发指南

面向要**改这个运行时**的人。读完应该能独立加一个组件、加一个平台模块、加一个用例，并知道哪里会踩坑。

架构背景见 `docs/ARCHITECTURE.md`；任务清单见 `docs/ROADMAP.md`。

---

## 1. 前置条件

| 需要 | 位置 / 版本 | 说明 |
|---|---|---|
| Node | `/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools/tool/node/bin/node` | CLT 自带。`run.sh` 里硬编码了这个路径 |
| Chrome | `/opt/google/chrome/chrome` | headless 断言用 |
| Electron | `~/.cache/electron/electron-v44.2.0-linux-x64.zip`（已解压到 `electron/runtime/`） | 必须 `--no-sandbox --disable-gpu` |
| HarmonyOS CLT | `/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools` | 只用它的 `ets-loader`（含 TypeScript 4.9.5）与组件 JSON |

**不需要** HarmonyOS 工程或 `devecocli build` 就能跑测试——`fixtures/` 里冻着 11 个转换产物。只有要**新增页面**时才需要真工具链。

---

## 2. 目录约定

```
runtime/       运行时（与宿主无关）
  arkui-dom-runtime.js       ← 【拼接产物】由 tools/build-runtime.mjs 生成，不要手改
  src/                       ← 【手写源】手写语义都加这里（一个分片 = 一组相关小节）
    main.js                    其余全部（状态管理 / 布局 / 组件 / 路由 / ability 栈 …）
    animation.js               显式动画（animateTo/animateToImmediately）+ 出现/消失过渡（transition）
    gesture.js                 手势（pointer 识别器 + GestureGroup 三态 + 优先级仲裁）
  generated-components.js    ← 生成物，不要手改
  ohos-shims.js              ← 平台模块
tools/         构建/统计脚本（都是 .mjs，可直接 node 跑）
fixtures/      冻结的 ets-loader 转换产物（测试的输入）
test/          断言页（每个用例一个 .html）
electron/      Electron 宿主 + 第二套 runner
build/         产物 + Chrome profile（不要提交）
docs/          文档
```

**改运行时的标准动作**：改 `runtime/src/<分片>.js` → `npm run build:runtime` → 跑测试。
产物（`runtime/arkui-dom-runtime.js`）入库，`npm run check` 第 3 步守"产物 = 源"；
分片之间用 `// @include <分片名>` 一行做拼接点，拼接顺序就是产物里的代码顺序。
详见 `ARCHITECTURE.md` 不变量 20。


---

## 3. 快速开始

```bash
cd /data/training/cli/arkui-dom-runtime

# 全量：浏览器 13 用例
bash run.sh all

# 单用例（改哪个跑哪个）
bash run.sh layout
bash run.sh provide
bash run.sh lazy

# Electron 12 用例 + 磁盘落盘验证
bash electron/run.sh all
bash electron/run.sh persist

# 覆盖范围统计（文档里的数字都来自它）
node tools/stats.mjs
node tools/stats.mjs --json | python3 -m json.tool
```

每个用例的语义：

1. `tools/extract.mjs` 从 `fixtures/`（优先）或 hvigor 缓存取 `.ts` → 去类型 → `build/*.js`
2. `tools/serve.py` 起本地服务（OS 分配端口；持久化用例用**探测后固定**的端口）
3. headless Chrome 打开 `test/<name>.html` + `--virtual-time-budget`
4. 断言脚本读 **`#result` 节点的文本**（不是全页 `grep`——见坑 ④）
5. 通过则退出码 0；`run.sh all` 任一用例失败 → `rc=1`

---

## 4. 任务 A：新增一个组件画像

**触发场景**：某个组件现在只是个 `<div>` + `data-*`，你要让它真的像那么回事。

### 步骤

1. **先确认它是不是"手写"**。若组件名在 `runtime/src/` 的 `components` 里已存在（`Text`/`Button`/`Column`/`Row`/`Stack`/`List`/`ListItem`/`RelativeContainer`/`Tabs`/`TabContent`/`Swiper`/`Navigation`/`NavDestination`），生成骨架**会被跳过**，你必须改手写实现。
2. **判断该改哪一侧**：
   - 只需"标签或基础样式对" → 改 `tools/gen-components.mjs` 的 `CONTAINERS` / `LEAF_TAGS` / 输入类 `type` 映射，然后 `node tools/gen-components.mjs`
   - 需要**交互/布局语义**（子项挂载方式、切换、测量）→ 改 `runtime/src/main.js`（组件都在这个分片里），走 `ensureComponent(name, domFactory, contentUpdater)`；若该组件的 `create`/`pop` 形态特殊（如 `Tabs`/`TabContent`），在 `ensureComponent` 里按组件名加分支；改完 `npm run build:runtime` 重拼产物
3. **用产物验证契约**。别猜属性的调用形式：

   ```bash
   grep -n "Tabs\|TabContent" fixtures/pages/*.ts | head -20
   ```

   或直接看运行时诊断：

   ```js
   // 在 test/*.html 的控制台里
   __arkui_dom_componentNames()          // 当前注册的所有组件名
   __arkui_dom_overwrittenGlobals        // 骨架覆盖掉的浏览器同名全局（排查用）
   ```

4. **加断言**。在 `test/<page>.html` 里按 `id` 选节点（**不要** `querySelector('div')`，见坑 ⑤）：

   ```js
   const el = document.getElementById('myTabs');
   check('Tabs 是 flex 容器', getComputedStyle(el).display === 'flex');
   check('TabContent 已挂载', el.querySelectorAll('[data-arkui-comp="TabContent"]').length === 2);
   ```

5. **验收**：

   ```bash
   bash run.sh <case>            # 浏览器通过
   bash electron/run.sh <case>   # Electron 同一份 runtime 也通过
   node tools/stats.mjs          # 「有 DOM 画像」计数 +1，确认统计反映现状
   ```

### 硬约束

- **不能 `throw`**。未实现就落 `data-*`（`applyAttr` 的兜底已经保证，别绕过它）。
  若某属性**未实现但会影响版式/行为**，先记 `layoutWarnings` 再落 `data-*`（不 `return`）——静默忽略最难查。
- **`pop()` 必须与 `create()` 配平**。产物里是严格配对的；你的 `contentUpdater` 若在内部 push 了节点，只有产物会 pop——**不要**在 updater 里额外 push。
- **重渲染幂等**。`updateFunc` 第 2 次执行时节点已存在（`rec.node`），必须走复用分支，不能重复 `appendChild`。
- **自定义挂载点要自己维护两条**：打 `data-arkui-comp` 标记 + 把 `rec.parentNode` 指到真实挂载点（见不变量 15）。
- **自定义回调要抢在通用事件分支之前拦截**（见不变量 14，坑 ㉞）。
- **透传成 CSS 语法的值要归一化单位**（见不变量 16，坑 ㊱）。

---

## 5. 任务 B：新增一个 `@ohos:*` 平台模块

**触发场景**：产物里出现 `import x from "@ohos:media"`，运行时 `ohosRequire` 找不到它。

### 步骤

1. **先看产物怎么用**（`default` 还是具名、同步还是回调）：

   ```bash
   grep -n "@ohos:" fixtures/pages/*.ts | sort -u
   ```

2. **在 `runtime/ohos-shims.js` 里 `define`**：

   ```js
   define('media', {
     // 同步 API 直接返回；回调式 API 用 setTimeout(0) 保证异步语义
     createImageSource(uri) { /* ... */ },
   });
   ```

   `define` 同时接受 `@ohos:media` 和 `media`；`ohosRequire` 返回 `{ default, ...impl }`，所以 TS 的 `import x from` 和 `import { y } from` 都能工作。

3. **要落盘就走 VFS**，不要自己开文件：

   ```js
   // 正确：复用三级后端（Electron 真 fs / OPFS / localStorage）
   // fsShim 已经在模块内定义，直接调它的同步 API
   ```

4. **要访问宿主能力**（真 fs、真网络）→ **不要** `require('fs')`。走注入点：

   ```js
   const nodeFs = global.__arkui_dom_nodeFs;   // electron/preload.js 注入
   ```

5. **加一个负向断言**。已有的写法是钉一个**确定不存在**的模块名，而不是钉一个"以后会被实现"的：

   ```js
   // ✅ 永远有效
   check('未实现模块返回 undefined',
     __arkui_dom_require('@ohos:this.module.does.not.exist') === undefined);
   // ❌ 曾被 @ohos:net.http 的实现静默失效（坑 ⑨）
   ```

6. **验收**：

   ```bash
   node tools/stats.mjs | grep 平台模块     # 模块数 +1
   bash run.sh all && bash electron/run.sh all
   ```

---

## 6. 任务 C：新增一个装饰器 / 修状态观测语义

装饰器是**两代共用的一套机制**（见 `ARCHITECTURE.md` §3.4 / §3.5）：
- **v2**：`ViewV2` + 逐字段装饰器（访问器画在原型上）
- **v1**：`@Observed`（类级，用 Proxy 拦字段写入）+ `@ObjectLink`（`SynchedPropertyNesedObjectPU`）

v1 的 `@Observed` **也不挂 global**，走同一张 `__arkui_dom_decorators` 表。

### 步骤

1. **先测量产物**。新装饰器（或新版本的工具链）改了产物形态时，**不要猜**。改一个 `.ets`、构建、然后看编译产物：

   ```bash
   cd harmony-proj && timeout 560 /data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools/bin/hvigorw \
     --mode module -p product=default -p module=entry@default -p buildMode=debug assembleHap --no-daemon
   CACHE=../harmony-proj/entry/build/default/cache/default/default@CompileArkTS/esmodule/debug/entry/src/main/ets
   grep -n "__decorate\|Nesed\|ObjectLink" $CACHE/pages/*.ts
   cp $CACHE/pages/<Page>.ts fixtures/pages/
   ```

   `__decorate([X], Proto, "k", null)` 的 `key`/`desc` 形态决定了你的装饰器会收到几个参数、能不能返回改写后的描述符。**这是唯一可靠的依据。**

2. **接口形状去读 SDK 的 `.d.ts`**，不要凭印象：

   ```bash
   grep -n "interface IMonitor" -A 30 \
     /data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools/sdk/default/openharmony/ets/build-tools/ets-loader/declarations/common.d.ts
   ```

   曾经把 `IMonitor` 猜成 `{dirty: [{path,value,before,kind}]}`，被编译器当场判错。

3. **在 `runtime/src/main.js` 里实现**（装饰器层在这个分片里；改完 `npm run build:runtime`）：
   - v2 字段类装饰器 → 复用 `installV2Accessor(proto, key, kind)`
   - v1 类装饰器（`@Observed` 那类）→ 参考 `Observed`：返回一个**子类**，构造函数返回 Proxy

4. **必须同时改两处，否则静默失效**（这是本项目最容易踩的新坑）：

   | 改哪里 | 作用 |
   |---|---|
   | `runtime/src/main.js` 的 `const decorators = {...}` | 装饰器表（产物从前奏里解构它） |
   | `tools/extract.mjs` 的 `DECORATOR_NAMES` | 前奏里会绑哪些名字 |

   只改一处的话：漏在表里 → 解构得到 `undefined` → **TS 的 `__decorate` 对 falsy 装饰器是静默跳过的**，
   页面看起来正常但功能全无（前奏里的守卫会 throw，但要靠它兜住）。

5. **断言要包含"机制正确"，不只是"渲染对了"**：

   ```js
   // v2
   const intro = __arkui_dom_v2Introspect();
   check(intro.observedOf(view.constructor).includes('count'), '@Local 已装访问器');
   // v1
   check(__arkui_dom_isObserved(items[0]) === true,  '@Observed 产出了可观测代理');
   check(__arkui_dom_isObserved(items[0].child) === false, '非 @Observed 对象不是可观测的');
   ```

6. **证明断言有牙齿**（本项目的硬要求）。实现完再**临时破坏**它，确认关键断言真的会失败：

   ```bash
   cp runtime/src/main.js /tmp/main.bak.js
   # 把 Observed 改成 `return Base;` 之类，然后必须重拼产物（改的是源，跑的是产物）
   npm run build:runtime && bash run.sh observe   # 必须看到 FAIL，记下失败条数
   cp /tmp/main.bak.js runtime/src/main.js
   npm run build:runtime && md5sum /tmp/main.bak.js runtime/src/main.js   # 确认逐字节还原
   ```

   实测：破坏 `Observed` 后有 **8 条**断言失败，其中包含
   `@ObjectLink('item') 绑定到非 @Observed 对象` 的 `layoutWarnings` 诊断。
   如果破坏后**全绿**，说明断言没测到东西。
   **注意备份/还原要落在源分片上**：直接改产物（`runtime/arkui-dom-runtime.js`）也能红，
   但那条路径已经把产物带偏了 —— 还原后 `build-runtime --check` 才会告诉你漏了重拼。

7. **验收**：

   ```bash
   bash run.sh observe && bash electron/run.sh observe
   node tools/stats.mjs | sed -n '/状态管理/,/装饰器表合计/p'
   npm run check
   ```

### 硬约束

- **`@Once` 必须写成 `@Once @Param`**，否则 ArkTS 构建失败。
- **装饰器不能挂 global**。`Event` 与浏览器全局同名，挂上去会打断 `new Event('scroll')`（runtime 的 `Scroller` 和 `test/lazy.html` 都在用）。走 `__arkui_dom_decorators` + 抽取前奏。
- **类装饰器必须返回一个类**。`__decorate([Cls], Target)` 只有 2 个实参，助手把返回值当类本身用。
- **`SynchedPropertyNesedObjectPU` 的 `Nesed` 是官方拼写错误**，不要"顺手改对"——产物按这个名字引用。
- **`@Observed` 的观测边界不要扩大**：嵌套的非 `@Observed` 对象内部变更**不应**触发重渲染（有负向断言守着）。绑到非 `@Observed` 对象时要记 `layoutWarnings`，不静默。
- **回调抛错不能炸整页**。`@Monitor` 的调用已经在 `try/catch` 里并把错误记进 `layoutWarnings`，保持这个行为。
- **`@Computed` 不引入缓存**。当前实现靠"getter 体在渲染上下文里执行 ⇒ 传递依赖天然成立"来保证正确性；加缓存就必须同时实现失效逻辑，否则会出现"值对了但没重渲染"。

---

## 7. 任务 D：新增一个测试用例

1. 在 `fixtures/pages/` 放页面产物（见第 8 节如何生成）
2. 在 `test/` 建 `<name>.html`，结构照抄现有用例：
   - `<script src="../runtime/arkui-dom-runtime.js">` → `generated-components.js` → `ohos-shims.js`
   - 再引入 `../build/<name>.js`
   - 收集断言到数组，把结果写进 **`#result`** 节点
3. 在 `run.sh` 加一个 `case)` 分支（以及 `all` 里的 `run_one` 一行）
4. 需要 CommonJS/`@ohos:` 的页面传 `"--cjs --register <Id>"`
5. 需要"跨进程持久化"的用例：**两阶段 + 同一端口 + 同一 profile**（`pick_free_port` + `PERSIST_PROFILE`）

**断言写法红线**：

```js
// ✅ 只读 #result 的文本
const text = document.getElementById('result').textContent;
// ❌ 曾经永远通过：全页 DOM 里含 <script> 源码，'ALL PASS' 是里面的字符串常量
```

---

## 8. 重新生成 fixtures（需要 HarmonyOS 工具链）

只有新增/修改 `.ets` 页面时才需要。

```bash
# 1. 在仓库内的 HarmonyOS 工程里构建（页面源码 harmony-proj/entry/src/main/ets/pages/*.ets）
#    ⚠️ 本机**没有 devecocli**（那是装在 fnm v24.21.0 的 npm 全局里的第三方 CLI，现已不在；CLT 的 bin/ 下
#    只有 ohpm/hvigorw/codelinter/hstack/arktsdoc/Emulator 六个 wrapper）。用官方 hvigorw：
export DEVECO_CLI_CLT_PATH=/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools
unset DEVECO_NODE_HOME          # 必须空着才会用 CLT 自带的 node（v24.14.1）
( cd harmony-proj && "$DEVECO_CLI_CLT_PATH/bin/hvigorw" --no-daemon assembleHap )
# 实测：全量约 10s；BUILD SUCCESSFUL 即可，产物在下面的 CACHE 路径

# 2. 转换产物在 hvigor 的 cache（注意这条长路径）
CACHE=harmony-proj/entry/build/default/cache/default/default@CompileArkTS/esmodule/debug/entry/src/main/ets

# 3. 固化到 fixtures
cp $CACHE/pages/NewPage.ts fixtures/pages/
cp $CACHE/entryability/EntryAbility.ts fixtures/entryability/

# 4. 确认 extract 能处理它
node tools/extract.mjs fixtures/pages/NewPage.ts build/newpage.js --cjs --register NewPage
```

> `fixtures/` 是**冻结的官方产物快照**。改它是重写测试的输入，等于把测试变成"验证我自己写的产物"——除非工具链升级，否则不要动。

---

## 9. 调试手段

| 手段 | 用法 |
|---|---|
| 布局告警 | `global.__arkui_dom_layout_warnings` —— `@Consume` 找不到祖先、`@Watch` 挂载失败、`@Provide` 重复声明都会记在这里而**不抛异常** |
| 日志 | `global.__arkui_dom_logs` —— `@ohos:hilog` 的记录（有 `if (global.__arkui_dom_logs)` 守卫，不能在模块加载期直接引用） |
| 元素记录 | `__arkui_dom_elmtRecords` —— `elmtId → {node, updateFunc, parentNode, activeBranch, childView}`，排查重渲染/泄漏的第一现场 |
| 依赖同步 | `__arkui_dom_syncAlignRules(rootEl)` 手动重算 `alignRules` |
| 组件名 | `__arkui_dom_componentNames()` |
| 覆盖冲突 | `__arkui_dom_overwrittenGlobals` |
| **v2 装饰器自省** | `__arkui_dom_v2Introspect().observedOf(V2类)` / `.monitorsOf(...)` / `.computedOf(...)` |
| **v2 装饰器表** | `__arkui_dom_decorators`（产物里的绑定前奏从这里取） |
| 后端强制 | `global.__arkui_dom_force_backend = 'opfs'`；`__arkui_dom_enable_opfs = true` |
| 截图 | `electron/main.js` 用 offscreen 模式 + **像素级非白比例**判断是否真的画出来了 |

---

## 10. 已知陷阱（都真踩过）

按"改代码时最可能再犯"排序。

### 测试可信度

| # | 陷阱 | 正确做法 |
|---|---|---|
| ④ | 全页 `grep 'ALL PASS'` 会匹配到 `<script>` 里的字符串常量 → **永远通过** | 只读 `#result` 节点文本 |
| ⑤ | `querySelector('div')` 可能选中容器（`RelativeContainer` 也是 div）；`textContent` 递归会让文本断言假通过 | **按 `id` 选**具体节点 |
| ⑨ | 负向断言钉在"以后会被实现"的模块上 → 实现后静默失效 | 钉 `@ohos:this.module.does.not.exist` |
| ⑩ | 断言引用了已删除的内部符号 → `ReferenceError` | 断言**真实持久化的文件内容**，不断言内部变量 |
| ⑪ | runner 用 case 名当页面路径 → 加载 404 页（无 `#result`，断言读空串**全通过**） | 显式 `page_of()` 映射；断言前校验页面已就绪 |
| ⑱ | `img.isEmpty()` 对**纯白图**返回 false → 把"全白"报成"非空" | **像素级**非白比例 + 重试循环 |
| ⑲ | 隐藏窗口的 `capturePage()` **永不 resolve** → 进程挂死，`run.sh` 退出 124（断言其实全过） | 加超时 + offscreen 模式补帧 |
| ㊲ | **弱断言**：「第 N 个的 `display !== 'none'`」—— 在"**全都可见**"时也成立，等于没有牙齿 | 断言**不变量**：「恰好一个可见，且是第 N 个」（本轮实测：改成空操作后 3 条失败 → 加强后 4 条失败） |

### 语义正确性

| # | 陷阱 | 正确做法 |
|---|---|---|
| ⑫ | `alignRules` 六键记错：以为是 `center`=两轴居中、`middle`=不支持 | **`center`=垂直中心，`middle`=水平中心**；`ALIGN_FRAC` 要认识 `top`/`bottom`（否则 `bottom:End` 偏 100px） |
| ⑬ | 把 `Stack({alignContent})` 当属性 setter → 落进 `cssPropEnum`（CSS 的 `align-content`，语义完全不同） | `alignContent` 是 **create 选项**，走 `applyCreateArgs`；`applyAttr` 里还要**抢在 `cssPropEnum` 之前**拦掉 |
| ⑭ | `scrollToIndex` 目标是**孙节点**（`ForEach` 包裹层是 `display:contents`），且滚动容器缺 `position` 导致 `offsetTop` 基准错 | 容器 `position:relative` + 用 `data-arkui-comp` 标记定位 |
| ⑮ | `struct` 名叫 `Provide` → 与 `@Provide` 装饰器冲突：`Cannot redeclare block-scoped variable 'Provide'` | 改名（`ProvideDemo`） |
| ③ | 用 `sed -i` 改代码文件（违反自己的规则） | 用 `edit` 工具逐行精确改 |
| ㉒ | **把 `IMonitor` 的形状猜成** `{dirty:[{path,value,before,kind}]}` → ArkTS 编译器判错 `Property 'value' does not exist on type 'string'` | 去读 SDK 的 `declarations/common.d.ts`。正确形状：`dirty: string[]` + `value(path?): {before, now, path}` |
| ㉓ | **v2 装饰器想挂 global** → 会覆盖浏览器全局 `Event`，直接打断 `new Event('scroll')`（`Scroller` 与 `test/lazy.html` 都在用） | 走 `__arkui_dom_decorators` + `extract.mjs` 生成的作用域内绑定前奏 |
| ㉔ | **`@Once mode` 单独写** → 构建失败 `When a variable decorated with '@Once', it must also be decorated with '@Param'` | 写 `@Once @Param mode` |
| ㉕ | **`WeakMap` 上调 `.keys()`**（写自省函数时）→ `TypeError: v2ProtoMeta.keys is not a function` | WeakMap 不可枚举，只能按 key 查询 |
| ㉖ | **把 `string.length` 当字节数** → 生成器报告"文件比生成物长 48 字节"，其实是 banner 里中文的 UTF-16 码元 vs UTF-8 字节之差 | 报告体积用 `Buffer.byteLength(s, 'utf8')`，或直接 `fs.statSync().size` |
| ㉗ | **`pkill -f "serve.py 41891"`** → 模式匹配到了自己所在的命令行，把执行中的 shell 杀了（`Signal: 15`，命令无声中断） | 先 `ps -eo pid,args \| grep "[s]erve\.py"` 取 PID 再 `kill` |
| ㉘ | **`--check` 只在注释里声明、代码里没实现** → 加进验收清单后它其实在**覆写**生成物 | `--check` 必须做到"只比对、不落盘、不一致时非 0 退出"。加进清单前先验证失败路径 |
| ㉙ | **装饰器加进了 `extract.mjs` 的名单、却忘了加进运行时的 `decorators` 表** → 解构得到 `undefined`，而 TS 的 `__decorate` 对 falsy 装饰器**静默跳过** → `@Observed` 什么都不做，页面看起来正常 | 两处必须同改；`extract.mjs` 的前奏已加守卫，绑定到的名字不是函数就 `throw`（不变量 12） |
| ㉚ | **把 `SynchedPropertyNesedObjectPU` 的 `Nesed` 当成拼写错误改掉** → 产物按这个名字引用，直接 `ReferenceError` | 记住它是官方拼写错误，逐字保留 |
| ㉛ | **想给 V1 的 `@Observed` 装原型访问器** → V1 在**字段上没有任何装饰器**，拿不到字段名 | V1 只能用 `Proxy` 拦 `set`（V2 才有 `@Trace` 提供字段名） |
| ㉜ | **Proxy 只设了 `set` 陷阱却在 `get` 里做多余拦截**，或 `Reflect.set` 传了 proxy 当 receiver 导致递归 | 只设 `set`（其余走默认行为）；`Reflect.set(t, k, v)` 直接作用于 target |
| ㉝ | **用 `f("test")` 之类的 `statSync` 目录体积** → 得到的是目录 inode 大小（4 KB），不是递归总和 | 目录体积要递归累加；`stats.mjs` 已有 `du()` 可复用 |
| ㉞ | **把 `Tabs.onChange` 交给通用事件分支** → 变成 `addEventListener('change')`，一个**永不触发**的监听器（切换时回调不会跑，页面看着正常） | 带 `__tabsState` 的节点要在通用事件分支**之前**拦截 `onChange`，由 Tabs 收集、`setActiveTab` 时派发 |
| ㉟ | **自定义挂载点绕过 `mountNode`** → ① 漏了 `data-arkui-comp` 标记（`querySelectorAll` 返回 0，表现为"组件不存在"）② `rec.parentNode` 指错（重渲染时恢复到错误父节点，重建整棵兄弟结构） | 自己补标记；并把 `rec.parentNode` 指到真实挂载点（`TabContent` 指内容区） |
| ㊱ | **ArkUI 轨道模板的裸数字直传 CSS**：`columnsTemplate('100 1fr')` → `grid-template-columns: 100 1fr` → **整条声明作废且浏览器不报错**（表现为"Grid 完全没有列"） | 过 `normalizeTrackList`（`100`→`100px`、`50vp`→`50px`，保留 `1fr`/`auto`/`%`/`repeat()`/`minmax()`）。断言要同时看字符串**和几何** |
| ㊳ | **凭印象写 create 的签名**：我按 `Tabs({barPosition, index, controller})` 写成 `Swiper({index:0, loop:false})` → 编译器判错 `Object literal may only specify known properties, and 'index' does not exist in type 'SwiperController'`。本 SDK 的 `SwiperInterface` **只有** `(controller?: SwiperController)` 一个重载 | **别猜**：先 grep `ets/component/<comp>.d.ts` 的 `<Comp>Interface`，再真构建一次看 cache 产物。同族组件的签名可以**完全不同** |
| ㊴ | **长驻计时器跟着页面走**（`Swiper` 的 `autoPlay` 用 `setInterval`）：`router` 换页 / `clearRoot` 只删 DOM，计时器照跑 → 跨页面泄漏，还在写已卸载的节点 | 计时器回调里先查 `st.node.isConnected`，断了就 `clearInterval` 并清零句柄（自停表，不依赖外部拆卸钩子） |
| ㊵ | **给依赖计时器的行为写固定等待**：`autoPlay` 在 headless + `--virtual-time-budget` 下的推进时机不稳 | 用**轮询**（有界重试）而不是 `sleep(固定值)`；并且**连跑 3 次**确认稳定（`lazy` 踩过同样的坑） |
| ㊶ | **把"由运行时驱动的 builder"当成页面的渲染**：`Navigation` 的 `navDestination` builder 不在 `initialRender` 里，是压栈时被调的。直接 `builder(...)` 会让里面的组件挂到**错误的父节点**（当时栈顶是什么就挂到哪） | 走"**预压容器 → 调 builder → `restore()` → 校验产出 → 失败回滚**"（不变量 17）。**校验不能省**：`if/else` 没覆盖该 name 时 builder 会**静默什么都不建** |
| ㊷ | **回调登记了却永远不会被调**：`NavDestination.onBackPressed` 在本运行时没有触发源（没有系统返回键）。若只 `store` 不发声，就是最坏的一种静默 | 登记时**立刻记 `layoutWarnings`** 说明"没有触发源、请走哪条路"。**"存了不调"必须出声** |
| ㊸ | **把被拒绝的 `edit` 当成成功**：我插入一大块实现时，工具返回的是 `File … has been modified since you last read it`（**这是错误**），我误读成成功，后续编辑建立在"那块代码已存在"的假设上——直到 `grep` 发现符号全都不存在 | 大块插入后 `grep` 一次新符号名确认真的落盘（或 `node --check`）；`grep` 不到就是没写进去，别继续往下做 |
| ㊹ | **用 `getBoundingClientRect()` 断言"左上角落在锚点"**：`End`/`Bottom` 对齐会用 `translate(-100%,-100%)` 把元素推回去，**rect 已含这个位移**。于是 `b`（`offset=(40,20)`）的 rect 读出来是 `(0,0)` —— 我据此把**正确的实现**判成了错的，白查了一轮 | 位置断言读 **`offsetLeft/offsetTop`**（那也是运行时解析锚链用的坐标空间）；要验视觉就用**边缘重合**（rect vs rect，如"b 的右下角与 a 重合"），与 `measure.html` 同一套约定 |
| ㊺ | **在属性应用时就做需要邻居/尺寸才能算的事**：`alignRules` 原来在 `applyAttr` 里立刻解析，而那一刻锚点可能还没建出来（逆序声明必然如此）→ 算出错值**并且留下 4 条假警告**"找不到锚点 'x'"，把警告通道弄脏 | 只**登记**，解析推迟到渲染后的 `syncAlignRules`；需要容器尺寸的容器级属性（`guideLine`）同理 |
| ㊻ | **测量方法本身没被验证**：㊹ 那次我盯着断言红了一轮都在怀疑实现。真正的定位手段是**临时探针页**——打印真实 DOM、`querySelector` 结果、`offset*` 与 `rect` 两套读数对比 | 断言集体失败且方向不明时，先写个探针把**原始事实**打出来，别在脑子里推演。探针用完删掉（别留在 `test/` 里被 runner 当用例） |
| ㊼ | **一处断言抛异常会吞掉后面所有断言**：测试体是一个大 `try`，`endpts[2]` 取到 undefined 抛错后，**DataPanel 与 Rating 的破坏完全没被观察到**——破坏验证给出了虚假的"只坏了这一处" | 用 `group(name, fn)` 把断言**分组**，每组各自 `try/catch`，抛错记为该组 FAIL，其余组照跑。**这样"破坏验证"才是完整的** |
| ㊽ | **SVG 整圆用一条 `A` 画不出来**：`Gauge` 的 `endAngle` **默认就是 360**，而起点终点重合的 arc 会被渲染成**空** —— 看着"有元素、有属性"，其实什么都没画 | 整圆必须拆成两段半圆（`sweep >= 360` 分支）。更要紧的是：**"默认情形"最容易被漏测**（我的第一版 fixture 只有半圆，等于没测这条默认路径）→ 专门加一个不设角度的 `Gauge` |
| ㊾ | **`getBoundingClientRect` 与"布局位置"混用**（见 ㊹）之外的另一半：报告里说"某断言没牙齿"时，也可能是**断言与实现恰好同值**（错轴返回 0 vs 横线自身 x=0） | 让断言取一个**区分度高的输入**（改用 `Center` 对齐 → 0 vs 150）。判据：**如果实现改坏了这条断言依然通过，它就是没牙齿的** |
| ㊿ | **中间量在最终结果里被约掉**：`measureTextSize` 只回 `width`/`height`，而 `height = 行数 × 单行高` —— 我从高度反推"行数 = 高度/单行高"，**这个算式把行数约掉了**。把"数行"改成恒返回 1 后，反推行数依然是 4、**断言全过** | **凡是被约掉的中间量，都要单独暴露再单独断言**（本项目做法：加自省钩子 `__arkui_dom_countLines`）。判据：**能不能构造一个"只破坏该中间量、最终值不变"的场景？能，就说明当前断言测不到它** |
| 51 | **对"没有显式尺寸的组件"预设它不受约束**：我断言"不设宽度的 `Text` 是单行"，实际它受**容器**约束（测试页 `#root` 320px，23 字×16px=368 > 320 必然换行）。**实现是对的、期望是错的** —— 这已是本项目第 N 次同类翻车 | 断言前先问"这个尺寸是谁给的"；没有显式尺寸时，**用元素自身的实测尺寸去自洽推算**（`可用宽度 = el.getBoundingClientRect().width`），而不是假设无限宽 |
| 52 | **含 `@ohos:` import 的用例要在测试页里加载 `runtime/ohos-shims.js`**：漏了会得到"未实现的平台模块"，容易误判成"模块没实现" | 脚本顺序固定为 `generated-components.js` → `arkui-dom-runtime.js` → `ohos-shims.js` → 业务模块；且 CJS+register 模式下**必须 `__arkui_dom_requireModule('X')`**，否则模块体（含末尾的 `registerNamedRoute`）不会执行 |
| 53 | **容器间距用 flex `gap`，但容器里还有 spacer/占位元素** → 占位元素也算一个子项，**多算一次 gap**。实测虚拟列表里"模型 offset(i)"与真实 DOM 永远差一个 gap（`item0` 的 DOM `offsetTop=2`、模型 `0`） | 间距改用「块级 + 每项 `margin-bottom`」表达（`margin` 不影响 `offsetHeight` 测量）。**凡是用 gap 的容器，都要问"里面有没有不参与内容的占位元素"** |
| 54 | **"窗口/输入没变"就早退，但输出依赖的状态变了** → 留下"旧 spacer + 新模型"的错配。实测：实测回填改了前缀，而 spacer 只在窗口变化时设过一次 → 整个窗口偏 166px | 早退条件必须覆盖**所有影响输出的状态**；对"派生输出"（spacer 高度这类）宁可**每次重设**（设成同值是 no-op），也别只在某个分支里设一次 |
| 55 | **派生量算得太早**：锚定补偿量 `delta = 新偏移 - 旧偏移` 在"更新估计值"**之前**取好，之后估计值又改了前缀 → 补偿少算一截（`scrollToIndex` 目标偏 10px） | 顺序固定为：**把所有会改状态的写法都落地 → 再取派生量 → 再补偿**。中间量一旦被后续写入影响，就必须放在最后算 |
| 56 | **混淆"渲染空间序号"与"数据空间索引"**：虚拟列表里 `querySelectorAll(ListItem)` 拿到的是**当前窗口**的渲染项，`items[i]` 是"窗口内第 i 个"，对应数据索引是 `window[0] + i`。实测 `scrollToIndex(0)` 因此跳到了 100 段 | 凡是有"窗口/分页/过滤"的列表，**下标一律换算到数据空间再用**；问自己"这个下标是相对谁的？" |
| 57 | **`scrollHeight` 被当成内容高度**：内容比视口矮时它被钳到 `clientHeight`（DOM 语义，不是 bug） | 断言用 `max(clientHeight, 内容高度)`；内容高度取"末项 `offsetTop` + 末项 `offsetHeight`"，**别去建模 gap/行盒** |
| 58 | **用例名与页面文件名不一致**（`lazyvh` vs `lazyvar.html`）→ Electron runner 去加载不存在的 `test/lazyvh.html`，404 页没有 `#result`，断言读到**空串**，表现为"页面没输出"而不是报错 | 名字不同的必须登记进 `electron/run.sh` 的 `page_of()`。**这是本项目第二次踩**（第一次是 `widgets`→`components`）→ 以后**用例名直接取页面名**，能不映射就不映射 |
| 59 | **把"编译器合成的组件名"当成不存在**：`KidLayout().id('x')` 会被 emit 成 `__Common__.create(true); …; __Common__.pop();` —— `__Common__` **不在 149 组件注册表**里，运行时不给它定义就 `ReferenceError` | 实现任何"给自定义组件加链式属性"的页面时，**先把产物 grep 一遍合成名**（`grep -o '__[A-Za-z]*__'`）；合成名与注册表无关，得单独实现 |
| 60 | **以为"多子项 build"哪儿都能用**：编译器明确拒绝 —— `@Entry` 的 build **只能有一个【容器】根节点**（原话："can have only one root node, which must be a container component"）。我为自定义布局写了两版 build 都被拒 | 自定义布局的"多子项 builder 模式"**只适用于嵌套 `@Component`**。**先测一次再写实现**：10 秒的构建能省掉一轮错误设计 |
| 61 | **测试解析"被测页面输出"时凭 token 猜格式**：页面把回调参数拼成 `A\|120x30\|`，我却按"某个 token 以 A 开头且含 x"去找 → 找不到，**一度以为回调没传值**（实际数字完全正确） | 断言前先看**原始输出**（把 `RAWLOG` 打进结果里）；解析用正则整体匹配，不要 `split` 后再猜哪一段是什么。**"看着像坏了"和"真的坏了"要分得开** |
| 62 | **断言的"错误实现"也可能碰巧得到正确值**：`mimeType` 的断言写成"PNG → `image/png`"，于是把 `mimeType` **写死成 `image/png` 也照样通过** —— 断言等于没测 | **造一个能让错误实现暴露的输入**：加一张真 JPEG（写死 png 会失败）、加一张**伪装文件**（PNG 字节 + `.jpg` 扩展名；用响应头代替真嗅探会失败）。判据同 ㊾：**"把实现改坏"必须真的红** |
| 63 | **`serve.py` 按扩展名给 MIME，没登记的扩展名退化成 `application/octet-stream`** → 任何对 `Content-Type` 的断言都会失去意义（且看起来"通过了"） | 需要新资产类型时**先在 `extensions_map` 里显式登记**；测试资产要**进仓库**（`test-assets/`），别放 `/tmp`（重启即失效，R5 的教训） |
| 64 | **把"三档状态"压成两档**：通知的投递路径只有"走了宿主 API / 没走"两档时，`permission='default'`（**未授权**）也会落进"走了宿主"——而浏览器在这个状态下 `new Notification()` **照样成功**（不抛错、也没被拒），于是"对象建了但不会弹出"被当成"已送达"。这正是"看起来发了" | 状态分解要到**能区分"确证"与"未确证"**：加 `hostPermission`，并把不变量写成**"只有 `granted` + 走了宿主才算送达，其余必须给出 `reason`"**，再用一条断言直接守这个不变量（破坏验证里注入"`via` 说走了宿主但 `reason` 留空"的谎报实现，被它抓住）。**判据：任何"降级/未确证"的路径，都必须能说出"降到了哪一档、为什么"** |
| 65 | **回调重载实现成同步触发**：`publish(req, cb)` 直接 `cb(okRes(), run())`，看起来"更快更简单"，但真实 `AsyncCallback` 是**异步**语义。调用方若依赖"回调晚于后续同步代码"，会写出时序上不成立的逻辑，而测试**照样全绿**（因为断言只看了回调内容） | 回调路径统一走 `Promise.resolve().then(...)`，并**专门断言"不在调用栈内同步触发"**，同时断言该重载**返回 `undefined`**（对应 `.d.ts` 的 `void` 重载，而非返回 Promise）。**凡是对外暴露的"回调版 API"，都要问一句：它在调用栈里跑还是在微任务里跑？** |
| 66 | **把"可复现的输入"放在 `/tmp`**：HarmonyOS 工程原本在 `/tmp/hmtest/app`，机器重启后（tmpfs）**整个工程消失** —— fixture 变成"没人能再生出来"的产物，而测试还在绿（因为 fixtures 是快照） | 输入源要**进仓库**：`devecocli create` 的工程落在 `harmony-proj/`（`.ets` 页面源码随代码走；构建输出 `entry/build/`、`oh_modules/` 进 `.gitignore`），`run.sh` 的 `CACHE` 与缺输入提示都指向它。**判据：换一台机器 clone 之后，能不能不靠任何外部残留就重新生成 fixtures？** |
| 67 | **拿"待办清单里的前提"当事实**：R20 原文要断言"`startAbilityForResult` 的 `onResult` 被调用"——`onAbilityResult` 在 API 26 SDK 里**根本不存在**（`grep` 0 命中）；同一条还写"`startAbility` 已实现"（其实没实现）。真按它写断言，只会写出一条**永远不触发**的等待 | 动手前先**在产物与 `.d.ts` 里核实待办描述里的每个 API 名与"已实现"**；不符就**改验收标准并在文档里写明"原前提错在哪、实测是什么"**，而不是硬凑实现。本项目已发生 3 次（R17 `onMeasureSize` 不是尺寸回调、R18 模块名 `@ohos:media` → `@ohos.multimedia.image`、R20 本条目） |
| 68 | **用 `document.body.textContent` 断言"文档里不再有 X"**：`textContent` **包含 `<script>` 里的字面量**，而断言文案本身常常就写着那句 X → 断言**永远命中**（换句话说是永远红）。这是不变量 6（"不能 grep 文本"）的 DOM 版，同一个坑换了层皮 | 断言 DOM 文本前**先排除 `SCRIPT` 节点**（`[...body.children].filter(n => n.tagName !== 'SCRIPT')`），或改成查具体的 `data-arkui-*` 节点。**判据同不变量 6：这条断言失败过吗？如果改动实现它依然"通过"，它是没牙齿的** |
| 69 | **脚本化批量替换"静默不生效"**：用脚本对文件做多处字符串替换时，某个 key 没匹配上**不会报错、也不会少写一行**，只是**什么都没改**（本次就漏掉一处 `用法:` 行）。后面靠"数一下替换次数"才发现 | 项目规矩是用 `edit` **逐处精确改**（原因见本表与 `docs/DEVELOPING.md` 的编辑纪律）；万不得已用脚本时，**必须回读并计数**（`grep -c`）确认每处都真的落地 |
| 70 | **"不像真路径"这种否定式断言没有牙齿**：R21 要断言"非文件系统后端不冒充真路径"，写成 `!p.startsWith('/')` —— 破坏验证时把 `realPath` 换成 `() => 'B5: 骗你一个真路径'`，**断言照样通过**（换个字符串就蒙过去了）。否定式断言只能排除"你想到的那一种错法" | 把断言改成**要求正面证据**：非 OS 可见后端必须**明确声明**（`opfs://` scheme 或"无真实路径"字样）。**判据：把实现换成"任意一个瞎编的值"，这条断言还会过吗？** 会过就说明它只在防一种写法 |
| 71 | **"有界"要连清理一起管**：给异步探测的每一步加了超时，却把失败路径的**清理**写成 `await cleanup()`，而清理里那个调用正是"永不 resolve"的那个 → 探测耗时从 200ms 变成 2172ms（实测）。这类 bug 不报错、不失败，只是**变慢/挂住** | 任何"超时保护"都要覆盖**整条路径**（含 finally/清理/善后）；清理本身也要带超时或不 await。**判据：把最坏情况（调用永不返回）走一遍，整段代码还在预算内吗？** |
| 72 | **把"真实路径"喂回只接受虚拟路径的 API**：`__arkui_dom_nodeFs.existsSync(p)` 收的是 **vfs 路径**（preload 里 `toReal()` 会把 `/vfs/...` 映射到真实目录）；我传了 `realPathOf()` 返回的**真实路径**，于是被**再映射一次** → 恒为 `false`。断言因此红，而文件其实好好地躺在磁盘上 | 用"外部核验"时必须先确认那个 API 的**入参空间**（虚拟路径 or 真实路径）。判据：**这个函数的参数是谁的坐标系？** 本项目已有同类坑（渲染空间序号 vs 数据空间索引，见 56） |
| 73 | **按源码里的名字去实现，忽略编译器把它换了名字**：源码写的是**全局** `animateTo(...)`，产物里却是 **`Context.animateTo(...)`**（`Context` 是自由变量）。只挂裸名 `animateTo` → 点击时 `ReferenceError`。同类：`Curve`/`PlayMode` 也是自由变量 | **凡是"框架级全局"，都先在产物里 grep 一次它长什么样**（`grep -n 'animateTo\|Curve' build/xxx.js`）。本项目已有先例：`__Common__`（59）、`Context.animateTo`（本条）。判据：**我的实现是按【产物】写的，还是按【我以为的源码】写的？** |
| 74 | **动画/时序类断言的两个隐蔽坑**：① **查错元素** —— `animateTo` 只动画"真的被重渲染的节点"，我断言 `box` 的 transition，而那次状态变更只影响另一个 Text → **断言假通过**；② **隔一个 tick 再查** —— 错误实现也会在计时器到点后清掉痕迹，`await tick(30)` 再查就成了**竞态**（正确/错误都可能过） | ① 判据改成"**没有任何**节点被标记"（对 duration:0）或"被标记的那个节点"（对 delay）；② 必须在**调用返回的同一 tick 内**读同步效果。**判据：这条断言在"错误实现"下真的红过吗？** 没红过就不算有牙齿 |
| 75 | **破坏验证注入的变异"没落在被测路径上"**：R23 想验证 `PanGesture.distance` 阈值，注入的却是"`distance` 未传时的默认值改成 0" —— 而 fixture **显式传了 `distance: 5`**，变异那条分支根本没执行 → 断言照样通过（**假阴性**，看起来"断言没牙齿"，其实是**破坏没打到**）。**注意与 74 区分：那条是断言的问题，这条是破坏的问题** | 注入变异后先问一句"**这条语句这次会执行吗？**"——最省事的判据是**变异必须让至少一条断言红**；不红时，先怀疑"变异没落在路径上"（改的是默认值分支/未使用参数/死代码），再怀疑断言没牙齿。R23 改成 `const th = 0`（真的忽略阈值）后立刻红 |
| 76 | **测量工具自己有状态（HTTP 缓存）→ 间歇性假红**：`tools/serve.py` 用的是 `SimpleHTTPRequestHandler`，它**不发任何缓存相关头** → Chromium 会启发式缓存 `runtime/*.js` 与 `build/*.js`。于是"改完 runtime 立刻跑测试"可能拿到**旧 runtime + 新测试页/模块**，报出 `Cannot read properties of undefined (reading 'create')` 这类"全局量不存在"的错误；**单独重跑又全绿**（实测：electron 全矩阵里 gesturedemo 偶发失败，`electron/run.sh all` 重跑 28/28 通过） | 静态服务在 `end_headers()` 里统一加 `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` + `Pragma`/`Expires`（**必须放 `end_headers`**：静态文件走 `send_head()`，不经过自定义的 `_send`）。验证：`curl -sI <url> \| grep -i cache-control`。**判据：测量工具本身必须无状态 —— 任何"上次运行的残留会影响这次结果"都是 bug，不是抖动** |
| 77 | **文档里手写的"（N 条断言）"没有守卫 → 悄悄漂移**：已发生两次 —— R22 animdemo 记成 35、实际 **36**；v2 记成 26、实际 **25**；observe 记成 20、实际 **19**（后两处于 2026-09-21 由新加的守门查出，跨 README/ROADMAP/ARCHITECTURE **3 个文件共 7 处**）。更隐蔽的是**想用静态计数去守门本身是错的**：`grep -c 'check(' test/realfs.html` 得 28，而两端各只**执行** 21 条 —— 差的 7 处在**互斥分支**里（浏览器走 `localStorage` 那支、Electron 走 `node-fs` 那支），静态计数会把"没跑到的断言"也算上 | 数字的**唯一权威是运行期 emit 的 PASS 行**：`run.sh` / `electron/run.sh` 在 `run_one` 里落盘 `build/assert-counts-<端>.tsv`，退出时 `tools/assert-counts.mjs` 与文档声明比对（**EXIT trap** 触发，所以单用例也受守门）。文档声明只有两种**规范写法**能被守住：① 同行写 `bash run.sh <用例>` …（N 条断言…）；② 围栏块内先出现 `run.sh <用例>`，块内随后的「（N 条断言）」归它；数字必须**紧跟在** `（ ( ， , *` 之后（"被 5 条断言抓住"这类散文因此不会被误判）；「条断言失败/条红」是破坏验证的失败数、自动跳过。**判据：这个数字是"跑出来的"还是"抄进去的"？抄的就必须有守卫** |
| 78 | **属性规格"晚于挂载"才到 → 挂载点的钩子永远看不到它**：实现 `transition` 的"出现动画"时，我把钩子写进 `mountNode`（节点挂上 DOM 的瞬间）—— 但实测产物顺序是 `Text.create('A') → Text.id('a') → Text.transition(…)`，即**规格是在挂载之后才通过属性调用传进来的**。于是初次渲染的 4 个节点一个都没跑出现动画（断言当场抓到：`enter:a` 等记录全缺）。更阴的是这种错**不会报错**，只是"动画静默不发生" | 需要属性值的钩子必须在**属性登记处**触发：`mountNode` 只打一个 `__arkuiFreshMount` 标记，由 `registerTransition` 见到标记才跑出现动画、并清掉标记（重渲染不带标记 → 不会每次重渲染都重播）。**判据：这个钩子需要的信息，在它执行的那一刻已经存在了吗？先去看一眼产物里的调用顺序** |
| 79 | **两条"不报错的静默降级"**：① 链式 API 的 `animation()` **只拷贝自己、丢掉 `combine` 出来的链** —— `.OPACITY.combine(translate(…)).animation({…})` 之后只剩 opacity，动画照跑、断言若不核对"链的形状"就完全看不出；② 从一个对象里**读错字段名**（`animWindow.curveCss` 其实在 `win.rec.curveCss` 上）→ `undefined` 赋给 `style.transitionTimingFunction` 被 CSS 静默忽略，**曲线丢了但一切正常**（回落到 `ease`） | ① 链式不可变对象要**整链深拷贝**（`_deepCopy()` 同时用于 `animation()` 与 `combine()`），并且**断言要核对链的形状**（本项目断言里直接看 `#b …/opacity+translate` 这种 summary），不能只看"动了没有"；② 跨对象取值时**先确认字段在谁身上**（打印一次对象，或读一眼创建处），并让自省把取值结果写出来（本次把 `curve`/`curveCss` 都记进 run 记录，曲线一丢断言就红）。**判据：这条信息的缺失会以什么形式暴露出来？如果答案是"什么都不发生"，就必须把它记进自省** |
| 80 | **文档里的"外部命令/路径"也会腐烂，而且腐烂是静默的**：`DEVELOPING.md` §8 一直写着 `cd harmony-proj && devecocli build` 来重生成 fixtures —— 而 `devecocli` 是装在 **fnm v24.21.0 的 npm 全局**里的第三方 CLI，那份 node 版本机已经不在（CLT 的 `bin/` 只有 `ohpm`/`hvigorw`/`codelinter`/`hstack`/`arktsdoc`/`Emulator` 六个 wrapper）。命令早就跑不通，**但没有任何东西会提醒** —— 直到真的需要加新页面时才撞上（R22 收口）。同一处 `run.sh` 的"缺输入提示"也抄了这条死命令 | 外部命令要么写清"它依赖什么、怎么自检"，要么改成**本仓库自带/官方自带**的形式；脚本里的提示语与文档必须**同源**（本次两处一起改成官方 `hvigorw` + `DEVECO_CLI_CLT_PATH`/`DEVECO_NODE_HOME` 两行前提）。**判据：把这条命令原样粘进终端，今天还跑得通吗？跑不通就是文档 bug，不是环境问题** |
| 81 | **"事件处理完就清状态"在冒泡场景下是错的**：手势仲裁把每个指针会话记在 `gestureSessions`（按 `pointerId`），原本在 `pointerup` 里"谁先处理谁删"。但 `pointerup` 会**继续沿祖先链冒泡** —— 最内层元素先删掉会话，外层（父子对里的父）随后处理时**查不到仲裁结论** → `arb` 退化成 `'idle'`（不 suppressed）→ 被压制的祖先**照常触发**（默认档的父子对当场红，日志里 `'e;D;'` 而不是 `'e;'`）。这类 bug 只在"多个元素都监听同一事件"时才出现，单元素用例永远看不到 | 会话只能由**冒泡路径上最后一个参战元素**来删：`isSessionTail(st, ev)` 判 `s.chain[s.chain.length-1] === st.el`（所有参战者互为祖先，所以链尾就是最后收到事件的那个）。**判据：这份状态是"这次事件处理完"就没人要了，还是"整条冒泡链处理完"才没人要？凡是跨元素共享的事件态，都要问这一句** |
| 82 | **识别器状态与"回调有没有真的发出去"脱钩 → 手势从此静默失效**：pan/pinch/rotation 的 `rs.started = true` 写在 `fireGesture(...)` **之前**。组仲裁（Sequence 的"还没轮到你"）会把回调挡掉，但状态已经推到"已开始" —— 于是一个**从没发出过 `onActionStart` 的手势变成已开始**：它的 `onActionUpdate`/`onActionEnd` 照发（Sequence 里表现为"该认的不认、不该发的 End 乱发"，日志 `U2;U1;U2e;`）。注意它与坑 79 同类：**没有任何报错** | 让 `fireGesture` **返回"有没有被仲裁放行"**，识别器只在放行时推进内部状态：`if (dist >= th && dirOk(...) && fireGesture(...)) rs.started = true;`（返回值与"回调是否存在"无关 —— 没注册回调也算放行，否则识别器行为会依赖用户写没写回调）。**判据：这个"状态推进"和那次"对外可见的副作用"必须同生共死吗？是的话，就让状态推进由副作用的返回值来背** |
| 83 | **枚举名有两套来源，`.d.ts` 不一定是产物发的那套**：`.gesture`/`.priorityGesture`/`.parallelGesture` 编译成 `Gesture.create(GesturePriority.Low\|High\|Parallel)` —— 这三个名字来自 **ets-loader 的 `pre_define.js`**（`GESTURE_ENUM_KEY`/`GESTURE_ENUM_VALUE_*`），而 `.d.ts` 里 `declare enum GesturePriority { NORMAL = 0, PRIORITY = 1 }` 是**另一套**（API 12 `addGesture` 用）。旧实现照 `.d.ts` 只定义了 `{NORMAL, PRIORITY}` → `GesturePriority.Low` 求值为 `undefined`，**三个属性在运行时完全区分不开**（都退化成默认档），而"一切照常工作"（`create(undefined)` 走了默认分支），半年都不会有人发现 | 决定"运行时该提供什么名字"时，**以产物为准，不以 `.d.ts` 为准**（`.d.ts` 只说"源码能写什么"，产物说"运行时必须有什么"）；拿不准就去 `ets-loader/lib/pre_define.js` 里 grep 那个 `GESTURE_ENUM_KEY`/`gestureMap`；**两套名字都提供并让它们同值对齐**（`NORMAL=Low`、`PRIORITY=High`），再用断言把"同值"钉住。**判据：这个标识符是"源码里写的"还是"编译器生成的"？生成的那类，名字由生成器决定，`.d.ts` 无权作证** |
| 84 | **机械切片重组：`split('\n')` + `join('\n')` 会吞掉末尾空行的"终止换行"**。把 runtime 的 transition 一节切成分片（447 行）时，切片末尾元素是 `''`（那一行是空行），`join('\n')` 把它还原成"前一行 + `\n`"——**少了一个 `\n`**，产物 220,898 B 而拆分前是 220,899 B。更阴的是**我第一次的"自证"是循环的**：自证脚本拿 `runtime/arkui-dom-runtime.js` 当原文，而这个文件已经被上一次失败构建覆盖成 220,898 B 了 → 自证"通过"，结论是假的（第三层：`md5sum -c` 才是唯一裁断，它当场报了 FAILED） | ① 机械切片一律**按文本整段替换**（`content.replace(标记行含换行, 分片原文)`），不要按行数组拼；分片文件必须**以换行结尾**，脚本对它做断言。② **拆分类重构的验收判据只有一条：与拆分前逐字节一致**（`md5sum -c` / `diff -q`），"自证脚本说通过"不算。③ 自证的**输入必须是未被污染的原文** —— 先 `cp` 一份到 `/tmp` 并以它为输入，再动手；否则你验证的是自己刚写坏的东西。**判据：我现在拿来做基准的这份文件，凭什么认为它是对的？** |

| 85 | **builder 产物不一定是你以为的"直接子节点"**：`PageMap` 这类 `navDestination` builder 里的 `if/else`，编译后会生成 `If` 包装层（`display:contents`）——每个 `if` 分支一层。`navBuildDest` 原来用 `area.lastElementChild` 认领"刚建出来的目的地"，遇到带 `if` 的 builder 拿到的是 `If` 元素 → 判成"没建出来"→ **把栈项回滚掉**。结果是：目的地节点在页面上看得见，栈却是空的，push 再点返回键就再也回不去。旧的 NavDemo 恰好没有 `if` 分支，这个坑埋了三代版本 | ① 认领"刚建出来的东西"用**标记**而不是位置：建之前把已有的标记清掉、建的时候打 `__arkuiNavNew = true`、建完找带标记的那个（`querySelectorAll` + `find`），对"孙子辈"天然免疫；② 同理，"在不在某个容器里"要**向上找祖先**，不能只看 `parentElement`；③ 测量页要故意用**会让结构变复杂的写法**（多个 `if` 分支）——旧的测量页写得太"乖"，等于替实现掩盖了它对结构的假设。**判据：这段代码依赖"X 是 Y 的直接子节点/最后一个子节点"吗？builder 产物没有这种保证** |

| 86 | **属性分发里"通用 `on*` 事件规则"会抢走组件的事件类属性**：`.onTitleModeChange(cb)` 的产物是 `Navigation.onTitleModeChange((m) => …)` —— 函数值属性。而 `applyAttr` 的分发顺序是「NavDestination 生命周期 → **通用规则：函数值 = `prop.replace(/^on/,'').toLowerCase()` 加 DOM 监听** → 组件属性表」；`onTitleModeChange` 在组件属性表（`NAV_ATTRS`）里，但根本轮不到它查 —— cb 被挂成 `addEventListener('titlemodechange')`，**永远没人派发**，而"属性应用成功"没有任何征兆（R25 首跑 48 条里 3 条红，红的全是回调没发） | 组件的**事件类属性必须在通用 `on*` 规则之前**拦下（`NAVDEST_LIFECYCLE` 就是这么活的，`onTitleModeChange` 照抄）；每加一个"由运行时派发而非 DOM 事件"的回调，先在分发函数里确认它走得通。**判据：这个属性是函数值吗？它该由谁派发——DOM 事件，还是运行时状态机？后者就必须绕开通用规则** |
| 87 | **`@State` 写了 ≠ DOM 已经变了**：`onTitleModeChange` 的回调里 `this.log = this.log + 'TMC2;'`，回调发完立刻 `txt('tmc-log')` 读到的是**旧字符串**——状态写入到 `Text` 重渲染之间隔着批量渲染调度。首版测试三条回调断言全红，红因不是回调没发（后续断言证明 log 确实在涨），而是**读得太早**。它与坑 ⑧ 同族：都是"驱动何时生效"的时序假设 | 测断言读的是**渲染结果**（DOM 文本/样式）还是**同步几何**（`syncOneNav` 直写 style 的）？前者断言前 `await tick()`，后者可以立即读。**判据：我读的这个值走没走"状态 → 批量重渲染"这条异步链？走了就必须 tick** |

| 88 | **事件类属性的重复注册：重渲染会把 `.onChange(cb)` 再应用一遍，追加语义下监听器每轮翻倍**。`@State` 每变一次 → `updateDirtyElements` 重放组件的属性应用 → `applyAttr('onChange', cb)` 又跑一次 → `addEventListener` 追加。inputdemo 首跑当场抓住：点一次 ck2 回调发两次、日志 `CK[object Event];`（连同另一个问题：通用规则把 DOM Event **原样**传给 cb，而 ArkUI 的签名是 `(isOn: boolean)`）。这类 bug 在"注册一次、不重渲染"的旧测试里**永远看不到**——它只在"注册之后状态又变过"的页面上发作 | ① 同属性同事件改**覆盖语义**（`__arkuiEv[ev]` 记住上一个，`removeEventListener` 后再加）——与真框架"属性 setter 覆盖"一致；② 包装回调带 **target 校验**（实测 rd 的包装器会被错挂到 tg1/sl1 上，change 目标不是自己就不触发）；③ 不在通用规则里的特殊签名（Slider 的 `(value, mode)`）必须在通用规则**之前**拦截并自己包参。**判据：这个回调注册一次会跑几次？把"注册路径"和"触发路径"分开各断言一次** |

| 89 | **测试的轮询上限会吃掉虚拟时间预算：破坏态"0 红、用例直接挂"，红条数根本落不了盘**。showdemo 的破坏验证首轮：分派短路后两个 `waitLog` 轮询各走满 6s，而 `run_one` 的 chrome 用 `--virtual-time-budget=8000`——测试被拖过预算，dump 发生在 `running…` 中途，**一条断言都没打出来**（不是断言没牙齿，是没机会开花）。绿态不受影响（轮询早早命中），所以这套测试平时全绿、破坏时"假死"，两类失败模式混在一起 | 轮询上限必须**小于"虚拟时间预算 − 前置耗时"**：预算 8000ms、前置 ~500ms，轮询上限 ≤ 3500ms × 2。绿态断言在预算内自然完成；破坏态轮询走满也在预算内，红条数完整现形。**判据：破坏态下这个测试的虚拟耗时是多少？超过预算就是测试自己把"失败证据"吃掉了** |
| 90 | **破坏验证的"破坏态"跨测试轮次持有**：R37 里破坏验证做到一半被打断，`return; // BROKEN-1` 短路留在了 `fireNext` 里，**之后好几轮测试全在破坏态下跑**——派发断言全空，被误诊成"合成 click 在 headless 下不稳定"，一度把派发断言从测试里删掉（等于给破坏态的产物写了测试并录成基线）。破坏验证是"改坏 → 当场数红 → 当场恢复 → md5 核对"的一次性闭环，**任何一步被打断，恢复前不许跑其他测试、更不许改测试** | 中断恢复的第一件事：`grep -n "BROKEN\|DBG-\|TODO 调试后删" runtime/src/*.js` 清残留，md5 对基线，重跑绿态，再继续。**判据：这段"不稳定"的时段里，源码 md5 和基线一致吗？不一致就是在给破坏态写测试** |
| 91 | **分派分支嵌进兄弟组件的条件块 → 静默死分支**：R37 的 `STEP_ATTRS` 分支一度落在 `if (node.__arkuiInput) {…}` 块**内部**——语法有效、构建通过、不报任何错，但 Stepper 根上没有 `__arkuiInput`，分支**永不到达**，五个事件回调全部登记不上。靠注册面断言（`typeof cbs.change === 'function'`）才现形 | 新的分派分支要放在与兄弟分支**同级**的位置（`area.js` 的分发链是平的）；断言必须"**先证注册、再证派发**"两条都有——只测派发时，死分支和"没实现"在现象上分不开。**判据：这个分支对哪个身份标记（`__arkui*`）求值？那个标记真会出现在目标组件的根元素上吗？** |
| 92 | **`x = x || {}` 惯用法在 tsc --checkJs 下类型坍缩成 `{}`**：TS 4.9 把赋值表达式 `(a = a || {})` 的类型建模成 RHS（`any \|\| {}` → `{}`），于是所有 `(el.__cbs = el.__cbs || {}).onChange = v` 这类"惰性初始化回调袋"全报 Property does not exist——运行时完全正确，纯类型层冤案（R38 类型化 211 错里一大截都是它） | 用行内 JSDoc 断言包住赋值表达式：`(/** @type {any} */ (el.__cbs = el.__cbs \|\| {})).onChange = v`——纯注释零运行时改动；别为类型改写运行时结构。**判据：修类型错误时，运行时字节必须一个不动（JSDoc/括号除外），动了就说明修错了层** |
| 93 | **对象字面量"属性位置"的 JSDoc `@type` 在 TS 4.9 不生效**：`{ created: 0, history: [] }` 想给 history 标注，写成 `{ created: 0, /** @type {any[]} */ history: [] }`——tsc 静默忽略，数组照旧 never[]（ability 统计袋实测）。同样，"只标注紧随其后一个属性"的写法会让人误以为整段都标了 | 状态袋要标就**整袋收**：`const st = /** @type {any} */ ({ ... })`；逐字段的精确类型留给真正的接口（`runtime.d.ts` 的 Element 合并）。**判据：标注后重跑 typecheck，错误数没降就是标注没生效——不要相信"写了就算标了"** |
| 94 | **`.d.ts` JSDoc 只给签名，不给时序**：R37 的 Stepper"每条都符合 JSDoc"，但事件顺序（真机先 onChange 后 onNext）、切页行为（Skip 页只发 onSkip 不切页、末页 onFinish 不切页）、边界态分流（Waiting/Disabled 点击整体忽略）全部与真机相反或缺失——JSDoc 里一个字都没写这些。**签名对 ≠ 语义对** | 事件类组件的时序以真机 pattern 源码为权威：`/data/work/compiler/Ark/arkui_ace_engine/frameworks/core/components_ng/pattern/<组件>/`（`Handling*ClickEvent` / `Fire*Event` 的调用点就是完整的状态机）。实现前先读，实现后把源码函数名写进文档标注出处。**判据：这条语义的出处是 JSDoc 还是 C++ 调用点？时序类问题只认后者** |
| 95 | **程序性改 `scrollTop` 会同时触发"手动同步派发"+"浏览器原生异步 scroll 事件"两遍**：R46 起的先例是 Scroller 改完 scrollTop 后手动 `dispatchEvent(new Event('scroll'))`（确定性），但真实 Chromium 对 scrollTop 变化**还会**在下一帧派发原生 scroll 事件——R46 的 ScrollDemo 没暴露是因为 onScroll 记的是**绝对偏移**（重复事件打出一模一样的 token，`includes` 断言全盲）；R53 WaterFlow 的 onScroll 记 **delta**，幽灵事件打出 `D0;` 尾巴，全串按序全等当场红 | 滚动监听器入口按 **scrollTop 恒等去重**：`if (st === lastTop) return;`（真机 FireOnScroll 的 (0,IDLE) 补发语义由 80ms 静默收口承担，不靠 delta=0 事件）。**判据：事件流断言必须至少有一条"全串按序全等"——`includes` 式断言对重复/幽灵事件全盲** |
| 96 | **同为 `setTimeout(0)` 的定时器按插入序执行——初始事件的补发定时器排在布局 flush 之前就会读到未排布几何**：WaterFlow 的 onScrollIndex/onReachStart 首帧必发（真机 itemRange_={-1,-1}/firstLayout），补发用 setTimeout(0)；首版把"初始事件"的定时器写在 `wfdSchedule()`（布局 flush）**之前**，执行序变成 init→layout，init 在普通流堆叠几何上算出 `I0,1`（应为 `I0,5`） | "补发初始事件"的定时器必须排在**最后一个会改变其读数的 flush** 之后插入；flush 内部的重试顺延（如 clientWidth=0 再排一轮）会让它跑到 init 之后——所以 flush 首轮就必须成功（挂载在 initialRender 同步完成是前提）。**判据：这两个 setTimeout 谁先插队？在代码里写出先后并让注释解释为什么** |
| 97 | **叶组件在编译产物里没有 `.pop()`**：`ImageSpan/SymbolSpan` 这类叶的 create 之后直接是兄弟的 observeComponentCreation2，框架层面栈里留着叶——后续兄弟会挂进叶内 | `ensureComponent` 的 `parentOfTop()` 对 `__arkuiLeaf` 标记自动弹出（R60 AlphabetIndexer 起）；手写叶组件建 DOM 后必须打 `__arkuiLeaf = true`。**判据：新叶组件上线后连建两个兄弟，第二个必须落在叶的父级而不是叶内** |
| 98 | **手写注册缺席时 generated 骨架静默兜底，结构断言全绿**：R67 破坏验证把 `ensureComponent('Navigator',…)` 改名，运行时照常 51/51——`registerGeneratedComponents` 对手写缺席的名字用骨架顶上（同名同 `data-arkui-comp` 的 div），存在性/容器断言无法区分真假实现 | 运行时把兜底名册暴露在 `__arkui_dom_generatedFilled`，测试断言目标组件**不在名册里**（R67 batchverify 起对 37 个批量组件生效，绊网对所有组件可用）。**判据：破坏验证红了才算数；"改名后测试仍绿"本身就是发现，不是破坏失败** |
| 99 | **TS 工厂 `createBlock(arr)` 对传入数组持活引用，事后 `arr.length = 0` 会清空已建节点**：R86 优化器全量推广把 index 页打出空守卫——`statics` 数组 push 5 条语句 → `createBlock(statics)` → `statics.length = 0` → 守卫块内部语句数组同步被清（合成节点场景实测；定制版 TS 4.9 的 `createNodeArray` 不拷贝）。此前三个性能页侥幸存活（节点来源/访问次序不同），一旦默认推广立即暴露 | 工厂入参的数组**创建后必须重绑定**（`statics = []`），禁止原地 `length = 0`；同类陷阱适用于一切 `createXxx(arr)` 后清空 arr 的写法。**判据：变换器的中间态要打印语句数自证（守卫块创建后立即读 `.statements.length`）** |
| 100 | **stats 采集正则的捕获组号会静默漂移成 "undefined" 且两端一致过守门**：R79 的 PERF6 正则 8 个组、模板串写了 `${m6[9]}` → §6 固化"（undefined 节点…"，`--check-doc` 比对"文档 vs 输出"两边同样的 undefined，守门放行 | 捕获组引用改为**具名组** `(?<rows>\d+)` + `${m.groups.rows}`；或每次改正则后立即 `node tools/stats.mjs` 目检输出有无 "undefined"。**判据：§6 里出现 "undefined" 字样即是采集断链，不是格式问题** |
| 101 | **`Int64.toString()` 在 `@C` 导出函数帧内返回头部损坏的 String**（nightly 1.3.0-alpha.20260919 实测）：`.size` 读出垃圾值 6399178、`toArray()` 越界——而字面量拼接、`String.fromUtf8(arr)` 构造的串一切正常；R98 内核 `add` 分支首跑 IndexOutOfBounds 即此因 | `@C` 函数内的数字→文本一律**手写 ASCII 转换**（除 10 取余倒填，见 kernel/cangjie/src/kernel.cj 的 `ByteBuf.int`）；字符串构造只走 `String.fromUtf8`。另外默认 `CPointer<UInt8>()` 不是 NULL 位型，`free` 前必须 `isNull()` 守卫；`dlerror()` 只能取一次，先存局部再判空。**判据：仓颉侧自打日志/断言里出现六位数"长度"即 toString 损坏，不是业务 bug** |
| 102 | **包级初始化器在 dlopen 装载的 dylib 里不跑**：包级 `let gMap = HashMap<…>()` 的全局槽是垃圾，首个 `HashMap.add` 直接 SIGSEGV（managed frame，栈顶 hash_map.cj）；而字面量默认的全局（`Bool=false`/`String=""`）与函数体内的容器构造全部正常——R99 首探针即崩在此。另外此 nightly `ArrayList.get(i)` 返回 `Option<T>` 非裸 T | dylib 内的可变全局容器一律 **`Option<容器>` 字面默认 + 首用时惰性构造**（`agentsOf()` 模式，见 kernel/cangjie/src/kernel.cj）；取值处对 `Option` 显式 `.getOrThrow()`。**判据：新全局容器第一次调用就段错误、栈顶在 std/collection——先查惰性初始化，不是并发或内存踩踏** |
| 103 | **`Semaphore`/`Monitor` 等阻塞唤醒原语不能从宿主原生线程（@C 帧内）调用**：`Semaphore.release()` 在宿主线程调返回栈损坏值（R98 坑 101 同款垃圾数 6399178 的另一来源）、首探针 `spawn{}` 从 @C 帧内直接 SIGSEGV（`handleException` at thread_common）——阻塞/唤醒涉及 cjthread 调度上下文，宿主线程没有。纯 futex 的 `Mutex` 宿主线程安全（lock/unlock/add 全过） | 嵌入模式下跨线程同步**只用 Mutex**；"生产者-消费者"唤醒改为**有界 drainer + 宿主逐调用驱动**（见坑 104 的泵模式），不走条件变量。cjthread 的拉起一律由宿主 `RunCJTask` 完成，不要从 @C 帧内 `spawn{}`。**判据：宿主线程调并发原语后返回值变成 6399178 族垃圾数或 thread_common 段错误——查线程上下文，不是数值溢出** |
| 104 | **嵌入模式（InitCJRuntime + 宿主线程）下 cjthread 只在 `RunUIScheduler` 泵的窗口里执行**：`RunCJTask` 返回非空句柄但任务不跑（loops=0），必须宿主显式 `RunUIScheduler(ms)` 才执行；且 `sleep()` 在此模式是空操作（timer 线程不跑，睡的任务永不醒）——探针 sleep(50ms) 实测每窗照转数十万圈 | 内核长任务用**有界 drainer**模式：`kernel_drain_entry` 清空 pending 队列即返回（零空闲 CPU）；宿主在每次 `kernel_call` 后置驱动（addon cjk_napi.cc 的 `drive()`：pending>0 且空闲 → RunCJTask + RunUIScheduler(2ms)）。轮询方靠反复调用自然推进。**判据：RunCJTask 句柄非空但任务纹丝不动——先泵 RunUIScheduler，不是任务没提交** |
| 105 | **状态机新增中间态时，所有按旧二值语义判断的读取方立即变谎**：R105 给作业加 state=2(claimed) 后，result 分支的 else 兜底把 in-flight 误报成 `done + value=0`——异步轮询方第 5 轮就"全部完成"（实际还在算），并行证据一度看似"内核坏了"。旧二值世界里写的读取方不会自己知道语义扩了 | 新增中间态必须**审计全部读取方**并让每个分支显式认领自己的状态值（`state==1 → done`，不写 else 兜底）；测试对"完成"的判定必须匹配全量状态字面量（`/"state":"done"/`）而非排除法。**判据：异步轮询异常提前收敛 + 结果值是零值——先查是不是 in-flight 被当成 done，不是并发 bug** |
| 108 | **多内核同名符号经 RTLD_GLOBAL 动态绑定互相劫持（R118 实测）**：C 内核 `kernel_shutdown` 内部调用 `kernel_init(NULL)`（复用初始化逻辑）——但宿主 dlopen 多内核用 `RTLD_GLOBAL`（仓颉运行时必需），全局符号表里 `kernel_init` 被**后加载的仓颉内核胜出**，C 内核里这次自引用的 PLT 调用**跳进仓颉的 kernel_init(NULL)** → `csToString(NULL)` SIGSEGV。宿主的 `dlsym(handle,…)` 是 handle 限定的（无冲突），**坑在内核自身代码的动态绑定**。R107 版不崩只因当时 shutdown 无自引用——R118 重写引入 | ①内核内部对**自身导出符号**的自引用一律提为 `static`（本地绑定不参与全局解析）：`static do_init()` 供 `kernel_init`/`kernel_shutdown` 共享；②或重命名内部函数（`kernel_do_reset`）避开导出名空间。**判据：崩溃栈在【另一个语言的内核】里、而调用方是本内核 → 查 RTLD_GLOBAL 符号劫持，不是串槽** |
| 107 | **Haskell 作业面双坑（R115 实测）**：①`writeIORef val (fibN n)` 写入的是**惰性 thunk**——fib 推迟到 result 查询时才计算，时间戳窗只剩 1µs（node 单支实测：窗 1.2µs vs 真实 12ms）；②`setNumCapabilities 8` **在 C 原生嵌入宿主下无效**（init 后当场快照=1），同一 .so 在 node/N-API 宿主下=8——宿主运行时上下文影响 GHC 能力管理，未解的嵌入差异 | ①计算结果写入前 `evaluate` 强制求值（`v <- evaluate …; writeIORef val v`）——**异步作业的时间戳/结果严格性必须显式**；②能力数用 `sys.caps` 的 `{now, atInit}` 双快照二分诊断（当场快照 vs 现场查询）；多核并行证据**断言放在 addon/node 层**（环境正常、6/6 稳定），C 层对 `now==1` 条件 SKIP 如实打印不假绿。**判据：时间戳窗比真实耗时小几个数量级 → 查 thunk 惰性；atInit<目标值 → 查宿主能力上下文** |
| 106 | **GHC 嵌入双坑（R114 实测）**：①`libHSrts`↔`libHSghc-internal` 循环引用——ghc-internal 的 `stg_*` 是数据符号（dlopen 立即解析，`RTLD_LAZY` 无效），RTS 的 `init_ghc_hs_iface` 是函数（可挂起）——**先载 ghc-internal 必然 `undefined symbol: stg_INTLIKE_closure`**；②`unsafePerformIO (newIORef …)` 内联在函数体里会被 GHC **CSE 提升成全程序共享**——所有实例抢同一个 IORef（实测 alice 的 FSM 态泄进 bob，两处断言同时错位才暴露） | ①加载序铁律：**RTS `RTLD_LAZY|GLOBAL` 先行 → ghc-internal `NOW|GLOBAL` → ghc-prim/base NOW → `hs_init(NULL,NULL)`**（宿主方案 A）；②可变状态分配**必须在 IO do 块里**（`newAgent :: String -> IO Agent`），顶层共享的只能是纯值或 `NOINLINE` 保护的唯一全局。**判据：多实例状态互相污染且与创建时序无关 → 查 CSE；`undefined symbol: stg_*` → 查加载序** |

### 确定性与时序

| # | 陷阱 | 正确做法 |
|---|---|---|
| ⑧ | rAF 在 headless 里节流**不确定** → 单跑能过、`run.sh all` 挂 | 合并调度用 `setTimeout(0)`；关键路径同步 `flush()`；测试改**轮询**而不是等固定 tick |
| ⑥ | 固定端口 + `TIME_WAIT` → 绑定失败；但改随机端口后 `localStorage` origin（含端口）变了 → 持久化用例失效 | `pick_free_port()`：**先探测再固定** |
| ⑦ | `--virtual-time-budget` 下 fetch 挂起 → 虚拟时间暂停 → abort 定时器**永不触发**，超时断言无法验证 | 浏览器侧标 **SKIP**；Electron（真定时器）严格断言 |

### 工程/环境

| # | 陷阱 | 正确做法 |
|---|---|---|
| ① | 只读 `.bashrc` 尾部就追加 → 两个冲突块，PATH 每次 `source` 线性增长 | 改配置前**读完整文件** |
| ② | `cp -f` 会**跟随符号链接** → 覆盖了 SDK 里的 `libhilog_linux.so` | 先 `rm` 链接再 `cp`；用 zip 的 sha256 校验恢复 |
| ③ | 交付脚本没 `chmod +x` → 用户 `./run.sh` 得到"权限不够" | 交付即 `chmod +x` |
| ⑰ | 只有 `ohos-shims.js` 里定义了 `logs` → 在别处直接引用会 `ReferenceError` | `if (global.__arkui_dom_logs)` 守卫 |
| ⑳ | `cjcompat` **永远退出码 0**（不管是否兼容） | CI 必须解析输出文本，不能看退出码 |
| ㉑ | 泄漏探针断言方向搞反（循环到 i=99 → 终态 count=0） | 用**逐次一致性**计数，不要断言终态 |

---

## 11. 提交前检查清单

```bash
# 1. 一条命令做完所有验收（preflight + 生成物一致 + 浏览器 + Electron）
npm run check          # 或 bash tools/check-all.sh
npm run check:quick    # 跳过 Electron

# 2. 统计与文档一致（改了覆盖范围就更新 ARCHITECTURE.md §6 的引用块）
node tools/stats.mjs

# 3. 新增/修改的脚本有可执行位（preflight 会查，这里再确认一次）
ls -l run.sh electron/run.sh tools/*.mjs tools/*.py tools/*.sh

# 4. 没改 fixtures（除非工具链升级）
git status --short fixtures/
```

**为什么成败一律看退出码、不 grep 日志**：`check-all.sh` 只依据被调命令的退出码判定。
用文本搜索判成败会把已经出现过 4 次的"假通过"重新引进来（`grep 'ALL PASS'` 匹配到 `<script>` 源码、
纯白图被判非空、404 页面读空串、负向断言被后续实现静默失效）。

**文档纪律**：`ARCHITECTURE.md` §6 的数字是 `tools/stats.mjs` 的**实测输出**，不是手写估计值。
改了覆盖范围就重跑 `stats.mjs` 并同步那个引用块——否则文档会先于代码腐烂。

**这条纪律现在有守卫了**（`npm run check` 的第 3 步）：

```bash
npm run stats:check-doc     # 只比对，漂移即 exit 1 并逐行打印差异
npm run stats:write-doc     # 就地重写那个块（内部迭代到收敛）
```

**为什么需要守卫**：那个块有近百行，且**包含文档自身的体积**（自引用）。历史上靠人肉同步，
R5a 提交就漏更新了一行（`THIRD-PARTY-NOTICES.md`），事后才发现。守卫的校验方式是
**跑一遍 `stats.mjs` 自身**再逐行比对——不重新实现一遍渲染逻辑，避免"校验器和渲染器各写一套、
各自漂移"（同一个坑在本项目出现过：`--check` 曾只在注释里声明却没实现）。

→ **改完 `ARCHITECTURE.md` 里的任何内容都要重跑一次 `npm run stats:write-doc`**（体积变了），
否则 `npm run check` 会在第 3 步拦下你。这不是噪音，是它该做的事。

**许可证相关**（见 `THIRD-PARTY-NOTICES.md`）：
入向合规已落地（第三方组件与许可清单，含可复核命令）。**本仓库有意不设 `LICENSE`**——
本地开发不需要出向授权，且上游 `ets-loader` 与 `components/*.json` **未声明 OSS 许可**
（CLT 顶层是 DevEco EULA），对外分发前需先厘清。注意：`runtime/generated-components.js`
派生自未声明许可的元数据，**不得**标注为 Apache-2.0。