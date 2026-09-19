# arkui-dom-runtime —— 让 ets-loader 的转换产物在浏览器/Electron 的 DOM 上跑起来

## 这是什么

目标：**ArkTS（ArkUI 声明式）应用跑在 Electron / 浏览器**（Linux 或全平台）。
路线：复用官方 `ets-loader` 做 ArkTS→JS 转换，自己实现 **JS 侧的 ArkUI 运行时**，把组件渲染到 DOM。
渲染与运行时由 Chromium / V8 提供——因此 **Rosen、ark_js_vm、宿主 ArkUI、闭源 RichPreviewer 全都不需要**。

## 当前进度

### 第①步：运行时骨架 ✅

```
$ bash run.sh
=== ALL PASS ===
PASS Text 组件已生成 DOM 节点
PASS 初始文本 = 'Hello World'
PASS fontSize 资源对象已解析 = '16px'（type 10002 兜底）
PASS fontWeight(FontWeight.Bold) = '700'
PASS alignRules 已落盘（data-alignRules）
PASS 点击后文本 'Hello World' → 'Welcome'      ← 核心心跳：@State 变更 → 重渲染
PASS 视图状态 message = 'Welcome'
ELMT_COUNT 2（分配的 elmtId 数）
```

### 第②步：5 个机制 ✅（2026-09-19，16 项断言一次全过）

```
$ bash run.sh rich
=== ALL PASS ===
PASS 自定义组件容器已挂载（ItemRow）           ← 静态 ViewPU.create 挂载 + {name} 形态兼容
PASS @Prop label 初值渲染 = 'clicks'
PASS @Link count 初值渲染 = '0'
PASS @Builder header 渲染 = 'Rich Page'
PASS ForEach 生成 3 项：alpha/beta/gamma       ← ForEach + List + ListItem 深渲染
PASS ListItem 子树已生成
PASS If else 分支 = 'no clicks'（count=0）
PASS Button 由 createWithLabel 生成（文本 'add'）← 工厂名差异已处理
PASS @Link 双向：ItemRow 内计数变 '1'          ← 父状态变更 → 子组件文本同步
PASS If 分支切换：出现 'has clicks'
PASS If 旧分支已销毁：'no clicks' 消失
PASS 父视图状态 count = 1
PASS @Link 再次同步：计数变 '2'
ELMT_COUNT 18
```

### 泄漏探测 ✅（②之后的加固）

怀疑点：`purgeDetachedRecords()`（切换 `If` 分支 / 重建 `ForEach` 时回收 elmtId 记录）是否真的回收？用 100 次反复切换来证伪：

```
$ bash run.sh leak
BASE          elmtRecords=17 domNodes=17
IF_TOGGLE x100     elmtRecords=17 domNodes=17（Δrec=0  Δnode=0）
FOREACH_CHURN x100 elmtRecords=11 domNodes=11（Δrec=-6 Δnode=-6）
PASS 100 次切换中分支内容始终与状态一致（不一致 0 次）
=== ALL PASS ===
```

**结论：不泄漏，且分支切换在 100 轮后功能仍正确。**（怀疑被证伪——这是个有用的否定结果。）

`bash run.sh all` → index + rich + leak 三个用例 `exit 0`。

**关键点：被执行的 `build/app.js` / `build/rich.js` 是 `ets-loader` 的转换产物本身，内容未做任何改写**（仅用 ets-loader 自带的 TypeScript 4.9.5 去掉类型标注）。

输入源文件（真机上 hvigor 构建时留下的中间产物）：

```
<proj>/entry/build/default/cache/default/default@CompileArkTS/esmodule/debug/<源码相对路径>.ts
```

## 目录

