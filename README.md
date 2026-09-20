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
runtime/ohos-shims.js          14 个 @ohos:* 平台模块 + 持久化三级后端
tools/extract.mjs              从 hvigor cache 抽转换产物 + 去 TS 类型 + v2 装饰器绑定前奏
tools/gen-components.mjs       由 ets-loader 的组件 JSON 生成骨架（--check 只校验不写）
tools/serve.py                 极简静态服务（端口由 OS 分配，避免冲突）
tools/preflight.mjs            环境自检（工具链 / 宿主 / 可执行位）
tools/check-all.sh             一条命令做完所有验收
tools/stats.mjs                覆盖范围统计（文档里的数字都来自它）
test/*.html                    断言页（31 个用例；断言数由 runner 守门，见 docs/DEVELOPING.md 坑 77）
fixtures/                      冻结的 ets-loader 转换产物（29 个，测试的输入）
harmony-proj/                  HarmonyOS 工程（页面 .ets 源码，转换产物的来源；构建输出不入库）
run.sh                         浏览器 31 用例驱动
electron/run.sh                Electron 30 用例 + 真实磁盘验证
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

`bash run.sh v2` 的 **25 条断言**在浏览器与 Electron 双通过。完整契约（11 个装饰器、`ViewV2` 的 11 个方法、
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

`Grid`/`Tabs` 此前只是"能建出节点"（生成的骨架），本轮补上真实语义（51 条断言，双端通过；`bash run.sh tabgrid`）。

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

## R23：手势（Pan / Tap / LongPress / Swipe / Pinch）✅

```
$ bash run.sh gesturedemo
=== ALL PASS ===                    （24 条断言）
PASS #pad 上挂着 pan（'pan'）／#tap 上挂着 tap／#press=longPress／#swipe=swipe／#pinch=pinch
PASS offsetX≈40、offsetY≈0（实际 40,0）
PASS offsetX≈0、offsetY≈40（实际 0,40）
PASS 位移 3px < distance 5 → 不触发（''）
PASS 点两下触发一次且 repeat=false（'TF;'）／再点两下 → 一次 repeat=true（'TF;TR;'）
PASS 按住 380ms > duration 300 → 触发一次 repeat=false（'LF;'）
PASS 按住期间移动 30px → 不触发长按（''）
PASS 快速滑动触发（'W0v400;'）／慢速滑动（≈66 vp/s < 100）不触发（''）
PASS scale = 距离比 120/40 = 3（实际 'scale=3.00'）
```

**产物里没有 `.gesture()` 方法** —— 手势走的是**两层栈**（全部自由变量）：

```js
globalThis.Gesture.create(GesturePriority.Low);   // ① 打开作用域（名字来自 ets-loader，见「R23 收口」）
PanGesture.create({ fingers: 1, direction: PanDirection.All, distance: 5 });
PanGesture.onActionStart(cb); … ;
PanGesture.pop();                                 // ② 收一个手势
globalThis.Gesture.pop();                         // ③ 关作用域 → 挂到"当前节点"（组件栈顶）
```

识别器全部基于**真实 DOM pointer 事件**（+ `setPointerCapture`），所以合成事件与真实指针同一条路。
`TapGesture.count` 归组并给 `repeat`；长按按 `duration` 且**中途移动即取消**；`PanGesture` 超过 `distance`
才 Start（`offsetX/offsetY` 相对按下点）；`SwipeGesture` 按 `speed`（**vp/s**）与 `angle`
（水平向右为 0，顺时针正 —— 照 `.d.ts`）；`PinchGesture.scale` = 当前距离 / **第二指按下时**的距离。

**一个真踩到的 bug**：`PinchGesture` 的基准距离写成"第一次 move 时取" → 第一帧的移动成了基准 →
`scale` 永远是 1（识别器静默失效）。破坏验证复现了 3 条红。

**破坏验证**（5 项）：pan 的 offset 写死成标量距离 → 1 条红；忽略 `distance` → 1 条红；
长按不因移动取消 → 1 条红；忽略 swipe 的 `speed` → 1 条红；pinch 基准距离写错 → 3 条红。
（第二项**第一次注入失败**：改的是"未传 distance 时的默认值"分支，而 fixture 显式传了 `distance: 5` ——
**变异没落在被测路径上**，断言照样通过。改成真的忽略阈值才红，记进了坑表 75。）

**本条验收时未实现**（同日由下一节「R23 收口」全部补上）：`RotationGesture`/`GestureGroup`/
`priorityGesture`/`parallelGesture`，以及手势**优先级与冲突仲裁** —— 当时同一元素上多个手势会**并列触发**。
（**遗留至今**：`fingerList` 恒为空数组 —— 不合成手指轨迹。）

## R23 收口：手势分组与优先级仲裁 ✅

R23 明确留下的四项：`RotationGesture`、`GestureGroup`（三态）、`priorityGesture`/`parallelGesture`、
以及**优先级仲裁**（原先 `GesturePriority`/`GestureMode`/`GestureMask` 只记录、不参与决策）。

**先测量**（新增 `pages/GestureGroupDemo.ets` → 官方构建 → 读产物），量出三条关键约定：

1. **三个属性发射的是同一套协议**，只差 `Gesture.create()` 的第一个实参：
   `.gesture` → `GesturePriority.Low`、`.priorityGesture` → `High`、`.parallelGesture` → `Parallel`。
2. **这些名字来自 ets-loader，不是 `.d.ts`**：`pre_define.js` 里 `GESTURE_ENUM_KEY="GesturePriority"` +
   `GESTURE_ENUM_VALUE_LOW/HIGH/PARALLEL="Low"/"High"/"Parallel"`；而 `.d.ts` 声明的
   `GesturePriority { NORMAL = 0, PRIORITY = 1 }` 是**另一套**（API 12 的 `addGesture` 用）。
   **旧实现只定义了 `{NORMAL, PRIORITY}` → 产物的 `GesturePriority.Low` 是 `undefined`，
   三个属性在运行时完全区分不开**（都退化成默认档）。这是本轮修掉的 bug，现在两套名字并存
   （`NORMAL=Low`、`PRIORITY=High`，`Parallel` 是产物独有的第三档）。
3. **`GestureGroup` 是"容器式"的 create/pop 协议**，`onCancel` 紧跟 create；`Gesture.create` 还是
   **两参**的（第二参 `GestureMask`，旧实现只取第一个）：

```js
globalThis.Gesture.create(GesturePriority.Low);                       // 作用域
GestureGroup.create(GestureMode.Exclusive);                           // 组（容器）
GestureGroup.onCancel(cb);
TapGesture.create({…}); TapGesture.onAction(cb); TapGesture.pop();    // 进的是【组】而不是作用域
PanGesture.create({…}); PanGesture.onActionStart(cb); PanGesture.pop();
GestureGroup.pop();                                                   // 组进【作用域】
globalThis.Gesture.pop();                                             // 挂到组件栈顶元素
```

**仲裁按三条独立规则实现**，每条都引了 `.d.ts` 原文（见运行时注释）：
**元素级（父子链）** `gesture`="子组件优先"、`priorityGesture`="父组件优先"、`parallelGesture`="准冒泡、
父子都响应"、`GestureMask.IgnoreInternal`="禁用子组件手势"，在 `pointerdown` 时**一次性定下**
（事件由内向外冒泡 → 内层先认领、外层可覆盖），识别循环只查结论；**组级** Exclusive 先认出者独占、
Sequence 按序推进且"只有最后一个能收 `onActionEnd`"、Parallel 互不影响；**元素内多作用域**取最高档
（`block > high > parallel > low`），不做逐手势区分（已知近似）。

```
$ bash run.sh gesturegroupdemo
=== ALL PASS ===                    （39 条断言）
PASS GesturePriority.Low 与声明名 NORMAL 同值（Low=0）／High 与 PRIORITY 同值／Parallel 是独立第三档
PASS #gx 登记为 Exclusive[tap,pan]／#gs=Sequence[longPress,pan]／#gs2=Sequence[pan,pan]／#gp=Parallel[tap,longPress]
PASS angle = +90°（顺时针为正）／反向旋转 → −90°／只转 0.29° < 阈值 1° 不触发
PASS 单指移动不触发 rotation（fingers:2 要真的起作用）
PASS 长按后直接抬指 → 第 2 段不认 + 组 onCancel（'S1;Sc;'）
PASS 位移 2px：阈值 1px 的 pan 被序列门控挡住（''）
PASS 只有最后一个手势能收 onActionEnd（非末位 pan 的 End 被挡，'U1;U2;U2e;'）
PASS 默认：子优先、父不被触发（'e;'）／priorityGesture：只有父触发（'P;'）
PASS parallelGesture：子与父都触发（'d;L;'）／IgnoreInternal：子组件手势被禁用（'M;'）
PASS 仲裁决议可内省：父是 owner、子被 suppressed
```

**修掉的两个真 bug**（都是"静默失效"型，靠断言才现形）：
① `pointerup` 会**继续往外冒泡**，而会话状态被最内层元素先删掉 → 外层查不到仲裁结论、被压制的祖先
**误触发**（默认档的父子对当场红）→ 改成只由**冒泡路径上最后参战的那个元素**删会话；
② 识别器在"回调被组门控挡下"时**照样把 `started` 置真** → 被挡的手势此后永远发不出 `onActionStart`
（Sequence 里表现为"该认的不认、不该发的 End 乱发"）→ 改成 `fireGesture` 返回"有没有被放行"，
识别器只在放行时推进内部状态。

**破坏验证**（3 项，各被精确抓住）：① 关掉元素级仲裁门控 → 恰好 3 条红（默认对 / priority / mask）；
② 旋转角度取绝对值 → 恰好 1 条红（反向旋转）；③ 拿掉 Sequence 门控 → 3 条红，且日志里 `U2;`
抢在 `U1;` 前面（乱序可见）。

**已知限制**：**组与仲裁的语义是按 `.d.ts` 文档注释实现的，不是真机实测** —— 本机没有 ArkVM（见
`docs/ARKVM-RESEARCH.md`），这里是"按文档 + 断言固化"；`RotationGesture` 的起始线取**第二指按下时**的
连线（`.d.ts` 说"detected 时"，差异上界即 `angle` 阈值本身）；`GestureMask.IgnoreInternal` 按文档正文
实现为"压制所有后代（含并行）"；多指分别落在不同元素上时，元素级仲裁按"每个指针各自认领"处理（近似）；
`fingerList` 仍恒为空。

## R22：显式动画 `animateTo` ✅

```
$ bash run.sh animdemo
=== ALL PASS ===                    （36 条断言）
PASS 节点带上了 transition：prop='all' dur='300ms'
PASS curve 进了 transition-timing-function：'ease-in-out'
PASS fn() 里的状态变更真的落地：w=220 op=0.5
PASS 窗口结束后 transition 被清掉（prop='' dur=''）—— 否则会污染后续变更
PASS onFinish 被调用（fin='A;'）
PASS 不进动画：调用返回时没有任何节点被标记为动画目标（实际 0 个）
PASS 自省如实记为 duration-0 且 0 个节点：{"duration":0,"endedBy":"duration-0","els":0}
PASS delay 真的进了 transition-delay：'120ms'
PASS 动画只挂在【真的被重渲染】的节点上，没顺手改别的元素（box 的 opacity 没依赖）
PASS iterations 被点名、playMode 被点名
PASS 未写 duration 时取 .d.ts 的默认 1000（实际 1000）
ANIM history=["300/EaseInOut/3el/timer/te=false","0/EaseInOut(默认)/0el/duration-0/te=false",…]
```

**先测调用约定，别按源码写**：源码里是**全局** `animateTo(value, event)`，编译后是
**`Context.animateTo(...)`**（`Context` 是自由变量）。只挂一个裸名 `animateTo` 会 `ReferenceError`。
`Curve`（13 成员）/`PlayMode`（4 成员）同理。默认值照 `.d.ts`：`duration` **1000**、`curve` **EaseInOut**。

**语义**：`fn()` 改状态 → 同步 flush → 给**这次真的被重渲染的节点**挂
`transition: all <duration>ms <curve> <delay>ms` → 到点清掉并调 `onFinish`。
`duration:0` **不进动画**（不挂 transition、不标记），但状态变更照常落地。

**两端差异（如实记录）**：诊断行里的 `te=`（`sawTransitionEnd`）在 headless Chrome 全 `false`、
Electron 里框宽那几次为 `true` —— **"我们把 transition 挂上又按期清了"** 与
**"浏览器真的跑了过渡"** 是两件事，分开报，但**不做断言**（那是宿主能力差异，不是对错）。

**降级要出声**：`.d.ts` 的 `iterations`/`playMode`/`tempo`/`expectedFrameRateRange` 与"弹簧"曲线
（`ICurve`）在 CSS transition 里没有对应物 → 一律写 `layoutWarnings`，绝不静默按"看着像"的方式跑。
`fn()` 没引起任何重渲染时也出声（`.d.ts` 专门警告别在 `aboutToAppear` 里用 `animateTo`）。

**破坏验证**（5 项）：`duration:0` 也走动画分支 → 2 条红；不安排收口 → **12 条红**；
动画挂到"整棵子树"而非被重渲染的节点 → 5 条红；`iterations` 静默 → 1 条红；`duration` 默认写成 0 → 3 条红。
（第一项还暴露了一处**假通过**：原本查 `box` 的 transition，而那次只有读 `op` 的 Text 被重渲染 ——
改成"调用返回时没有任何节点被标记"，且必须**在同一 tick 内**读，否则会被 30ms 的清理计时器变成竞态。）

**当时未实现（已在下一节收口）**：`transition`（出现/消失动画）—— 按不变量 3 落 `data-*`、不假装动画，
仍留在 ROADMAP 待办里；`animateToImmediately` 与 `animateTo` 在本运行时等价。

## R22 收口：`transition`（组件出现/消失动画）✅

`transition` 是 R22 明确留下来的待办（当时按不变量 3 落 `data-*`、**不假装动画**）。现在补上了：
**组件被插入/删除**时播放过渡，两种机制都覆盖 —— `TransitionOptions`（自己没有时间字段，参数来自外层 `animateTo`）
与 `TransitionEffect`（自带 `.animation()`，**不需要** `animateTo`）。

**先测量**（新增 `pages/TransitionDemo.ets` → 官方构建 → 读产物）：`Text.transition({…})` 是**属性调用**
（走 builder 栈），但 `TransitionEffect`/`TransitionType`/`TransitionEdge` 是**自由变量**（运行时必须提供全局）；
两参重载 `Text.transition(effect, cb)` 真会传两个实参，而生成的属性方法是 `function (v) {…}` ——
**只取第一个参数会把 `onFinish` 静默丢掉**；最坑的是**顺序**：产物是 `create → id → transition`，
即**规格在挂载之后才到**，所以"出现动画"不可能在 `mountNode` 里跑（第一版就这么写，断言当场抓住）。

**消失动画的关键决定**：分支切换 / `ForEach` 重建时**不能立刻 `remove()`** —— 带消失过渡的子节点
要留在 DOM 里把动画走完再到点摘（`detachChildren()`）。不延迟摘除，就不可能有消失动画。

```
$ bash run.sh transitiondemo
=== ALL PASS ===                    （58 条断言）
PASS 消失过渡进行中，A 仍在 DOM 里（没被立刻摘掉——否则根本没有消失动画）
PASS 过渡走完后 A 才被摘掉
PASS 记录里写下结束方式：endedBy='timer'
PASS 组合结果是一个新实例，链与动画都在新实例上
PASS 登记了 4 个不同的节点（实际 ["a","b","d","e"]）—— 单个节点会被反复登记（重渲染），所以按 id 去重
```

**破坏验证**（4 项）：`detachChildren` 改成立刻摘除 → **13 条红**；忽略 `type` 方向门控 → 6 条红；
`onFinish` 恒传 true → 1 条红；忽略 `TransitionEffect` 自带的 `animation()` → 5 条红。

**已知限制**：`SLIDE`/`SLIDE_SWITCH` 的参数 `.d.ts` 没给 → 近似并**出声**（推断）；`centerX`/`centerY`、
`translate.z` 未实现；消失过渡期间节点**仍占布局位**；`Tabs`/`Swiper`/`LazyForEach` 窗口变化与
`Navigation` 转场等**其它删除路径**仍是立刻摘除。

## R21：后端是什么就说是什么 ✅

```
$ bash run.sh realfs
=== ALL PASS ===                    （21 条断言）
FS backend=localStorage isFileSystem=false osVisiblePath=false root=(localStorage) | OPFS 探测 ok=false 卡在=getDirectory() 200ms
NOTE OPFS 实测【不可用】：卡在 getDirectory()（getDirectory() 超时 200ms），预算 200ms/步，实测 200ms
TRUTH 非真文件系统（localStorage：键值存储，无路径、有配额、清站点数据即失效）
PROBE ["getDirectory():200ms✗"]
PASS 点 write 后产品报了 written
PASS 点 read 读回内容（'hello from arkts'）
PASS 非 OS 可见后端必须明确声明"这不是 OS 路径"，而不是给个看着像的字符串：'(localStorage 无真实路径)'
PASS 即便后端不是文件系统，读写依然成立（'hello from arkts'）——"能持久化"与"是文件系统"是两件事
```

`bash electron/run.sh realfs` 也全过，且**自报完全不同**（同一台机器、同一个 API）：

```
FS backend=node-fs isFileSystem=true osVisiblePath=true root=<repo>/electron/data | OPFS 探测 ok=true 28ms
PROBE ["getDirectory():28ms","getFileHandle(create):9ms","createWritable():1ms","write+close:2ms","读回:3ms","清理:1ms"]
PASS 该文件在真磁盘上确实存在（外部核验，不靠页面自报）：vfs=/vfs/files/demo.txt → real=…/electron/data/files/demo.txt
```

**要点**：「能持久化」和「落到了文件系统」是**两件事**。`describe()` 给出**真值表**
（`node-fs` → 文件系统 + OS 可见路径；`opfs` → 文件系统但无 OS 可见路径；`localStorage` → **非真**文件系统），
测试把那一行人话**打印并断言** —— 让"看起来持久化"无处藏身。

**两条不变量**：

1. **"我们没启用"≠"不可用"**。默认不用 OPFS 是为了两次运行选到同一后端（确定性），
   所以探测 `ok=true` 时必须说【可用】并说明为何未启用，绝不许说成"不可用"。
2. **探测必须【有界】**。失败路径上 `getDirectory()` **永不 resolve**，连"清理"都不能 await 没有超时的调用
   —— 早先就是这么写的，把 200ms 的探测撑成 **2172ms**（实测踩到）。

**探测不是把注释当结论**：`probeOpfs(budget)` 真的走 getDirectory → getFileHandle → createWritable →
write+close → **读回** → 清理，每步带超时并记耗时。顺带纠正一句旧结论："OPFS 会挂"应说成
"**headless Chrome 里**卡在 `getDirectory()`" —— Electron 的 Chromium 里 28ms 全过。

**破坏验证**（4 项）：谎报"localStorage 是真文件系统" → **5 条红**（连外部核验都跟着失败）；
cleanup 改回不限时 → **整个用例挂住、120s 超时**；不看探测结论就说【可用】→ 1 条红；
`realPath` 原样吐回 vfs 路径 → 1 条红，**并因此发现最初那条 `!p.startsWith('/')` 断言没有牙齿**
（换个串就蒙过去）→ 改成要求"明确声明不是 OS 路径"。

## R20：`startAbilityForResult` + `promptAction` ✅

```
$ bash run.sh promptaction
=== ALL PASS ===                    （37 条断言）
PASS 起了 2 个被启动 ability 窗口（created=2）
PASS 两个窗口都已关闭（closed=2 open=0）
PASS 窗口载入的是被启动方自己的页面：["pages/Callee","pages/Callee"]
PASS 窗口里真的渲染过被启动方的页面：["被启动的 ability 窗口",…]
PASS 终态：被启动窗口的 DOM 已移除（回到调用方窗口）
PASS startAbilityForResult(promise) 拿到结果：promise-formed: code=207 answer=14
PASS 回调拿到的 resultCode 也由 want 算出（200+3=203）
PASS 被启动方 terminateSelf() 不给结果时，调用方没挂住：no-result-formed: code=0
PASS duration 夹取符合声明（100→1500、1500→1500、999999→10000）：'1500,1500,10000'
PASS 缺 message 时同步抛出且点名字段（void 版的 @throws 契约）
PASS 点"确定"后对话框节点消失
PASS resolve 出被点按钮的下标（从 0 起）：'idx=1;'
PASS 1500ms 生效时长的两条已自动消失（剩 ["提示丙"]）
PASS 夹到 10000ms 的那条还在（说明生效时长确实是 10000，不只是记了个数）
```

**先纠一个前提**：ROADMAP 原先要断言的 `onResult`（`onAbilityResult`）在 API 26 SDK 里**不存在** ——
`grep -r onAbilityResult <SDK>/ets/api/` **0 命中**。stage 模型的结果**只**从
`startAbilityForResult` 回来（Promise 与 AsyncCallback 两种形态）。验收据此改成"两种形态都拿到
**由 want 算出的** resultCode 与 want"（`resultCode = 200 + q`、`answer = q × 2`，写死会被抓住）。
顺带两条小更正：`startAbility` 其实**没有**实现过；模块名是 `@ohos.promptAction`。

**ability = 一份生命周期 + 一个窗口**：子 ability 渲染进新建的窗口容器
（`div[data-arkui-ability-window]`），结束顺序 `onWindowStageDestroy → onDestroy` → 移除窗口 → 交回结果。
**窗口移除前把它的 `textContent` 快照存起来** —— 不然"被启动方真的渲染了自己的页面"就只剩一行日志可说。

**一个必须的次序**：结果接收者要在**跑子 ability 生命周期之前**登记好。子 ability 完全可能在自己的
`onWindowStageCreate` 里**同步**就 `terminateSelfWithResult`（"拿到结果就走"）。次序写反**不报错，
而是结果永远不回来** —— 破坏验证里专门注入了这一版，被 5 条断言抓住。

**`promptAction` 的三个非显然细节**（全部照 `.d.ts`）：`showToast` **返回 void**（不是 Promise）；
`duration` 默认 **1500**、范围 **[1500,10000]**、**小于 1500 用默认、大于 10000 取上限**；
`showDialog` 的 `index` 是**被点按钮下标（从 0 起）**。两个函数自 API 18 起 **deprecated**
（`@useinstead UIContext.PromptAction#…`）。

**"抛"还是"拒"——靠编译器的警告差异定音**：编译器对 `showToast`（void 版）报
*"Function may throw exceptions. Special handling is required."*，对 `showDialog`（Promise 版）**不报**
→ 实现取 **void 版同步抛 401、Promise 版 reject**；fixture 一条 `try/catch`、一条 `.catch` 各接一种。
（补上 try/catch 后那批警告归零，反向印证了这个解释。）

**没有按钮的对话框：响亮失败**。没有按钮就没有结束方式，而点遮罩结束时的 `index` 语义 `.d.ts` 未规定
→ 与其造一个永远点不掉的假对话框，不如 reject 401 并说明要传 `buttons`。断言还钉住"只有一个对话框节点"。

**破坏验证**（7 个注入错误实现，各被精确抓住）：忽略传进来的 `resultCode`（2 条红）/
关窗只记账不摘 DOM（2 条）/ 子 ability 渲染进调用方的根、不做窗口隔离（9 条）/ `duration` 不夹取（3 条）/
`index` 写死 0（1 条）/ 允许没有按钮的对话框（3 条）/ 结果接收者登记晚了（5 条）。

## R19：通知 `@ohos.notificationManager` ✅

```
$ bash run.sh measnotify
=== ALL PASS ===                    （32 条断言）
PASS publish×2 + cancel + cancelAll 全部 resolve：'p1;p2;c1;ca;'
PASS 抛出了错误：'notificationManager.publish(id=3): content 里没有可显示内容 …'
PASS 第 1 条 payload 被解析：id=1 title='标题A' text='正文A'
PASS 被拒绝的那条没有进历史（不是"记了又没发"）
PASS cancelAll 后活动通知为空（active=0）
PASS 记录了投递路径 via='host-Notification'
PASS 记录了宿主权限 hostPermission='default'
PASS 凡不能确证真弹出都写出了原因：'宿主通知权限为 default（已创建通知对象，是否真的弹出由宿主决定）'
PASS 回调重载返回 undefined（对应 .d.ts 的 void 重载）
PASS 回调不在调用栈内同步触发
PASS 权限被拒时 publish 仍然 resolve（拒绝投递 ≠ API 出错）
PASS 没有"先构造再吞掉"（替身构造次数 0）
PASS 浏览器（降级是预期）下 notification 告警 0 条（期望 0）
```

`bash electron/run.sh measnotify` 同一份断言页也全过，且**最后一条的期望值不同**：
`permission=granted` → `reason` 为空（确证送达）、`Electron（期望真通知）下 notification 告警 1 条（期望 1）`。

**难点不在"调用 API"，在"别谎报送达"**。DOM 里没有"系统通知"这一层，所以每次 `publish` 都如实记下
`via`（`host-Notification` / `record-only`）、`hostPermission`、`reason`，并守一条不变量：

> **只有 `via='host-Notification'` 且 `hostPermission='granted'` 才算确证送达；其余一切情况都必须写出 `reason`。**

为什么不能压成"两档"：`permission='default'`（未授权）时**浏览器照样能 `new Notification()` 成功**——
不抛错、也没被拒。把它当作"已送达"就是最典型的"看起来发了"。两端实测差异被断言钉住
（`hostCreated` 计数 + 权限 + 原因），破坏验证里专门注入了"`via` 说走了宿主但 `reason` 留空"的
**谎报送达**实现，被该断言精确抓住。

**降级告警的边界**：浏览器没有系统通知是**预期**降级 → 只写日志；Electron（preload 注入过 Node fs）
里"没送达"意味着用户看不到 → 进 `layout_warnings`。测试把宿主 `Notification` 换成 `permission='denied'`
的替身来量这条边界，**两端期望值不同**（0 条 / 1 条），并额外断言替身的**构造次数为 0**——
不允许"先建再吞"。

**回调重载也必须异步**（`AsyncCallback` 语义），且该重载返回 `undefined` 而非 Promise；单独有断言守着。

**页面源码进了仓库**：`harmony-proj/` 是 `devecocli create` 出来的 HarmonyOS 工程（API 26），
`.ets` 页面源码随之入库 —— 之前工程放在 `/tmp`，一次重启（tmpfs）就没了，fixture 变得不可复现。

**已知限制**：`picture`/`conversation` 内容类型不渲染（不认就响亮失败，不假装发了）；
`sound`/`vibration`/`slotType`/`badge`/`group` 忽略；`on('click')` 未实现；**不做系统级断言**
（不依赖桌面环境真的弹出）。

## R18：图像信息 `@ohos.multimedia.image` ✅

```
$ bash run.sh measimage
=== ALL PASS ===                    （13 条断言）
PASS known-7x3.png → 7×3（期望 7×3）
PASS known-13x5.png → 13×5（期望 13×5，证明不是写死的）
PASS PNG → 'image/png'
PASS 真 JPEG（扩展名 .jpg）→ 'image/jpeg'（写死成 png 会被这条抓到）
PASS 伪装文件（PNG 字节 / .jpg 扩展名）→ 'image/png'（解码格式优先于响应头）
PASS 异步解码之后再问同步版 → 7（取自同一份真实结果）
PASS 未解码时 getImageInfoSync 抛错（'threw'）
PASS 错误信息里带上了出问题的 URI（可操作）
```

**模块名要更正**：ROADMAP 写的是 `@ohos:media`，实际是 **`@ohos.multimedia.image`**
（`@ohos.multimedia.media` 是音视频播放那套）。产物里是 `import image from "@ohos:multimedia.image"`。

**两条实现取向**：

1. **解码交给浏览器**（`fetch` → `blob` → `createImageBitmap`），不自己解析 PNG/JPEG 头——
   宽高来自真实解码器。同 R15"让浏览器自己排版"。
2. **`mimeType` 嗅探真实字节的魔数，不用响应的 `Content-Type`**。依据是 `.d.ts` JSDoc 原话
   **"Actual image format (MIME type)"** —— 是**解码后的真实格式**。

## 一次"断言没牙齿"的现场修复

第一版 `mimeType` 断言写成"PNG → `image/png`"——**破坏验证时我把 `mimeType` 写死成
`'image/png'`，断言照样通过**（写死的值恰好等于真值）。这正是前面记过的"断言与实现恰好同值"。

修法：**造出能让错误实现暴露的输入**——

- 加一张**真 JPEG**（11×4）→ 写死 `image/png` 立刻失败
- 加一张**伪装文件**（PNG 字节 + `.jpg` 扩展名，服务端按扩展名给 `image/jpeg`）→ 用响应头代替嗅探立刻失败

补完之后再破坏，两种错误实现**各被不同的断言精确抓到**。顺带把"`mimeType` 是响应头还是解码格式"
这个语义分歧钉死了。

**破坏验证**：编造尺寸代替真解码 / `mimeType` 用响应头 / `mimeType` 写死 /
同步版编造尺寸而不抛错 / 404 静默返回 0×0 → 全部被抓。

## R17：`onAreaChange` + 自定义布局协议 ✅

```
$ bash run.sh measarea
=== ALL PASS ===                    （28 条断言）
PASS onAreaChange 已触发且回传了宽高（日志 "A|120x30|B|0>100|"）
PASS 回调宽度 120.0 == 真实 rect 宽度 120.0        ← ROADMAP 的验收
PASS oldValue 宽度 100.0 == 变化前的真实值 100.0
PASS newValue 宽度 140.0 == 变化后的真实值 140.0
PASS measure() 的返回值遵守了约束 maxWidth=60（实测 14.9 × 6 次）
PASS 组件宽度 = 返回的 width 60（实测 60.0）        ← 返回值覆盖声明尺寸
PASS selfLayoutInfo.width 320 == 父容器内容宽 320（覆盖前的真实尺寸）
PASS 第 2 项紧接在第 1 项下方（y=20.0 ≈ 第 1 项高 20.0）
PASS layout(position) 用绝对定位落位
PASS 自定义布局执行 2 趟（有上限，不无限回调）
```

**R17 的原始前提是错的**，实测后拆成两件互不相关的事：

| | 是什么 | 关键事实 |
|---|---|---|
| `onAreaChange(cb)` | **链式** `CommonMethod` | 这才是"回传真实尺寸"的那条：`newValue` = 真实宽高 + 相对父/页坐标 |
| `onMeasureSize`/`onPlaceChildren` | **组件结构体上的方法** = **自定义布局协议** | 必须成对实现；**返回值优先级高于声明的 width/height**；`Measurable.measure(c)` 要回真实测量；`Layoutable.layout(pos)` 负责摆放 |

**测出来的两条硬约束（各花掉一次编译失败）**：

1. **`@Entry` 的 `build` 只能有一个【容器】根节点**（编译器原话："can have only one root node, which must be a container component"）→ "多子项 builder 模式"只适用于**嵌套 `@Component`**。
2. **带链式属性的自定义组件会被编译器包一层 `__Common__`**（`__Common__.create(true); …; __Common__.pop();`）—— 它**不在 149 组件注册表里**，不实现就 `ReferenceError`。

**实现要点**：`onAreaChange` 在渲染后按真实几何派发（与不变量 18 同一条纪律：不能在属性应用时算）；
自定义布局由 `ViewPU.create` 在 `childView.initialRender()` **之后**触发，`measure()` 直接读真实 rect，
返回的尺寸写到"带 `.id()` 的那一层"（可能是 `__Common__` 包装器），`layout(pos)` 落绝对定位，收敛上限 3 趟。

**我这轮又栽在"测试解析页面输出的格式"上**：页面把回调参数拼成 `A|120x30|`，
我却按"token 以 A 开头"去找 → 找不到，一度以为回调没传值。**实际日志里数字完全正确**。
→ 改成用正则直接解析，并把原始日志打进输出（`RAWLOG`）便于核对。

**破坏验证（4 处）**：面积不算真实值 / `measure()` 不真实测量 / 不应用返回的 `SizeResult` /
`layout()` 不摆放 → **12 条失败、跨 5 组**。

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

`npm run check` 当前：**浏览器 31 用例 + Electron 30 用例全绿**。

## 下一步

**权威清单在 `docs/ROADMAP.md`**（每项带可复现的验收命令）。当前优先：

1. `Navigation` 的标题栏/工具栏与分栏模式、其余 85 个骨架组件的视觉语义、`@ohos:media`/`UIContext`
2. **`runtime/` 的物理拆分**（见下方「已知待办」最后一条）

> 已完成：`transition`（见上文「R22 收口」）、**手势分组与优先级仲裁**（见上文「R23 收口」）、
> **R24 ArkVM/`.abc` 路径调研**（`docs/ARKVM-RESEARCH.md`）。

**仍未覆盖**：`chainMode`、`Navigation` 的**标题栏/工具栏与分栏模式**、其余 85 个骨架组件的视觉语义、
`@ohos:media`/`UIContext`。
**别把没验的当结论**——`docs/CAPABILITY.md` 里有逐项的能力矩阵，其中标了哪些语义是**推断**的。

**已知待办（别当已完成）**：

- ~~文档里手写的「（N 条断言）」**没有守门**~~ → **已加守门（2026-09-21）**。做法与当初设想的"第 6 步：让
  `stats.mjs` 数 `test/*.html`"**不同**，因为那个设想本身是错的：`test/realfs.html` 有 28 处 `check(`，
  但两端各只**执行** 21 条（7 处在互斥分支里没走到，浏览器走 `localStorage` 那支、Electron 走 `node-fs` 那支）。
  静态计数会把"没跑到的断言"也算进去。所以改成：`run.sh` / `electron/run.sh` 在 `run_one` 里落盘
  `build/assert-counts-<端>.tsv`（**运行期**真的 emit 了多少条 PASS 行），退出时由 `tools/assert-counts.mjs`
  与文档声明比对——用 **EXIT trap**，所以**单个用例**也受守门（`bash run.sh gesturedemo` 也会核 24 条）。
  加守门的当天就查出 **7 处**旧错：v2 记成 26（实际 **25**）、observe 记成 20（实际 **19**），跨 3 个文件；
  另把 README 里两处"有数字但没写用例名"的散文改成规范写法（否则守门认不出来）。
  规范写法只有两种：① 同行写 `bash run.sh <用例>` …（N 条断言…）；② 围栏块内先出现 `run.sh <用例>`，
  块内随后的「（N 条断言）」归它。细节与判据见 `docs/DEVELOPING.md` 坑 77
- `ForEach` 现在是「数组变了就整体重建」，**没有键级 diff**
- 父组件重渲染时参数推送走 `updateStateVarsOfChildByElmtId`，但**子视图内部的 elmtId 迁移未处理**（复杂嵌套可能出问题）
- `Repeat` / 动画 / `Tabs.vertical`·`barMode` / `Swiper` 的动画与 `displayCount` /
  `Navigation` 的标题栏与分栏 / `Grid` 无模板时的 `cellLength` 自适应 / `chainMode` /
  `Gauge.indicator`·`trackShadow` **未覆盖**（这些会记 `layoutWarnings`，不是静默忽略）
- **布局仍不是约束求解器**：多层锚链靠不动点迭代（有上限），环状锚定只记警告
- **`runtime/arkui-dom-runtime.js` 是 4615 行、约 216 KB 的单闭包**（`runtime/` 三个文件合计约 328 KB / 9243 行）。
  它**不是没结构**（内部 30 个分节/子节横幅覆盖 99% 的字节：141 个函数 / 13 个类 / 147 个顶层 const），
  但**没有物理拆分**。约束是真实的：产物是经典脚本（全文 0 个 `import`/`export`，由 30 个手写 HTML
  按固定顺序 `<script src>` 加载，Electron 直接加载同一批页面），`tools/` 里**没有打包器**，
  而 `elmtIdSeq`/`elmtRecords`/`propDeps`/`ViewStackProcessor`/`currentNodeElmtId`/`pageStack`
  是被各节双向引用的闭包状态。
  已实测**最容易下的一刀**：动画+手势两节（281–1373 行，1093 行 / 约 54 KB）向内只提到
  `ViewStackProcessor` 1 次、`mountNode` 1 次（`elmtRecords` **0 次**），向外只被 4 个入口引用
  （`registerTransition` ×2、`detachChildren` ×2、`transitionsDescribe`/`gestureTypes` 各 1）；
  它自己 80 个顶层定义里 **54 个零外部引用**。
  拆法待定（"源拆分 + 极简拼接、产物仍单文件"会把 `runtime/*.js` 从手写源变成生成物，属约定变更）。

---

## 测量结果（①.5）

原计划"直接代码生成 150 个组件"**优先级错了**。用重页面（`pages/Rich.ets`：自定义组件 + `@Prop` + `@Link` + `@Builder` + `ForEach` + `List` + `if/else` + `Button`）测量后，真正的难点是 **7 个机制**，不是组件数量。

两个样本（模板应用 / 重页面）的完整接口面对比见 `docs/surface-measurement.md`——**样本 A 严重低估**（组件 2→9、状态类 1→4、运行时全局 4→7、协议方法 +4）。
