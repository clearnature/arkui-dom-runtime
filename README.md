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
test/*.html                    断言页（22 个用例）
fixtures/                      冻结的 ets-loader 转换产物（20 个，测试的输入）
run.sh                         浏览器 22 用例驱动
electron/run.sh                Electron 21 用例 + 真实磁盘验证
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

## R9/R10：`Grid` 真实轨道 + `Tabs` 切换 ✅

`Grid`/`Tabs` 此前只是"能建出节点"（生成的骨架），本轮补上真实语义（51 条断言，双端通过）。

**先测量**：新建 `fixtures/pages/TabsGrid.ts` 在 HarmonyOS 工程里 `devecocli build`，
读 hvigor 缓存里的转换产物，才发现 `TabContent` 的形态和别的容器**都不一样**：

```ts
TabContent.create(deepFn);      // ← 子构建器【当构造参数传】
TabContent.tabBar('T0');        //   （GridItem/ListItem 是 create(()=>{}, false) + 外部 deepRender）
TabContent.pop();  …  Tabs.pop();
```

```
$ bash run.sh tabgrid
=== ALL PASS ===
PASS columnsTemplate 透传：'1fr 1fr 1fr'
PASS columnsGap → columnGap = '6px'                ← 此前它们只落 data-*，版式静默错
PASS rowsGap → rowGap = '4px'
PASS 每列宽 = 96.0（期望 (300-2×6)/3 = 96）         ← 几何断言，不是看字符串
PASS 行距 = 行高 + rowsGap(58.0 + 4 = 62.0, 实测 62.0)
PASS 裸数字轨道归一化：'100 1fr' → '100px 1fr'     ← ArkUI 裸数字=vp，CSS 必须带单位
PASS 归一化后第 0 列真占 100px（实测 100.0）
PASS barPosition=Start → tab bar 在内容之前
PASS tabBar 标签顺序 = 'T0,T1,T2'
PASS 初始恰好第 0 个可见
PASS TabsController 已绑定 = true                  ← 机制自省，不只看 display
PASS changeIndex(1) 后恰好第 1 个可见
PASS onChange 已触发且 @State 驱动重渲染：'idx=1'
PASS 点击 bar 项后恰好第 2 个可见
PASS 隐藏的 TabContent 仍留在 DOM 中（未被销毁）    ← 与 router 的"页面实例保留"同理
PASS 越界已记入 layoutWarnings（0 → 1）            ← 负向断言
```

**两个只能靠跑才发现的坑**：

1. **`Tabs.onChange` 不能当 DOM 事件**。`onChange` 走通用分支会变成 `addEventListener('change')`
   ——一个**永不触发**的监听器（静默失效）。必须拦在通用事件分支之前，由 Tabs 收集、切换时派发。
2. **`TabContent` 是自定义挂载点**（要挂进 `Tabs` 的内容区而不是包装元素），于是绕过了 `mountNode`
   → 漏了 `data-arkui-comp` 标记，测试 `querySelectorAll('[data-arkui-comp="TabContent"]')` 返回 0。
   `rec.parentNode` 也必须改指内容区，否则重渲染会重建整个 bar。

## R11：`Swiper` 轮播 ✅

```
$ bash run.sh swiper
=== ALL PASS ===
PASS 页数 = 3（page 标记只标页面、不标指示点）
PASS 初始恰好第 0 页可见
PASS 指示点数 = 3（= 页数）
PASS SwiperController 已绑定 = true                  ← 机制自省，不只看 display
PASS showNext 后恰好第 1 页可见
PASS onChange 已触发且 @State 驱动重渲染：'cur=1'
PASS loop=false 时末页再 showNext 停住（index=2）
PASS showPrevious 回到第 1 页
PASS loop=true 末页再前进【回卷】到第 0 页          ← 与 loop=false 的语义差异
PASS autoPlay 自动推进了索引：'auto=0' → 'auto=1'
PASS loop=true 下索引始终在 [0,1] 内（采样 12 次）
PASS 反复自动推进后页数仍为 2（无泄漏/重复挂载）
PASS 越界已记入 layoutWarnings（0 → 1）            ← 负向断言
```

**最大的一个坑是签名，不是机制**：我按 `Tabs({barPosition, index, controller})` 的印象写成
`Swiper({index:0, loop:false, ...})`，编译器直接判错：

```
Object literal may only specify known properties,
and 'index' does not exist in type 'SwiperController'
```

这个 SDK 的 `SwiperInterface` 只有 `(controller?: SwiperController)` 一个重载 ——
**create 的参数就是控制器实例本身**，`index`/`loop`/`autoPlay` 全是属性 setter。
→ 再一次印证：**别凭印象写 API 形状，`.d.ts` 和产物才是权威。**

**结构上比 `Tabs` 简单**：子项直接挂进 Swiper 元素（不像 `TabContent` 要另认领内容区），
所以 `Swiper.width/height/onChange` 自然作用于整体；指示点是 `Swiper.pop()` 时追加的覆盖层
（那时才数得出页数），页面用 `[data-arkui-swiper-page]` 标记，与指示点互不污染。

**autoPlay 是自己停表的**：回调里先查 `st.node.isConnected`，页面被 `router` 换掉后自动
`clearInterval` —— 否则计时器会跨页面泄漏。测试里对 autoPlay 用**轮询**而不是固定等待
（本项目在 `lazy` 上踩过 headless 计时/节流的坑），并连跑 3 次确认稳定。

**破坏验证**：把 `loop` 的回卷去掉 → 1 条失败；把 autoPlay 的 `setInterval` 去掉 → 1 条失败。

## R12：`Navigation` / `NavDestination` 栈导航 ✅

```
$ bash run.sh navdemo
=== ALL PASS ===                    （72 条断言）
PASS 初始没有 NavDestination（0 个）
PASS navDestination builder 已登记 = true
PASS Navigation.title 未实现已记警告        ← 标题栏不绘制，但出声，不静默
PASS push 后根内容未被销毁且状态保留（'root=2'）
PASS A 的 create 生命周期都触发了：'A:willAppear A:willShow A:shown A:ready'
PASS A: willShow 在 shown 之前（"即将显示"早于"已显示"）
PASS B 盖住 A 时 A 触发了隐藏回调
PASS 被盖住的 A 未被销毁（实例与内容都在）
PASS pop 回来的仍是同一个 A 实例（未重建）
PASS A 被重新显示时再次触发了 show 回调
PASS popToName('A') 后栈 = [A]
PASS popToIndex(0) 后 size=1
PASS onPop 收到了 info.name：'popGot=D/undefined'
PASS moveToTop('A') 后 = [C,B,A]
PASS 栈清空后 elmtId 记录回到基线（25 → 25）      ← 零泄漏
PASS 缺 builder 的 push 记了警告（诊断提到 navDestination）
PASS 越界 popToIndex(99) 记了警告
```

**与前两组都不同的一点**：`builder` **由运行时调用，不在页面的 `initialRender` 里** ——
`Navigation.navDestination({builder})` 传进来，运行时在压栈时把它调起来建 `NavDestination`。
所以建树必须"**预压容器 → 调 builder → 还原栈 → 校验产出**"：
先把目标区 push 到组件栈上（builder 里的组件才有正确挂载点），`restore()` 后**必须校验**
builder 真产出了 `NavDestination`（`if/else` 可能没覆盖该 name）——校验失败就**回滚**，
不留"路径项存在但节点不存在"的幽灵。

**"pop 后状态保留"的实现方式是"不销毁"**：`NavDestination` 用绝对定位覆盖层盖住根内容，
根内容被盖住但留在 DOM 里 → 它的 `@State` 自然还在（实测 `root=2` 一路保持）。
只有**栈顶**可见，pop 时栈顶才销毁，下面那个重新显示且**是同一个实例**。

**生命周期是照 `.d.ts` 的 JSDoc 语义排的**（"about to be mounted/displayed" 早于 "displayed"）：
首次挂载 `onWillAppear→onWillShow→onShown→onReady`；再显示只走 `onWillShow→onShown`；
隐藏 `onWillHide→onHidden`；销毁前 `onWillDisappear`。**顺序是我推断的，未在真机核对**——
`onWillAppear` 的绝对时机也不同（真机在挂载前，本实现在子树挂载后）。这条已写进 CAPABILITY。

**一处刻意的"出声"**：`onBackPressed` 在本运行时**没有触发源**（没有系统返回键），
所以登记它时**立刻记一条警告**，而不是"存了不调" —— 后者是最坏的一种静默。

**破坏验证**：去掉"非栈顶隐藏" → 3 条可见性断言失败；交换 `willShow`/`shown` 顺序 → 1 条失败；
不派发 `onPop` → 1 条失败。

## R14：多层锚链 + `Guideline` + `bias` ✅

```
$ bash run.sh reldemo
=== ALL PASS ===                    （24 条断言）
PASS b 锚 a 的右下（a 是 40×20）：(x=40, y=20)
PASS c 锚 b 的右下（b 是 40×20）：(x=80, y=40) —— 逆序声明下仍需正确
PASS b 的右下角与 a 重合（Δ=(0.0,0.0)）
PASS 竖线 vline 在 30% 处（x=90.0，期望 300×0.3=90）
PASS end 定位的竖线 vline2（x=270.0，期望 300-30=270）
PASS 错轴（横线锚水平）值为 0：(x=0)
PASS gv2 锚 gv 的右边缘（gv 在 90、宽 20）：(x=110，期望 110)
PASS bias.horizontal=0.2 → x=56（期望 0.2×280=56）
PASS 未写 bias → 取默认 0.5 居中 → x=140（期望 140）
PASS 没有把已支持的 alignRules/bias/guideLine 记成"未支持"（0 条）
```

**三个机制的权威依据都来自 `.d.ts`，不是印象**：

| 机制 | 我原以为 | `.d.ts` 的权威说法 |
|---|---|---|
| `bias` 默认值 | "不写就不生效" | `@default {horizontal:0.5,vertical:0.5}` → **不写就是居中** |
| `Guideline` 方向 | 易记反 | `Axis.Vertical` = **竖线** → 锚**水平**位置；`Axis.Horizontal` = **横线** → 锚**垂直**位置；**错轴值恒为 0** |
| `GuideLinePosition` | ROADMAP 里写的 `{percent:30}` | **本 SDK 只有 `start`/`end`**（`percent` 是旧 API），百分比要写 `start:'30%'` |

**多层锚链靠不动点迭代**：锚链可能是**逆序声明**的（c 锚 b、b 锚 a，而 c 写在最前），
单趟解析会读到兄弟的旧位置。所以反复扫到不动点（链长 N 需要 N 趟，上限 12，超限记警告）。

**顺带修掉一个把警告通道弄脏的问题**：`alignRules` 原来在**属性应用时**就立刻解析，
而那一刻锚点可能还没建出来（逆序声明必然如此）→ 实测留下 4 条假警告"找不到锚点 'x'"。
现在只登记、解析统一推迟到渲染后的 `syncAlignRules`。

**我犯的一个测量错误（值得单独记）**：第一版测试用 `getBoundingClientRect()` 比左上角，
于是把**正确的实现**判成了错的 —— `End`/`Bottom` 对齐会加 `translate(-100%,-100%)`，
rect 已经把这位移算进去（b 明明 `offset=(40,20)`，rect 却是 `(0,0)`）。
位置断言必须读 `offsetLeft/offsetTop`（那也是运行时解析锚链用的坐标空间）；
视觉校验要用"**边缘重合**"（rect vs rect），与 `measure.html` 同一套约定。
我是靠一个临时探针页打印真实 DOM + `querySelector` 结果才定位到这一点的 —— **测量方法本身也要被验证**。

**破坏验证**：退化成单趟解析 → 1 条失败；`bias` 默认值改成 0 → 2 条失败；
去掉错轴守卫 → 1 条失败（并因此发现原来那条断言**没有牙齿**：横线自身 `x=0`，
用 `Start` 对齐时"错轴返回 0"与"没做判断"碰巧同值，改用 `Center` 才分离成 0 vs 150）。

## R16：`LazyForEach` 变高列表项 ✅

```
$ bash run.sh lazyvh
=== ALL PASS ===                    （22 条断言）
PASS 高度只有两种取值：55 / 125
PASS 两种高度相差 70（= 120-50）：实测差 70.0
PASS 总高 = max(视口 800, 末项底部 736) = 800（实测 scrollHeight=800）
PASS 自省 totalH=734 与 DOM 末项底部一致（736）
PASS 每项的 DOM offsetTop 与偏移模型一致（不一致 0 项）
PASS scrollToIndex(100) 后目标在视口顶部（offsetTop - scrollTop = 0.0，容差 2）
PASS 再次 scrollToIndex(100) 仍精确落在顶部（0.0）—— 往返不累积误差
PASS 滚动到 9000 后偏移模型仍与 DOM 一致（渲染 5 项，不一致 0）
```

**核心模型换了**：偏移不再是"序号 × 统一行高"，而是**逐项 advance 的前缀和**
（`advance(i) = round((已实测高度(i) ?? estItemH) + gap)`，`estItemH` 取**已实测项的均值**）。
渲染后逐项 `offsetHeight` 回填，变了就重建前缀；滚动用**锚定**（视口顶部那一项的偏移变了多少，
就给 `scrollTop` 补多少）保证画面不跳。

**四个真 bug（都是靠断言抓出来的，不是我读代码看出来的）**：

| 现象 | 根因 |
|---|---|
| `item0` 的 DOM `offsetTop=2` 而模型 `0` | **topSpacer 也是 flex 子项**，容器 `gap` 多算一次 → 整个窗口偏一个 gap。改成「块级 + 每项 `margin-bottom`」表达间距 |
| `scrollToIndex(0)` 跳到了 100 段 | 把**渲染空间序号**当成了**数据空间索引**：虚拟列表的 `items[i]` 是"当前窗口第 i 个"，对应索引是 `window[0]+i` |
| 目标偏出 10px | 锚定 delta 在**更新估计值之前**算好，之后估计值又改了前缀 → 补偿不完整。**顺序：等所有改动落地再取新偏移** |
| 滚动到 9000 后整窗口偏 166px | 窗口没变时**不重设 spacer** → "旧 spacer + 新模型"错配。**spacer 高度必须每次都按当前偏移重设** |

**我自己的一条错误断言**：把 `scrollHeight` 当成内容高度——内容比视口矮时它被钳到 `clientHeight`（DOM 语义）。
改成 `max(clientHeight, 末项底部)`。

**跨环境的意外收获**：同一份断言在 Electron 里高度是 **54/124** 而浏览器是 **55/125**（字体度量差异）——
因为断言只钉"两种取值、相差 70"，两端都过。**不硬编码像素是对的。**

**破坏验证（4 处）**：不回填实测高度 / 不做锚定 / 窗口没变时不重设 spacer /
`scrollToIndex` 用渲染序号当索引 → **8 条失败、跨 4 组**，全部被抓。

## R15：文本真实换行 / 行数测量（`@ohos:measure`）✅

```
$ bash run.sh textmeasure
=== ALL PASS ===                    （25 条断言）
PASS 读到 N=23，单行宽 singleW=368.02（每字约 16.00px）
PASS measureText 带 constraintWidth/maxLines 的结果与不带【完全相同】
PASS 加宽量 ≈ letterSpacing×字数 = 92（实测 92.0）
PASS 测量行数 = round(96/24) = 4，与手工推算的 4 一致
PASS maxLines:1 → 高度被夹到单行（24 ≈ 24）
PASS lineHeight:40 → 高度 = 行数×40 = 160（实测 160）
PASS measureTextSize 的高度与真实渲染一致：API 96 vs DOM 96.0
PASS 数行(ref，宽 100) = 4，期望 4
PASS 数行(refWide，宽 400 放得下) = 1，期望 1
PASS 不设宽度时按容器宽度换行：可用 320.0px → 手工推算 2 行，DOM 实测 2 行
```

**实现的是真实平台模块 `@ohos:measure`**（不是自造 API）。两条 API 的语义完全来自 `.d.ts` 的 JSDoc：

| API | JSDoc 原话 | 本实现 |
|---|---|---|
| `measureText` | "always measures **single-line** text width. Layout constraints in options (**constraintWidth, maxLines**, and more) **do not affect results**" | 离屏元素 `nowrap` + 不限宽 |
| `measureTextSize` | "Layout width and height occupied by the text… both in **px**" | 离屏元素按 `constraintWidth` 换行，`Range.getClientRects()` 数行 |

**关键取向：让浏览器自己排版，不自己模拟。** 用离屏元素 + 真实排版，字距/字体回退/禁则处理的答案
**与真实渲染一致** —— 实测 `measureTextSize` 的宽高与同文本同宽度的真实 `Text` DOM **逐像素相等**。
"按字符宽度累加"的模拟一定会在这三处与渲染分叉，而这条 API 的用途恰恰是预算尺寸。

**离屏宿主不能用 `display:none`** —— 那样没有布局，量出来全是 0。用 `position:absolute; left:-100000px; visibility:hidden`。

**⚠️ 一个值得单独记的"断言盲区"**：`measureTextSize` 只回 `width`/`height`，而 `height = 行数 × 单行高`
—— **行数在算式里被约掉了**。破坏验证时我把"数行"改成恒返回 1，**从高度反推出来的行数依然是 4，
相关断言全过**。→ 所以额外暴露了自省钩子 `__arkui_dom_countLines(el)`，让数行能被**直接**断言。
**通用教训：如果某个中间量在最终结果里被约掉，只断言最终结果就等于没测它。**

**我这轮又犯了一次同类错误**：断言"不设宽度的 Text 是单行"——实际它受**容器**（测试页 `#root` 320px）约束，
23 字 × 16px = 368 > 320 必然换行。**实现是对的，我的期望是错的**。改成用元素自身实测宽度自洽推算。

**破坏验证（4 处）**：`measureText` 不再忽略约束、数行恒为 1、不夹 `maxLines`、忽略 `lineHeight`
→ 全部被抓（数行那条在补了 `__arkui_dom_countLines` 后由 2 条直接断言抓到）。

## R13：纯绘制类 `Progress` / `Gauge` / `DataPanel` / `Rating` ✅

```
$ bash run.sh drawdemo
=== ALL PASS ===                    （47 条断言）
PASS --progress 自定义属性 = '50%'（期望 50%）
PASS 无障碍属性 role/aria-valuenow = 'progressbar'/'50'
PASS 填充实际宽度 = 100（容器 200，期望 100）
PASS 值弧占比 = 25（value 25 / total 100）
PASS startAngle=180 → 弧起点在底部中央 (60.0, 115.0)
PASS startAngle=0 → 弧起点在顶部中央 (60.0, 4.0)
PASS 默认角度 → 整圆拆成 2 条 arc（实际 2 条）
PASS 整圆首尾点重合（起点 (50,3) ≈ 终点 (50,3)）
PASS min/max 生效：value 40 ∈ [20,60] → 比值 0.5 → 未填充 50%
PASS 环形用 conic-gradient 绘制
PASS 各段占比 = 30,20,50（values [30,20,50] / max 100）
PASS 段宽按 values/max 分配：20, 60（容器 200，期望 20/60）
PASS rating=3 → 高亮星数 = 3
PASS rating=2.5 + stepSize 0.5 → 满星 2 + 半星 true
PASS 点击第 5 颗星后 onChange 传回 5：'rating=5'
PASS starStyle 的图片 URI 不可用已记警告
```

**画法按形状天然二分**：条形用 div + `--progress`、环形分段用 `conic-gradient`、
弧与星用 SVG。四个必须记住的点：

1. **弧长用 `pathLength="100"` 归一化** → `stroke-dasharray` 的第一个数**直接就是百分比**，
   断言不必去反推 `2πr`。
2. **整圆不能只画一条 arc** —— `endAngle` 默认就是 360，而起终点重合的 arc **渲染成空**，
   必须拆成两个半圆。⚠️ 这条是**默认情形**，我第一版 fixture 只有半圆、**等于没测**。
3. **角度约定照 `.d.ts` 的 JSDoc**：0 点 = 0°、顺时针为正。断言只钉"起点在顶部/底部中央"，
   **不钉半径** —— `r = min(w,h)/2 - strokeWidth/2` 是本实现的选择，不是规范。
4. **绘制要等尺寸生效**：`.width/.height` 是 create 之后才应用的，
   所以真正的绘制放在 `syncDrawings`（与 `syncAlignRules` 同一时机），create 时只建骨架。

**一个必须出声的地方**：`Rating.starStyle` 传的是**图片 URI**，本运行时没有资源管线 →
加载不了。所以**退化为内置星形并记警告**，而不是静默画一个"看起来对"的星。

**顺手把一条旧断言升级了**：`Progress` 从生成的 `<progress>` 骨架改成手写 div 实现，
`test/components.html` 里那条断言随之失败 —— 这是"测试编码了旧契约"的典型信号。
新断言**更强**（同时看 `--progress` 百分比与 `role`/`aria-valuenow`），不是放宽。

**破坏验证（4 处）**：角度约定取反、不拆整圆、DataPanel 不按 values 分配、不认半星
→ 9 条断言失败、跨 4 个分组。
**并因此发现测试结构的真问题**：一处断言抛异常会**吞掉后面所有断言**（DataPanel 与 Rating
的破坏当时完全没被暴露）→ 改成**分组隔离**（`group()` 逐组 try/catch），之后四处破坏全部现形。

## 工程化 ✅

项目最初不是 git 仓库（287 MB 里 283 MB 是解压的 Electron），改动不可审计、回归不可复现。
现已补齐：

| 能力 | 入口 | 说明 |
|---|---|---|
| 版本控制 | `git log` | 被跟踪源码 / 约 0.9 MB（`.git` 排除 Electron 运行时与产物）（`.gitignore` 排除 Electron 运行时与产物） |
| 环境自检 | `npm run preflight` | 缺 CLT/Chrome/Electron **或脚本缺 `+x`** 都会明确报错 |
| 统一验收 | `npm run check` | **退出码只看被调命令**，绝不用 `grep`/`wc` 数日志行 |
| 生成物守门 | `npm run check:gen` | `--check` 只比对不落盘，漂移即非 0 退出 |
| 文档数字守门 | `npm run stats:check-doc` | `ARCHITECTURE.md` §6 的整块实测数字逐行比对，漂移即非 0 退出；`stats:write-doc` 就地重写 |
| 覆盖统计 | `npm run stats` | 文档里的所有数字都由它产出（`--json` 机器可读） |

`npm run check` 当前：**浏览器 22 用例 + Electron 21 用例全绿**。

## 下一步

**权威清单在 `docs/ROADMAP.md`**（每项带可复现的验收命令）。当前优先：

1. **R17** `onMeasureSize`/`onAreaChange` 与真实布局对齐（R16 变高列表已完成，R17 可直接复用这套实测原语）
2. **R18–R21** 平台模块：`@ohos:media`、`notification`、`startAbilityForResult`+`promptAction`、浏览器真 fs
3. **R22–R23** 动画（`animateTo`/`transition`）与手势（`Gesture`）

**仍未覆盖**：动画/转场、手势（**含 `Swiper` 的滑动翻页**）、`chainMode`、
`Navigation` 的**标题栏/工具栏与分栏模式**、其余 85 个骨架组件的视觉语义、`@ohos:media`/`notification`。
**别把没验的当结论**——`docs/CAPABILITY.md` 里有逐项的能力矩阵，其中标了哪些语义是**推断**的。

**已知待办（别当已完成）**：

- `ForEach` 现在是「数组变了就整体重建」，**没有键级 diff**
- 父组件重渲染时参数推送走 `updateStateVarsOfChildByElmtId`，但**子视图内部的 elmtId 迁移未处理**（复杂嵌套可能出问题）
- `Repeat` / 动画 / `Tabs.vertical`·`barMode` / `Swiper` 的动画与 `displayCount` /
  `Navigation` 的标题栏与分栏 / `Grid` 无模板时的 `cellLength` 自适应 / `chainMode` /
  `Gauge.indicator`·`trackShadow` **未覆盖**（这些会记 `layoutWarnings`，不是静默忽略）
- **布局仍不是约束求解器**：多层锚链靠不动点迭代（有上限），环状锚定只记警告

---

## 测量结果（①.5）

原计划"直接代码生成 150 个组件"**优先级错了**。用重页面（`pages/Rich.ets`：自定义组件 + `@Prop` + `@Link` + `@Builder` + `ForEach` + `List` + `if/else` + `Button`）测量后，真正的难点是 **7 个机制**，不是组件数量。

两个样本（模板应用 / 重页面）的完整接口面对比见 `docs/surface-measurement.md`——**样本 A 严重低估**（组件 2→9、状态类 1→4、运行时全局 4→7、协议方法 +4）。