```
runtime/arkui-dom-runtime.js   运行时核心（经典脚本，加载后安装全部 ArkUI 全局）
  ├ v1 状态类（ObservedPropertySimplePU / SynchedProperty*PU）
  ├ ViewPU（组件栈、elmtId 依赖追踪、批量重渲染、If/ForEach、自定义组件挂载）
  ├ ViewV2 + 11 个 v2 装饰器（@ComponentV2 全套）
  ├ 布局（alignRules 六键 / 文本截断 / Stack 叠放 / Scroller）、LazyForEach 虚拟滚动
  └ 页面栈与路由
runtime/generated-components.js 149 个组件骨架（生成物，不要手改）
runtime/ohos-shims.js          10 个 @ohos:* 平台模块 + 持久化三级后端
tools/extract.mjs              从 hvigor cache 抽转换产物 + 去 TS 类型 + v2 装饰器绑定前奏
tools/gen-components.mjs       由 ets-loader 的组件 JSON 生成骨架（--check 只校验不写）
tools/serve.py                 极简静态服务（端口由 OS 分配，避免冲突）
tools/preflight.mjs            环境自检（工具链 / 宿主 / 可执行位）
tools/check-all.sh             一条命令做完所有验收
tools/stats.mjs                覆盖范围统计（文档里的数字都来自它）
test/*.html                    断言页（15 个用例）
fixtures/                      冻结的 ets-loader 转换产物（13 个，测试的输入）
run.sh                         浏览器 15 用例驱动
electron/run.sh                Electron 14 用例 + 真实磁盘验证
docs/                          ARCHITECTURE / DEVELOPING / ROADMAP / CAPABILITY
```

## 用法

```bash
# 一条命令做完所有验收（preflight + 生成物一致 + 浏览器 + Electron）
npm run check
npm run check:quick                # 跳过 Electron

# 单个用例
bash run.sh layout                 # 浏览器
bash electron/run.sh layout        # Electron

# 统计当前覆盖范围（文档里的数字来源）
npm run stats
npm run stats:json                 # 机器可读

# 环境自检（缺什么会明确报出来）
npm run preflight
```

## 原理：怎么让生成的代码原样跑起来

从转换产物反推出来的调用约定（**逐行对齐，错一个 `pop()` 就全崩**）：

```js
initialRender() {
  this.observeComponentCreation2(cb1, RelativeContainer);  // 分配 elmtId，立即执行 cb1 完成首渲染
  this.observeComponentCreation2(cb2, Text);               // 同上
  Text.pop();                                              // 收尾弹栈（只在首渲染出现）
  RelativeContainer.pop();
}
```

运行时据此实现三件事：

1. **组件 builder 栈**：`create()` 建节点并入栈（重渲染时**复用同一 elmtId 的节点**并更新内容），属性 setter 作用于栈顶，`pop()` 弹栈。
2. **依赖追踪**：`ObservedProperty.get()` 记录"当前正在渲染的 elmtId"；`set()` 把依赖它的 elmtId 标脏，微任务里批量重渲染 —— 对应 ArkUI 的 `updateDirtyElements`。
3. **重渲染上下文恢复**：重渲染时组件栈是空的，必须把上下文恢复到该 elmtId 的父节点，且**不能指望生成的 `pop()`**（它只在 `initialRender` 里）。

属性用 **Proxy 按需生成 setter**，所以不必预先枚举 150 个组件的几十个属性；已知 CSS 映射走样式，未知属性落 `data-*` 不丢信息。

## 已验证 / 未验证（别把没验的当结论）

**已验证**（真 headless Chrome，非 Node 模拟）：
- 页面 `Index.ts` 原样执行、渲染出 DOM；`@State` 点击切换生效
- 资源对象 `{id,type:10002,...}` 解析；`fontSize`/`fontWeight`/`id`/`onClick`/`alignRules` 生效
- elmtId 分配为 2（RelativeContainer + Text），与预期一致

**未验证**：
- **只有模板应用**（`RelativeContainer` + `Text` + `@State`）。`List`/`ForEach`/`@Builder`/自定义组件/`@Prop`/`@Link`/**状态管理 v2**（`@ComponentV2/@Local/@Param`）都没测——真实应用会显著扩大接口面
- **父组件重渲染会重建整棵子树**：当前只处理"标脏的 elmtId 自己"这一层，子节点的 elmtId 记录未做迁移
- **布局语义几乎为零**：`alignRules` 只落盘不实现；`Column/Row/Stack` 只是 flex 盒子，没有 ArkUI 的 measure/layout 语义
- **`@ohos:*` 一个都没实现**（只验证了 `Index.ts`，它不 import 平台 API；`EntryAbility.ts` 才 import `@ohos:hilog` 等）
- 未在 Electron 里验证（只在 Chrome headless 里验证）

## 踩过的坑（留给后来者）

1. **假阳性判定**：`grep 'ALL PASS'` 匹配整页 DOM 时会命中 `<script>` 里的字面量，永远"通过"。必须只解析 `#result` 节点的文本再判定。
2. **选择器**：`RelativeContainer` 也是 `div`，`querySelector('div')` 拿到的是容器；`textContent` 递归所以文本断言会假通过，而 `style`/`click` 全打在容器上。要按 `id` 选。
3. **端口**：固定端口 + 上一轮退出瞬间的 TIME_WAIT 会让下一次 bind 失败；改用 OS 分配（`serve.py 0`）并回读实际端口。
4. **数值属性不能加 `px`**：`fontWeight:700`、`opacity:0.5` 属直传类，和尺寸类要分开处理。

### 版式语义 ✅（③ 的第一批）

```
$ bash run.sh layout
=== ALL PASS ===
PASS Column space:8 → rowGap = 8px
PASS Column 百分比尺寸 = 100% / 100%
PASS Column padding(12) = 12px
PASS Column justifyContent(FlexAlign.Center) = center
PASS Column alignItems(HorizontalAlign.Center) = center
PASS Row space:6 → columnGap = 6px
PASS Row justifyContent(FlexAlign.SpaceBetween) = space-between
PASS Text textAlign(TextAlign.Center) = center
PASS Text padding(6) = 6px
PASS Text backgroundColor(Color.Yellow) = rgb(255, 255, 0)
PASS 点击后 Button = 'on'（@State 驱动内容更新）
```

判据是 `getComputedStyle` 断言的**计算后样式**，不是看截图靠眼。新增枚举 `FlexAlign` / `TextAlign` / `ItemAlign` / `Color`；`create({space:n})` 映射为 flex `gap`。

### 在真 Electron 里跑通 ✅（Electron v44.2.0）

```
$ bash electron/run.sh all
════ electron: layout ════   === ALL PASS ===   截图判定: 有内容 ✅   ELECTRON_RESULT: PASS
════ electron: rich   ════   === ALL PASS ===   截图判定: 有内容 ✅   ELECTRON_RESULT: PASS
exit 0
```

**Electron 加载的就是 `test/*.html` 本体**（不复制任何测试代码）→「同一套断言在 Chrome headless 与 Electron 里都通过」这件事本身就是证据。

截图非空白经过**两道独立判定**：Electron 内按像素统计（非白 13.48%）+ 事后用 PIL 独立复核（1782 种颜色）。

本机 Electron 来自 `~/.cache/electron/electron-v44.2.0-linux-x64.zip`（解包到 `electron/runtime/`，**无需 npm 安装**）。
必须带 `--no-sandbox`（`chrome-sandbox` 需要 root:4755）与 `--disable-gpu`（本机 Mesa 被 ROCm 改过）。

### ④ `@ohos:*` 别名层 + ability 启动路径 ✅

真实应用的第一道坎是「ability 一跑就 import 平台 API」。产物里的形式是：

```js
import hilog from "@ohos:hilog";                       // 值导入 → 转译后 require("@ohos:hilog").default
import UIAbility from "@ohos:app.ability.UIAbility";
import type window from "@ohos:window";                // 类型导入 → 被 TS 擦除，不需要实现
```

因此加了一条 **CommonJS 通道**：`tools/extract.mjs … --cjs --register <id>` 把产物注册成模块，
运行时提供 `require` 垫片把 `@ohos:*` 解析到 `runtime/ohos-shims.js` 的实现。

```
$ ./run.sh ability
=== ALL PASS ===
PASS 模块装载：default 是类（EntryAbility）
PASS @ohos:hilog 解析为带 info/error 的实现
PASS require 返回值兼容 TS 的 default interop
PASS hilog 记录到 onCreate：Ability onCreate
PASS hilog 的 %{public}s 占位符已被格式化（无残留）
PASS this.context.getApplicationContext().setColorMode(-1)
PASS windowStage.loadContent('pages/Index')
PASS loadContent 后页面已渲染：textContent='Hello World'     ← 端到端：ability → 页面
PASS loadContent 回调（成功分支）被调用
PASS 未实现模块报错可操作（列出已实现项 + 指路）
```

`runtime/arkui-dom-runtime.js` 新增扮演"框架"的 `__arkui_dom_startAbility()`：构造 context →
`onCreate` → `onWindowStageCreate(windowStage)`，其中 `windowStage.loadContent(page, cb)`
**真的去渲染页面**并按约定回调。Electron 侧 `ability` 用例同样 PASS 且截图有内容。

⚠️ **一条只有真跑才会暴露的 API 契约**：生成代码是 `if (err.code) …` —— **对 `err` 没有 null 检查**，
说明官方 API 在**成功时也必须传一个 BusinessError 形状的对象**（`code: 0`）。我最初传 `null`，
直接 `TypeError: Cannot read properties of null (reading 'code')`。

### ⑤ `@ohos:router` + `@ohos:data.preferences` ✅（多页应用 + 数据持久化）

测出的映射关系（先构建真实 `.ets` 再读产物，不猜）：

```
import { router }      from '@kit.ArkUI'   →  import router      from "@ohos:router"
import { preferences } from '@kit.ArkData' →  import preferences from "@ohos:data.preferences"
getContext(this)                            →  全局函数，需运行时提供
```

```
$ ./run.sh router
=== ALL PASS ===
PASS Home 已渲染
PASS 跳转后页面栈 = [pages/Home → pages/Detail]
PASS preferences 跨页读回成功：'token=abc123'      ← Home 写、Detail 读
PASS flush 已写穿持久层：demo_store.token=abc123
PASS 返回 Home 且状态保留：'status=saved'          ← 关键语义
PASS router / preferences 调用留痕
```

**测试抓到一个真实的语义偏差（不是断言写错）**：我第一版 `router.back()` 是 `factory()` **重新造页**，
于是 `@State` 回初值 → `status=idle`。但 ArkUI 的 router **保留页面实例**，back 回去状态不丢
（这正是 `onPageShow` 与 `aboutToAppear` 的区别：前者每次显示都调，后者只首次）。
已改为页面栈存 `{path, view}`、返回时复用同一实例，并通过 `onPageShow` 通知。

同时补上了 **`aboutToAppear()` 生命周期**——产物常在这里读数据，漏掉它页面会永远停在初值。

### ⑥ `@ohos:file.fs` + `@ohos:net.http` ✅（文件读写 + 联网）

测出的映射（构建真实 `.ets` 后读产物）：

```
import { fileIo as fs } from '@kit.CoreFileKit'  →  import fs   from "@ohos:file.fs"
import { http }        from '@kit.NetworkKit'    →  import http from "@ohos:net.http"
```

产物实际调用的面：`fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE)` → `{fd}`、
`fs.writeSync(fd, str)`、`fs.closeSync(file)`、`fs.readTextSync(path)`；
`http.createHttp()` → `req.request(url, {method: http.RequestMethod.GET})` → `{responseCode, result}` → `req.destroy()`。

```
$ ./run.sh netfile            # 两阶段：phase1 写盘 → phase2 在【全新进程】读回
════════ netfile-1 ════════   PHASE 1 | fs 后端=localStorage      ✅ 通过
════════ netfile-2 ════════   PHASE 2 | fs 后端=localStorage      ✅ 通过
  PASS 上次会话写入的文件仍存在：/vfs/files/demo.txt
  PASS 内容一致：'hello from arkts' ← 跨进程持久化成立
  PASS preferences 也跨进程保留：marker='m1'
```

### 持久化的实现方式（**修正**：早期版本用内存 Map 冒充文件系统，进程退出即丢——那不是文件系统）

| 运行环境 | 后端 | 落到哪 |
|---|---|---|
| **Electron** | **Node 真 fs**（`electron/preload.js` 经 `contextBridge` 注入，`sandbox:false`） | **真实磁盘文件**：`electron/data/files/`（`realPathOf()` 给出真实路径） |
| **浏览器** | `localStorage`（同步、确定性、跨会话保留） | 浏览器 origin 存储；非真实路径，但断电不丢 |
| 浏览器（可选） | OPFS —— **需显式开启**（`__arkui_dom_force_backend='opfs'`） | 浏览器管理的磁盘；实测在本机 headless Chrome 会挂，见下 |

`preferences` 同样落盘：flush 时把键值写成 `<files>/pref_<name>.json`（Electron 下就是磁盘 JSON 文件）。

**验证方式（两道，且不依赖页面自报）**：
1. **两阶段跨进程**：phase 1 在 Chrome/Electron 进程 A 里写 → phase 2 在**全新进程 B** 里先读再断言。两阶段共用同一 profile（浏览器）/ 同一 `electron/data`（Electron）。
2. **shell 级外部核验**（Electron）：`electron/run.sh netfile` 结束后直接 `cat` 真实文件：
   ```
   ✅ demo.txt 内容 = hello from arkts
   ✅ preferences 落盘 = {"marker":"m1"}
   ```

### 两条“持久化”踩坑（都是实测出来的，不是推演）

**坑 A：`localStorage` 按 origin 隔离，而 origin 含【端口】。**
早先为避免端口 TIME_WAIT 冲突改成"OS 随机分配端口"（`serve.py 0`），于是 phase1 与 phase2 成了**两个不同 origin** → 持久化断言直接失败。
修法：持久化用例先 `pick_free_port()`（socket 探测空闲）**再固定给两次运行**。
→ 通用教训：**任何依赖 origin 作用域存储的跨进程验证，都必须固定 origin（含端口）**。

**坑 B：OPFS 在本机 headless Chrome 上"逐级不稳"，且"试错式降级"会让后端在两次运行间跳变。**
实测（`test/opfs-probe.html`）：

```
第 1 次（全新 profile）: getDirectory() OK → getFileHandle() 挂住
第 2 次（复用 profile）: getDirectory()/getFileHandle() OK → createWritable() 挂住
第 3 次:                 更早挂
```

即 API 存在（`isSecureContext=true`）、但异步链会挂。**更糟的是我最初的设计**："先试 OPFS，失败/超时降级 localStorage" →
phase 1 超时降级写进了 localStorage，phase 2 却真的用上了 OPFS → **两个后端互不可见**，
表现为"跨进程持久化失效"（`FAIL 上次会话写入的文件仍然存在`）。
修法：**后端选择必须确定性**——浏览器默认 `localStorage`；OPFS 改为显式开启（在该环境可用时）。
同时给水合加了超时看门狗（绝不无限挂住调用方）与可变后端绑定（降级能就地生效）。

`file.fs` 覆盖的 API：`openSync/writeSync/readTextSync/closeSync/accessSync/mkdirSync/unlinkSync/statSync/listFileSync`
+ `OpenMode` 位掩码 + 带 `code` 的异常。**未实现**：`readSync(buffer)`（产物未用到；现会明确抛错而不是静默返回 0）。
`net.http` 是**真 `fetch`**：相对 URL 按当前页 origin 解析，绝对 URL 直接请求；`RequestMethod`/`ResponseCode`/`destroy()` 齐备。

**Electron 侧加载方式同时改了**：从 `file://` 换成 **本地 `http://`**（`electron/run.sh` 起 `tools/serve.py` 后
通过 `ARKUI_PAGE_URL` 传入）。原因：`file://` 下跨源 fetch 会被拦，同源才能让 `net.http` 与浏览器侧行为一致。
5 个 Electron 用例（layout/rich/ability/router/netfile）改后全部仍然 PASS。

⚠️ **负面测试的维护坑（真实踩到）**：`ability` 用例里"未实现模块应报错"这条，原先探测的是
`@ohos:net.http` —— 等 `net.http` 真被实现后，这条断言就**失效了**（不再抛错）。
负面探测必须钉在**永远不会被实现**的名字上（现改为 `@ohos:this.module.does.not.exist`）。

## 状态管理 v2 ✅（`@ComponentV2` 全套）

v1 与 v2 是**两套机制**：v1 把状态包成对象（`new ObservedPropertySimplePU(...)`），
v2 是**裸字段 + 装饰器画在原型上的访问器**。所以 v2 不是"再加几个状态类"，而是要实现整个装饰器层。

```
$ bash run.sh v2
=== ALL PASS ===
PASS @Computed 初值：'count=0,items=2'
PASS @Param+@Once 传入子组件：'child/fixed'
PASS @Consumer 拿到祖先 @Provider 初值：'consume=dark'
PASS @Local 改值触发重渲染：'count=1,items=2'
PASS @Monitor('count') 回调触发：hits='1'
PASS IMonitor.value().now = '1'（期望 1）          ← 形状取自 SDK 的 .d.ts
PASS IMonitor.value().before = '0'（期望 0）
PASS 子组件 @Monitor('inner') 触发：hits='1'
PASS @Event 子→父回调：父收到 '1'
PASS @Trace 字段变更触发重渲染：'1:aN' → '1:renamedN'
PASS 非 @Trace 字段(id)变更【未】触发重渲染         ← @Trace 是选择性的，不是全观测
PASS 改 @Provider 后 @Consumer 自动更新：'consume=light'
PASS V2 的 @Local/@Provider 字段都装了访问器：[count,items,…,theme,lastPing]
PASS @Event 字段未装观测访问器：[label,seed,mode,inner,hitCount]
PASS 无 v2 相关告警（0）
```

26 条断言在**浏览器与 Electron 双通过**。完整契约（11 个装饰器、`ViewV2` 的 11 个方法、
`IMonitor` 的权威形状）见 `docs/ARCHITECTURE.md` §3.4。

**一个必须记住的设计约束**：v2 装饰器**不能挂 global**——`Event` 既是装饰器名也是浏览器全局，
而 runtime 的 `Scroller` 与 `test/lazy.html` 都在用 `new Event('scroll')`。
所以改走 `__arkui_dom_decorators` + `extract.mjs` 生成的**作用域内绑定前奏**。

## V1 深度观测 ✅（`@Observed` + `@ObjectLink`）

改**数组元素的字段**（数组长度不变）过去不会触发任何重渲染——`ForEach` 只在数组变化时重建。
现在按真机语义补齐了。

V1 与 V2 的深度观测**模型不同**：V2 用 `@Trace` **逐字段**标记，V1 的 `@Observed` 标在**整个类**上，
产物里**字段上什么都没有** → 拿不到字段名 → 只能用 **Proxy** 拦 `set`。

```
$ bash run.sh observe
=== ALL PASS ===
PASS @Observed 类实例是可观测代理（Item[0] → true）
PASS 非 @Observed 的嵌套对象【不是】可观测的（Meta → false）
PASS 父改 items[0].name → 子组件自动重渲染：'a' → 'renamed'
PASS 数组长度未变（2 → 2），证明确实是"元素内部变更"而非整体重建
PASS 子组件内 this.item.count += 1 → 自己重渲染：'0' → '1'
PASS 写穿透到父侧同一个对象（父读到 count=1）
PASS 非 @Observed 对象内部变更【未】触发重渲染：仍为 'meta0'   ← 负向断言
PASS 替换 item.child 整体（@Observed 的字段写入）触发重渲染：'metaY'
```

两个必须记住的点：产物里的 `SynchedPropertyNesedObjectPU` 里 **`Nesed` 是官方拼写错误**（不能改）；
产物**不会**自己调 `subscribe`，订阅由运行时在构造时隐式完成。

> **顺带堵掉一个静默失败通道**：TS 的 `__decorate` 对 **falsy 装饰器静默跳过**
> （`__decorate([undefined], Item)` 不报错、原样返回类）。所以抽取前奏里加了守卫，
> 绑到的名字不是函数就 `throw`。**加装饰器必须同时改运行时表和 `DECORATOR_NAMES`。**

## 工程化 ✅

项目最初不是 git 仓库（287 MB 里 283 MB 是解压的 Electron），改动不可审计、回归不可复现。
现已补齐：

| 能力 | 入口 | 说明 |
|---|---|---|
| 版本控制 | `git log` | 被跟踪源码 / 约 0.9 MB（`.git` 排除 Electron 运行时与产物）（`.gitignore` 排除 Electron 运行时与产物） |
| 环境自检 | `npm run preflight` | 缺 CLT/Chrome/Electron **或脚本缺 `+x`** 都会明确报错 |
| 统一验收 | `npm run check` | **退出码只看被调命令**，绝不用 `grep`/`wc` 数日志行 |
| 生成物守门 | `npm run check:gen` | `--check` 只比对不落盘，漂移即非 0 退出 |
| 覆盖统计 | `npm run stats` | 文档里的所有数字都由它产出（`--json` 机器可读） |

`npm run check` 当前：**浏览器 15 用例 + Electron 14 用例全绿**。

## 下一步

**权威清单在 `docs/ROADMAP.md`**（每项带可复现的验收命令）。当前优先：

1. **R9/R10** `Grid` 真实布局、`Tabs`/`TabContent` 切换（85 个骨架组件目前只落 `data-*`）
4. **R14** 多层锚链 + `Guideline` + `bias`（`alignRules` 目前只支持一层）

**仍未覆盖**：动画/手势、`Navigation`/`Swiper` 切换语义、`@ohos:media`/`notification`、
浏览器侧真文件系统（OPFS 在 headless Chrome 会挂起，现用 `localStorage` 兜底）。
**别把没验的当结论**——`docs/CAPABILITY.md` 里有逐项的能力矩阵。

**② 留下的已知待办（别当已完成）**：

- `ForEach` 现在是「数组变了就整体重建」，**没有键级 diff**
- 父组件重渲染时参数推送走 `updateStateVarsOfChildByElmtId`，但**子视图内部的 elmtId 迁移未处理**（复杂嵌套可能出问题）
- `Repeat` / `Navigation` / 动画 / `Grid` 自适应 / `Swiper` **未覆盖**
- **布局语义仍不完整**：没有约束求解器，`alignRules` 只支持一层锚链

---

## 测量结果（①.5）

原计划"直接代码生成 150 个组件"**优先级错了**。用重页面（`pages/Rich.ets`：自定义组件 + `@Prop` + `@Link` + `@Builder` + `ForEach` + `List` + `if/else` + `Button`）测量后，真正的难点是 **7 个机制**，不是组件数量。

两个样本（模板应用 / 重页面）的完整接口面对比见 `docs/surface-measurement.md`——**样本 A 严重低估**（组件 2→9、状态类 1→4、运行时全局 4→7、协议方法 +4）。
