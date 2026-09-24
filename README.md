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
runtime/src/                   运行时【手写源】—— 手写语义都加这里（一个分片 = 一组相关小节）
  main.js                        其余全部（基础设施 / 状态管理 v1 / ViewPU / 属性映射 / Tabs / Swiper /
                                 组件注册表 / 具体组件 / LazyForEach / 枚举路由 / 安装全局）
  animation.js                   显式动画（animateTo → CSS transition）+ 出现/消失过渡（R22/R22 收口）
  gesture.js                     手势（pointer 识别器 + GestureGroup 三态 + 优先级仲裁，R23/R23 收口）
  nav.js                         Navigation / NavDestination 栈导航 + 标题栏/工具栏/分栏 + 转场/滚动联动
  layout.js                      布局（alignRules / Guideline / bias / 文本截断 / 叠放 / Scroller）
  draw.js                        绘制类四件套（Progress / Gauge / DataPanel / Rating）
  area.js                        onAreaChange（真实面积）+ 自定义布局协议
  v2.js                          状态管理 v2（@ComponentV2 全套装饰器）
  ability.js                     ability 栈（startAbilityForResult / terminateSelf*）
runtime/arkui-dom-runtime.js   运行时核心（经典脚本，加载后安装全部 ArkUI 全局）
                               ↑【拼接产物】由 tools/build-runtime.mjs 拼 runtime/src/，不要手改
  ├ v1 状态类（ObservedPropertySimplePU / SynchedProperty*PU）
  ├ ViewPU（组件栈、elmtId 依赖追踪、批量重渲染、If/ForEach、自定义组件挂载）
  ├ ViewV2 + 11 个 v2 装饰器（@ComponentV2 全套）
  ├ 布局（alignRules 六键 / 文本截断 / Stack 叠放 / Scroller）、LazyForEach 虚拟滚动
  ├ 显式动画（Context.animateTo → CSS transition）、出现/消失过渡、手势（含分组与优先级仲裁）
  └ 页面栈与路由
runtime/generated-components.js 149 个组件骨架（生成物，不要手改）
runtime/ohos-shims.js          14 个 @ohos:* 平台模块 + 持久化三级后端
tools/extract.mjs              从 hvigor cache 抽转换产物 + 去 TS 类型 + v2 装饰器绑定前奏
tools/gen-components.mjs       由 ets-loader 的组件 JSON 生成骨架（--check 只校验不写）
tools/build-runtime.mjs        runtime/src/ 分片 → runtime/arkui-dom-runtime.js（--check 只校验不写）
tools/serve.py                 极简静态服务（端口由 OS 分配，避免冲突）
tools/preflight.mjs            环境自检（工具链 / 宿主 / 可执行位）
tools/check-all.sh             一条命令做完所有验收（7 步，含 t --typecheck）
tools/stats.mjs                覆盖范围统计（文档里的数字都来自它）
test/*.html                    断言页（32 个用例；断言数由 runner 守门，见 docs/DEVELOPING.md 坑 77）
fixtures/                      冻结的 ets-loader 转换产物（30 个，测试的输入）
harmony-proj/                  HarmonyOS 工程（页面 .ets 源码，转换产物的来源；构建输出不入库）
run.sh                         浏览器 32 用例驱动
electron/run.sh                Electron 31 用例 + 真实磁盘验证
docs/                          ARCHITECTURE / DEVELOPING / ROADMAP / CAPABILITY
```

**改运行时的标准动作**：改 `runtime/src/<分片>.js` → `npm run build:runtime` → 跑测试。
产物入库，`npm run check` 第 3 步守"产物 = 源"。为什么不做成多个 `<script>`：分片共享同一个闭包
（其中 `animWindow` 还是可变绑定），拆开就得把 6 个导入名与 3 个导出名显式穿线，
并让 30 处 HTML 的加载顺序成为新的失败模式（详见 `docs/ARCHITECTURE.md` 不变量 20）。


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
=== ALL PASS ===                    （74 条断言）
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
隐藏 `onWillHide→onHidden`；销毁前 `onWillDisappear`。~~顺序是推断~~ **R42 部分确证**：真机
`navigation_pattern.cpp` 同为"先 will 后实"的成对触发（`ON_WILL_HIDE → ON_HIDDEN`、
`ON_WILL_SHOW → ON_SHOW`），与我们的顺序一致；`onWillAppear` 的绝对时机仍不同（真机在挂载前，
本实现在子树挂载后）——这条已写进 CAPABILITY。

**一处刻意的"出声"**：`onBackPressed` 在本运行时**没有触发源**（没有系统返回键），
所以登记它时**立刻记一条警告**，而不是"存了不调" —— 后者是最坏的一种静默。

**破坏验证**：去掉"非栈顶隐藏" → 3 条可见性断言失败；交换 `willShow`/`shown` 顺序 → 1 条失败；
不派发 `onPop` → 1 条失败。

## R12 收口：`Navigation` 的标题栏 / 工具栏 / 分栏 ✅

R12 留下的是**可见差异**：无标题栏/工具栏/返回按钮，`Split`/`Auto` 只记警告。

**先测量**（新增 `pages/NavBarDemo.ets` → 官方构建 → 读产物），量出三条关键约定：
① `title` 的四种形态在产物里都走同一个属性调用，**CustomBuilder 也被归一化成 `{ builder }` 对象**
（所以"是不是自定义标题"看的是有没有 `builder` 字段，不是实参类型）；
② `NavigationTitleMode`/`NavBarPosition`/`TitleHeight` 在产物里是**自由变量**（必须挂 global）；
③ 所有标题栏高度都能从 `.d.ts` 的 JSDoc 抄到确切数字。

**高度全部照 `.d.ts` 原文**：`Full` = 112vp（只有主标题）/ 138vp（主+副）、`Mini` = 56vp、
`Free`（默认）不滚动时等同 `Full`；`NavigationCustomTitle.height` **优先于 titleMode**
（原文："When the NavigationCustomTitle type is used to set the height, titleMode does not take effect"）。
`TitleHeight` 的数值 ~~`.d.ts` 没给 → 推断~~ **R42 照真机确证**：112/138/56 就是
`navigation_bar_theme.cpp` 的主题默认值（`FULL_SINGLE_LINE_TITLEBAR_HEIGHT=112.0_vp` /
`FULL_DOUBLE_LINE_TITLEBAR_HEIGHT=138.0_vp` / `SINGLE_LINE_TITLEBAR_HEIGHT=56.0_vp`），
选择逻辑在 `nav_bar_layout_algorithm.cpp`（FULL 有 subtitle → 138、无 → 112）；FREE 初始高度
也取 FULL_*（与我们"Free 非滚动态等同 Full"一致）。
`navBarWidth` 默认 240vp、`Auto` 的判据是**宽度 ≥ 600vp 走 Split**（600 = minNavBarWidth 240 + minContentWidth 360），
两条都是原文。

```
$ bash run.sh navbardemo
=== ALL PASS ===                    （51 条断言）
PASS NavigationTitleMode/NavBarPosition/TitleHeight 三组枚举可用
PASS string 形态：'T1'／Full 且只有主标题 → 112vp
PASS NavigationCommonTitle：main='M2' sub='S2'／有主副标题 → 138vp
PASS builder 的内容真的建进了标题栏／NavigationTitleOptions.backgroundColor 生效／Mini → 56vp
PASS NavigationCustomTitle.height=MainWithSub → 138vp，且 titleMode(Mini) 不生效
PASS hideTitleBar(true) → 标题栏不显示／隐藏后高度按 0 计
PASS mode(Split) → split／navBarWidth(200)／导航栏宽度 = 200 + 1px 分割线／内容列从 201px 开始
PASS Auto + 宽 700 ≥ 600 → split／Auto + 宽 400 < 600 → stack
PASS 目的地标题栏文字 = 'DT1'／栈非空 → 目的地有返回键／menus 渲染／toolbarConfiguration 渲染
PASS 点菜单触发 action／点工具栏项触发 action／点返回键 → 栈空
PASS NavDestination.hideBackButton(true) → 不渲染返回键／backButtonIcon 被记下
```

**破坏验证**（3 项，各被精确抓住）：① 关掉标题栏绘制 → **14 条**红（标题文本/builder/背景色/
目的地标题/返回键/菜单/工具栏及其 action），而分栏与 Auto 的断言不受影响；
② 关掉分栏（恒返回 stack）→ 恰好 **9 条**红（模式/宽度/分割线/内容列/Auto 判据）；
③ 忽略 `NavDestination.hideBackButton` → 恰好 **1 条**红。

**顺带修掉运行时一个既有脆弱点**：`navBuildDest` 原来用 `area.lastElementChild` 认领刚建的目的地，
但 builder 里的 `if/else` 会生成 `If` 包装层（`display:contents`）—— 目的地是"孙子辈"，
于是被判成"没建出来"、**把栈项回滚掉**（栈空了、页面看着却有一个目的地）。
旧的 NavDemo 恰好没有 `if` 分支，一直没暴露；本轮的 `PageMap` 有 3 个分支，断言当场抓住。
现在改成按"本次新建的节点"认领（`__arkuiNavNew` 标记），并把"在目标区内"从"直接父节点"
改成**向上找祖先**。

**已知限制**（都写进 CAPABILITY）：`NavDestination` 的标题栏高度恒取紧凑 56vp（`.d.ts` 没写它的
高度，**推断**）；`menus`/`toolbarConfiguration` 只支持数组形态（自定义 builder 形态记警告）；
`onTitleModeChange`（标题栏随内容滚动收缩）/`navBarWidthRange`/`hideNavBar`/`enableDragBar`/
`customNavContentTransition` 等仍未实现（记警告，不静默）；`Auto` 用**组件自身宽度**判而
不是窗口宽度（同一页可以有多个 `Navigation`，窗口宽度无法区分）。

## R25 收口：`Navigation` 的转场动画 + `onTitleModeChange` 滚动联动 ✅

R12 收口后 `Navigation` 还剩两块**可见差异**：push/pop 是瞬时切换（无转场）、标题栏不随内容滚动收缩。

**先测量**（新增 `pages/NavTransDemo.ets` → 官方构建 → 读产物），量出三件事：
① `.onTitleModeChange(cb)` 是**函数值属性**（`Navigation.onTitleModeChange((m) => …)`）—— 而运行时的
属性分发里**通用 `on*` 规则排在组件属性表之前**，函数值会被当成 `addEventListener('titlemodechange')`
挂上去、永远没人派发（**坑 86**），必须在通用规则前拦下；
② `pushPathByName` 有**两套重载**：`(name, param, animated?)` 与 `(name, param, onPop, animated?)`，
`animated` 的 JSDoc 原文 **"Default value: true"**（`pop` 同）；四参传 `(name, param, undefined, false)`
时 a3 不是函数，解析必须看 a4（首版就栽在这，断言当场抓住）；
③ `disableAnimation(true)` 进产物后，后续 push/pop 都不再带动画。

**转场动画**（~~DOM 化选择，推断~~ **R40 照真机源码确证**，出处 `navigation_group_node.cpp` /
`navdestination_node_base.cpp`）：目的地从 **+50%** 滑入（`width×HALF`）、被盖页**视差滑到 -20%**
（`CONTENT_OFFSET_PERCENT=0.2`）、弹出页滑向 **+50%**；时长 **450ms**（`InterpolatingSpring(0,1,342,37)`
的上界；CSS 无弹簧，用 `cubic-bezier(0.2,0,0,1)` 近似临界阻尼形态）；push 时上一个栈顶**垫底可见**、
滑完才藏；
pop 时**状态层回调照旧立刻发**（`willHide → hidden → willDisappear`，顺序与立即版一致），DOM 摘除
推迟到滑出结束；弹到空栈时目标区在滑出期间撑住、结束后按当下栈显隐。收口与 `animation.js` 同一
约定：先提交起始值（强制重排，坑 ⑧）、`transitionend` 只当见证、定时器兜底。范围弹栈
（`popToName`/`popToIndex`/`clear`）仍立即销毁——真机也只动画栈顶。

**`onTitleModeChange` 滚动联动**（三条条件都是 `.d.ts` 原文）：只在 `titleMode = Free` 生效
（JSDoc："Triggered when titleMode is set to **NavigationTitleMode.Free**…"）；
`NavigationCustomTitle.height` 显式给过不生效（"titleMode does not take effect"）；
`hideTitleBar` 自然也没有。收缩进度随内容滚动**线性**插值（滚满 `Full−Mini` px 收到底，阈值换算是
实现选择）：主标题**缩小**、副标题**淡出但尺寸不变**——只对 string/`{main,sub}` 形态生效
（JSDoc："effective only when title is set to ResourceStr or NavigationCommonTitle"），builder 等其他
形态只收高度（"changes in mere location"）。**模式切换只在两个端点通知**：收到底 → `Mini(2)`、
滚回顶 → `Full(1)`，中途往返不抖动。

```
$ bash run.sh navtransdemo
=== ALL PASS ===                    （52 条断言，双端同数；R40 +4 真机数字）
PASS Free 滚 28px（半程）→ 84vp／触底 → Mini 56vp 且回调收到 Mini(2)／回顶 → 112vp 且收到 Full(1)
PASS 中途回滚不抖动（模式停在端点）／titleMode(Full) 对照组滚 200px 高度不变、回调不触发
PASS {main,sub}：副标题淡出（opacity 0.7→0）、主标题缩小（scale=高度比，实现选择）；回顶复位
PASS builder 标题：高度照收（84vp），内容 transform/opacity 不动
PASS push：栈状态立即生效（不等动画）／新栈顶带 data-arkui-nav-trans='push'／运行记录 +1
PASS 滑入期间上一个栈顶垫底可见，滑完才藏；转场样式清干净
PASS pop：滑出中目的地还在（zIndex 反超）／栈状态立即生效／滑出结束才摘目的地
PASS 弹到空栈：滑出期间目标区撑住，结束后隐藏、根内容露出
PASS 四参 animated=false：无转场样式、无运行记录；pop 未给 animated 默认滑出
PASS disableAnimation(true)：push 无转场、pop 立即销毁
```

**破坏验证**（3 项，各被精确抓住）：① 联动入口直接 return → **13 条**红（各形态的插值高度、
副标题淡出、主标题缩小、回调日志）；② `navWantAnim` 恒 false（动画全关）→ 恰好 **6 条**红
（滑入标记、运行记录、垫底可见、滑出标记、弹到空栈的目标区撑住、pop 默认滑出），而
"animated=false 无转场"的断言仍绿（它们本来就该绿，说明对照组在工作）；
③ 端点判定 `p>=1` 改 `p>1`（永不触发）→ 恰好 **5 条**红
（全部是回调日志，插值高度一条不红——证明"几何"与"通知"两条链互相独立）。还原后 `md5` 与
破坏前一致，双端复跑 48 条全绿。

**旧契约升级（navdemo）**：转场默认开启后，navdemo 的"pop 后目的地立即消失 / push 后瞬间只有栈顶可见"
两条**瞬时假设**不再成立（真机转场期间旧页本来就在底下可见）——门禁的断言数守门当场抓住
（文档 74、实测 62：12 条红被扣掉）。修法不是放宽断言，而是让测试**等转场收口再断言**
（轮询 `__arkui_dom_navTrans().pending`，与 transitiondemo 的 settle 同思想），断言本体一条没动，
74 条恢复全绿。

**已知限制**（都写进 CAPABILITY）：~~转场的时长/曲线是推断~~（R40 已照 `navigation_group_node.cpp`
确证：450ms 弹簧上界 + ±50%/20% 视差）；~~滚动联动的收缩阈值与缩放比是实现选择~~ **R43 照
`title_bar_pattern.cpp` 确证**：收缩阈值 = 滚满 `Full−Mini` px、高度 clamp [56, Full]（一致）；
副标题透明度 = `(H−56)/(max−56)`（原 0.7 系数已修正）；主标题 = 字号插值 L=30fp ↔ M=26fp、
映射 `Curves::SHARP`（DOM 侧等价 scale = (26+SHARP(p)×4)/30，原线性高度比已修正）；
`customNavContentTransition`（自定义转场协议）/`enableModeChangeAnimation`（单栏↔分栏切换动画，
API 15）/`onNavBarStateChange` 仍未实现（记警告）；`edgeEffect` 弹性不模拟——内容不足一屏的 List
滚不动，联动也就无从发生（`.d.ts` 的主场景是"超过一屏"）。

**顺带记下**：测量页第一版用 `.title({ builder: this.SynthTitle.bind(this) })` 直接编译失败——
ArkTS 检查器拒 `Function.bind`（arkts-no-func-bind），且 `{builder}` 单独作实参不满足
`NavigationCustomTitle` 类型（缺 `height`）；`{ builder: this.SynthTitle.bind(this) }` 是 **loader 生成
的形态**，源码里就该写 `.title(this.SynthTitle)`。又一次"产物形态 ≠ 源码写法"的现场证据。

## R26：SVG 形状族 `Circle` / `Ellipse` / `Rect` / `Line` / `Path` / `Polygon` / `Polyline` + `Shape` ✅

骨架组件视觉语义的第一批（README「下一步」①）：选形状族是因为它是**纯绘制**（无布局语义）、
语义全在 `.d.ts` 的属性方法上、与 R13 绘制四件套同一打法。85 个骨架的推进策略 = 按家族逐批收。

**先测量**（新增 `pages/ShapeDemo.ets` → 官方构建 → 读产物），量出三件事：
① 八个组件的 `create` 参数形态（`Circle({width,height})`、`Rect({width,height,radiusWidth,radiusHeight})`、
`Path({width,height,commands})`…）；② **`LineOptions` 里没有 `startPoint`/`endPoint`**——它们是
**属性方法**（`line.d.ts`: `startPoint(value: Array<any>): LineAttribute`），放进 create 参数
第一版编译就红了；③ `Shape.create()` 无参、容器经 `.viewPort({x,y,width,height})` 设视口，
子形状 `Rect().width('100%')` 是官方示例写法。

**实现**（新增 `runtime/src/shape.js` 分片，在生成骨架注册之前手写登记——手写优先）：
组件根 = `<svg>`（吃通用 `.width()/.height()`，vp→px 1:1，viewBox 随 create 尺寸），
真正的形状元素挂 `node.__shapeEl`；`fill/stroke/strokeWidth/fillOpacity/…` 经 `SHAPE_ATTRS`
落成 **SVG 表现属性**（不是 data-*、不是 CSS）——fill 要靠表现属性才能被 Shape 容器**继承**。
几何：`r = min(w,h)/2`（内切）、`rx/ry = w/2,h/2`、`commands → d` 原样、`points` 序列化成
`'x,y x,y …'`。默认值不写属性：SVG 原生默认（黑填充、无描边）与 `.d.ts` 的默认值
（fill 默认 Color.Black、stroke 默认 Transparent/opacity 0）恰好一致。
**语义锚点**（JSDoc 原文）：fill 默认 Color.Black；stroke "the default stroke opacity is 0"；
CircleOptions 的 width/height 无效值按 0。

```
$ bash run.sh shapedemo
=== ALL PASS ===                    （36 条断言，双端同数）
PASS Circle 根 = <svg> + 形状元素 <circle>；10 个 svg 根 = 8 顶层 + 2 嵌套
PASS r = min(w,h)/2 = 30（80×60 非正方形）／cx/cy = 40/30／viewBox '0 0 80 60'
PASS fill(Color.Red)→'red'／stroke '#333333' 原样／strokeWidth 落 stroke-width
PASS Rect 圆角 rx/ry=12；无尺寸 Rect → width/height 100%（官方示例写法）
PASS Line startPoint/endPoint → x1/y1/x2/y2（属性方法形态）
PASS Path commands 原样进 d；fillOpacity(0) → fill-opacity=0
PASS Polygon/Polyline points 序列化 '40,0 80,80 0,80'
PASS Shape viewPort → viewBox；子形状真挂进容器；容器 fill '#eeeeee' 继承进无 fill 的子形状
PASS 没设 stroke → 无 stroke 属性（Transparent 语义）；显式 .fill() 优先于继承
```

**破坏验证**（3 处，各被精确抓住）：① `SHAPE_ATTRS` 分派分支短路（全部退回 data-*）→ **19 条**红
（所有 fill/stroke/points/commands 断言）；② 内切圆 `r` 取 `max` 而非 `min` → 恰好 **1 条**红
——⚠️ 首轮 fixture 用的是 80×80 **正方形**，min=max，破坏**空转 0 红**：测量页当场改成 80×60
非正方形（R13 坑 2"等于没测"的教训现场重演，fixture 与测试同步升级）；③ Shape 容器不吃
`SHAPE_ATTRS`（fill/viewPort 落 data-*）→ 恰好 **4 条**红（viewBox、容器 fill/stroke、两条继承，
且子形状退回 SVG 默认黑填充 rgb(0,0,0) 也被抓到）。还原后 md5 与基准一致。

**已知限制**（写进 CAPABILITY）：`.width()/.height()` 在 create 之后改的只是 svg 视口，
**不反推几何**（r/cx 不重算）；`fill`/`stroke` 的渐变（`ResourceColor` 的线性渐变形态）、
`strokeMiterLimit`、`Path` 的 `mil`（command 单位）未实现（记警告）；`viewPort` 只接受
对象形态；形状族没有 `onAreaChange` 之外的交互语义。

**触及**：`runtime/src/shape.js`（新分片，第 10 个）、`runtime/src/area.js`（applyAttr 的
`SHAPE_ATTRS` 分支）、`runtime/src/main.js`（@include + 安装全局 8 个名字）、`tools/stats.mjs`
（手写清单 17 → 25）、`fixtures/pages/ShapeDemo.ts`、`harmony-proj/`（ShapeDemo.ets +
main_pages.json）、`test/shapedemo.html`、`run.sh`、`electron/run.sh`

## R27：输入类 `Checkbox` / `Radio` / `Toggle` / `Slider` ✅

骨架组件视觉语义第二批（按家族推进）。生成的骨架已把它们映射成**原生控件**
（checkbox/radio/checkbox/range），本轮补的是 **ArkUI 语义层**：选中态、颜色、回调参数、枚举。

**先测量**（新增 `pages/InputDemo.ets` → 官方构建），编译期当场抓到两条 API 形状：
① **`RadioOptions` = `{value, group}`，没有 `name`**（放进去编译就红）；② **`ToggleAttribute`
没有 `.select()`**——初始选中在 create 的 `isOn`。`SliderChangeMode = {Begin=0, Moving=1, End=2,
Click=3}`（`.d.ts` 声明顺序）。

**实现**（新分片 `runtime/src/input.js`，第 11 个，手写优先）：沿用原生控件基座，语义层四件事——
`select`/`checked` → `checked`（**按上次应用的值做幂等 diff**）；`selectedColor` → `accent-color`
（原生控件唯一可映射的选中色），`unselectedColor`/`mark`/`radioStyle`/`trackColor` 等原生控件没有
对应物的**照实记 data-***（不静默）；`Radio` 的 `name = group`（原生单选互斥靠同名 name）；
`Slider.onChange` 是**双参** `(value, mode)`——`input` → `Moving(1)`、`change` → `End(2)`，
在通用 `on*` 规则之前拦截（否则只会原样收到 Event 对象）。`ToggleType`/`SliderChangeMode`
挂 global（产物自由变量）。

**过程里抓到的三个运行时真问题**（都比语义本身值钱）：
① **事件类属性的重复注册**：`@State` 每次变化触发重渲染、重渲染把 `.onChange(cb)` 再应用一遍，
追加语义下监听器**每轮翻倍**（一次点击回调发两次）——通用事件规则改成**覆盖语义**（同属性
同事件替换上一个，与真框架属性 setter 一致），见坑 88；
② **跨节点错投**：排查实测 rd 的包装器会被挂到其他 input 节点上（tg1/sl1 的 change 也会带起
rd 回调）——包装器加 **target 校验**（事件目标必须是自己）兜住；
③ **组内互斥的另一半**：Chrome 只给新选中者发 change，而被取消成员的 `onChange(false)` 也是
"选中态变化"（radio.d.ts JSDoc 原文："false means that the radio button changes from selected to
unselected"）——按登记的组**补发**。

```
$ bash run.sh inputdemo
=== ALL PASS ===                    （29 条断言，双端同数；R27 时 27，R38 +onSubmit 组）
PASS Checkbox：select(true) 编程选中／selectedColor → accent-color／编程改态不派发 change（取舍已记录）
PASS Radio：{value,group} → type=radio name=g1 value=a／点 rd2 → rd1 互斥取消
PASS 组内互斥两边都发：rd2 onChange(true) + rd1 onChange(false)（.d.ts JSDoc 语义）
PASS Toggle：isOn:true 初始选中／data-toggle-type=switch／selectedColor → accent-color
PASS Slider：value/min/max/step=40/0/100/10 直落控件／selectedColor → accent-color／
     trackColor/blockColor/showTips 记 data-*／input → Moving(1)、change → End(2) 双参
PASS 重渲染后组内状态不被拉回声明值（幂等 diff 的直接验证）
```

**破坏验证**（3 处，各被精确抓住）：① 摘掉 target 校验（错投回归）→ **3 条**红；
② 组内补发摘除 → 恰好 **2 条**红；③ 幂等 diff 改回无条件赋值 → 恰好 **2 条**红（重渲染把
状态拉回声明值 + 凭空 RD 对）。还原后 md5 与基准一致，navdemo（74 条）与 tabgrid 回归全绿。

**已知限制**（写进 CAPABILITY）：`select`/`checked` 编程改态**不派发** onChange（DOM 语义里
change 是用户交互事件，`.d.ts` 没写死编程改态是否触发，取"不派发"并已写进 docs）；
`Slider` 的 `Click(3)`/`Begin(0)` 模式没有 DOM 事件对应（`input`→Moving、`change`→End）；
`contentModifier` 自定义形态、`mark`/`shape`/`radioStyle`/`switchStyle` 只记 data-*。

**触及**：`runtime/src/input.js`（新分片，第 11 个）、`runtime/src/area.js`（通用事件规则改
**覆盖语义** + INPUT/Slider 分支）、`runtime/src/input.js` 的组内补发、`runtime/src/main.js`
（@include + 安装全局 6 个名字）、`tools/stats.mjs`（手写 25 → 29）、`fixtures/pages/InputDemo.ts`、
`harmony-proj/`（InputDemo.ets + main_pages.json）、`test/inputdemo.html`、`run.sh`、`electron/run.sh`

## R28：信息展示类 `Badge` / `Counter` / `Divider` / `Marquee` ✅

骨架组件视觉语义第三批（按家族推进）。**本轮不收 `QRCode`**：真画需要完整的 QR 编码器
（Reed-Solomon 纠错编码），体量与断言方式都单列，后续单独切片。

**先测量**（新增 `pages/ShowDemo.ets` → 官方构建），编译期当场抓到三条 API 形状：
① `Badge` 数字重载用 **`count`**、字符串重载用 **`value: ResourceStr`**（`value: 9` 编译就红）；
② **`BadgeParam.style` 必填且在 create 参数里**——`BadgeAttribute` 没有 `.style()` 方法，
且字段名是 `color`/`badgeColor`/`badgeSize`（不是 textColor，实测）；
③ **`MarqueeOptions.start` 必填**。`BadgePosition = { RightTop, Right, Left }`（JSDoc 有名无数字，
枚举化数值是本实现的）。

**实现**（新分片 `runtime/src/show.js`，第 12 个，手写优先）：
**Badge** = 容器（子内容照常挂进来）+ 绝对定位角标；badgeColor/color/fontSize/badgeSize/borderWidth
全照 JSDoc 默认值（Color.Red/Color.White/10vp/16vp/1vp）；位置 RightTop/Right/Left 的 DOM 摆法是
实现选择。**Counter** = inline-flex 容器 + 内置可点元素（flex order 摆成 [−, 内容, +]，create 时
内容还没挂进来），点击派发 `onInc`/`onDec`（函数值属性，拦在通用 `on*` 规则之前——否则变成
`'inc'/'dec'` DOM 监听，坑 86 的又一变体）。**Divider** = div + 背景色画线（hr 样式可控性差），
默认色 `#33182431`、粗细 1px（JSDoc 原文），纵向把 strokeWidth 转成宽。**Marquee** = overflow 容器
+ 内层文本跑 CSS 动画；~~时长 = 文本长度×16px/step×16ms（推断）~~ **R40 照真机公式确证**：
`时长 = (容器宽+文本宽) × 85 / step`（`marquee_pattern.cpp`，LINEAR）；`animationstart/end → onStart/onFinish`，但收口与 animation.js 同约定
（坑 ⑧）：headless 里不可见页面的 CSS 动画事件会被节流（animationend 实测会丢），**定时器兜底**、
动画事件只当见证、once 守卫只发一次。

```
$ bash run.sh showdemo
=== ALL PASS ===                    （28 条断言，双端同数；R40 +时长公式，R44 +step=0 回归）
PASS Badge：count→'9'／badgeColor 默认 Color.Red→'red'／color 白字／fontSize 10→10px／
     position RightTop、Right／子内容真的挂进容器／style 定制（#1234ff→rgb(18,52,255)）
PASS Counter：内置 +/− 元素存在／点 + → onInc、点 − → onDec（事件归属真实）
PASS Divider：横向 strokeWidth(3)→高 3px／color '#888888'／纵向 vertical(true)→宽 5px
PASS Marquee：src 进内层文本／fontColor/fontSize 落内层／loop/start 记录／CSS 动画启动／
     onStart 触发／onFinish 在两圈后触发
```

**破坏验证**（3 处，各被精确抓住）：① `SHOW_ATTRS` 分派短路 → **8 条**红（Counter 2 + Divider 3 +
Marquee 2 + log 全程 1；**Badge 全绿**——它的语义全在 create 参数，与属性分派无关，恰好证明各
断言管各的面）；② Badge 位置映射忽略参数恒 RightTop → 恰好 **1 条**红；③ strokeWidth 的方向
分支摘除（纵向不再转宽）→ 恰好 **1 条**红。还原后 md5 与基准一致，tabgrid 回归绿。

**破坏验证的虚拟时间教训（新）**：破坏①首轮"0 红、用例直接挂"——不是断言没牙齿，而是
`run_one` 的 `--virtual-time-budget=8000` 被测试里两个 6 秒轮询拖穿，dump 发生在中途，
**红条数根本没机会落盘**。轮询上限必须小于"预算 − 前置耗时"（收口到 3500ms×2 后 8 条红完整现形）。

**已知限制**（写进 CAPABILITY）：`Badge` 的 `Position` 对象形态（精确 x/y）未实现（记警告）；
`Counter` 的 `onStateChange`、`Marquee` 的 `onBounce`（无 bounce 动画）、`marqueeUpdateStrategy`
只记录；`fromStart: false`（从尾部开始）不改变动画方向；~~时长公式是推断~~ R40 已照真机确证
（`距离×85/step`）。

**触及**：`runtime/src/show.js`（新分片，第 12 个）、`runtime/src/area.js`（SHOW 分支）、
`runtime/src/main.js`（@include + 安装全局 5 个名字）、`tools/stats.mjs`（手写 29 → 33）、
`fixtures/pages/ShowDemo.ts`、`harmony-proj/`（ShowDemo.ets + main_pages.json）、
`test/showdemo.html`、`run.sh`、`electron/run.sh`

## R29：弹出类 `Select` / `Menu` + `MenuItem` ✅

骨架组件视觉语义第四批（弹出类）。生成的骨架已把 Select 映射成**原生 `<select>`**，
Menu/MenuItem 是 flex div 骨架——本轮补语义层。

**测量**（新增 `pages/PopDemo.ets` → 官方构建）实测形态：`Select.create([{value}])` **create 单参数**
（`selected` 是属性方法 `selected(value: number | Resource)`，`SelectOption = {value, icon?, …}`）；
`Select.onSelect` 签名是**双参** `(index: number, value: string)`（index = 选中序号、value =
选中项文本）；`Menu.create()` + `MenuItem.create({content})`；`MenuItem.onChange` 是**多选语义**
（每项独立 `selected` + onChange，非互斥——selectIcon/selected 是 MenuItem 的选择标记）。

**实现**（新分片 `runtime/src/popup.js`，第 13 个，手写优先）：`Select` 沿用原生 `<select>` 基座
（options → `<option>`，`selected(i)` → `selectedIndex` 直落）；`onSelect` 在通用 `on*` 规则前拦截、
change 事件带双参派发（`selectedIndex` 编程改不派发 change——DOM 取舍已记录，测试用
`dispatchEvent('change')` 驱动）；`MenuItem` 行式面板：点击切换自身选中（带 ✓ 标记）并派发
`onChange(新状态)`（多选语义，每项独立）；`Select.value(str)`（"设置当前显示文本"）：原生
`<select>` 的显示文本不可覆盖 → **照实记 `data-value-text`**（取舍已写进 docs）。

```
$ bash run.sh popdemo
=== ALL PASS ===                    （16 条断言，双端同数）
PASS Select：三选项建成 <option>／selected(1) → selectedIndex=1 显示 'B'／fontColor → color
PASS onSelect 双参：dispatch change → (2,'C')、再选 A → (0,'A')
PASS Select.value('Choosed') → data-value-text（原生 select 显示文本不可覆盖，记录取舍）
PASS Menu/MenuItem：内容渲染／selected(true) → ✓ 标记／点 item1 → onChange(true)／
     点已选 item2 → onChange(false) 并取消选中（多选语义）
```

**破坏验证**（3 处，各被精确抓住）：① `POPUP_ATTRS`/`onSelect` 分派短路 → **7 条**红；
② MenuItem 点击切换摘除 → 恰好 **3 条**红；③ options 构建摘除 → 恰好 **5 条**红
（selectedIndex 变 -1、onSelect 双参全空——证明 `<option>` 构建是 selectedIndex 与回调的基座）。
还原后 md5 与基准一致。

**已知限制**（写进 CAPABILITY）：`Select.value` 显示文本覆盖记 `data-value-text`（原生 select
不可覆盖，取舍已记录）；`Select` 编程改 `selectedIndex` 不派发 onSelect（同 R27 取舍）；
`MenuItem` 无 `onMenuItemClick`（该 SDK 版本的多选语义走 onChange）；`Menu.showMenu`/`hide`、
`MenuItemGroup`、`Select` 的 `icon/symbolIcon` 选项未实现（记警告）。

**触及**：`runtime/src/popup.js`（新分片，第 13 个）、`runtime/src/area.js`（POPUP 分支）、
`runtime/src/main.js`（@include + 安装全局 3 个名字）、`tools/stats.mjs`（手写 33 → 35）、
`fixtures/pages/PopDemo.ts`、`harmony-proj/`（PopDemo.ets + main_pages.json）、
`test/popdemo.html`、`run.sh`、`electron/run.sh`

## R30：`UIContext`（`getUIContext()` 的现代 API 面）✅

关掉 CAPABILITY 里记录已久的限制："页面若改走 `this.getUIContext()` 会得到响亮的 TypeError"。
现代 ArkTS 代码（去 deprecated 化）大量走这条面。

**测量**（新增 `pages/UiContextDemo.ets` → 官方构建）实测形态：`this.getUIContext()` 是**组件实例
上的普通方法调用**（编译器不改写）；`uiContext.animateTo(param, fn)` 与 `Context.animateTo` 同源
显式动画；`uiContext.getRouter()` 返回的是**经典 Router 面**（`Router.pushUrl(options)`，不是
NavPathStack 的 pushPathByName——编译期实测）；`uiContext.runScopedTask(cb)` 立即执行。

**实现**（`ViewPU.prototype.getUIContext`，放 main.js——无新分片，因为本体只有 8 行对象面）：
**只实现实测用到的面**：`animateTo/animateToImmediately` → 委派 `runExplicitAnimation`（与
`Context.animateTo` 同管道）；`getRouter()` → `@ohos:router` 垫片（pushUrl 形态）；`getPromptAction()`
→ `@ohos:promptAction` 垫片；`runScopedTask(cb)` → 立即执行（真机是"UI 作用域内执行"，DOM 里无
作用域差异，取舍已记录）。`ViewV2 extends ViewPU`——`@ComponentV2` 组件同样继承。

```
$ bash run.sh uictxdemo
=== ALL PASS ===                    （8 条断言，双端同数）
PASS 点击 go → 四个面按序生效（UI1;RT1;SC;）
PASS animateTo 的回调同步执行（msg A→B）／显式动画运行记录 +1（api='animateTo'——
     用 __arkui_dom_animations 的 history 钉住"真动画"，裸赋值过不了这条）
PASS ViewPU 原型挂上 getUIContext／多次调用各自拿到对象
```

**破坏验证**（2 处，各被精确抓住）：① `getUIContext` 摘除 → **4 条**红（页面 onClick 里直接
`TypeError: ViewPU.prototype.getUIContext is not a function`——正是原限制的症状）；
② `animateTo` 委派断掉（裸赋值不进动画管道）→ 恰好 **1 条**红（msg 照样到 B，动画记录缺位）。
还原后 md5 与基准一致，v2 回归绿。

**已知限制**（写进 CAPABILITY）：`UIContext` 只实现实测面（animateTo/animateToImmediately/
getRouter/getPromptAction/runScopedTask）；`getFrameNode`/`getMediaQuery`/`openMenu` 等其余
方法未实现（调用得到 undefined——对象面上无法统一拦，按需补充）；`runScopedTask` 的"作用域"
语义无 DOM 对应。

**触及**：`runtime/src/main.js`（`makeUIContext` + `ViewPU.prototype.getUIContext`，放 ViewPU/
属性映射与 Tabs 之间）、`fixtures/pages/UiContextDemo.ts`、`harmony-proj/`（UiContextDemo.ets +
main_pages.json）、`test/uictxdemo.html`、`run.sh`、`electron/run.sh`

## R31：表层类 `Canvas`（真实 2D context）✅

**测量**（新增 `pages/CanvasDemo.ets` → 官方构建）实测形态：`Canvas(this.context)` 的 create
参数是 **ctx 对象**；`new CanvasRenderingContext2D(settings)`（settings 来自
`RenderingContextSettings(antialias, alpha)`）；`onReady(cb)`——JSDoc 原文："perform any drawing
after this event is triggered"；绘制面（fillRect/fillText/getImageData/toDataURL…）就是标准
Canvas 2D（`CanvasRenderer`）。

**实现**（新分片 `runtime/src/canvas.js`，第 14 个，手写优先）：手写 Canvas → **原生 `<canvas>`**；
ctx 对象**转发**到原生 2D context——fillRect/像素/toDataURL 都是浏览器真画，
**像素断言天然有牙齿**（`getImageData` 读回坐标采样）。三件事：① create 时"交接"原生 context
（ctx 先于 Canvas 创建，用户字段初始化）；② onReady 的派发在 `.width/.height` 应用完之后
（`setTimeout(0)`，坑 ⑧——同步派发时画布还没有尺寸），派发前把 CSS 尺寸同步到 canvas 内容
尺寸（1:1）；③ `fillStyle/font/lineWidth` 等 getter/setter 与方法显式转发（不用 Proxy——
方法清单是有限的、可断言的）。

```
$ bash run.sh canvasedemo
=== ALL PASS ===                    （10 条断言，双端同数）
PASS onReady 触发并完成绘制（RDY）／原生 <canvas>／内容尺寸 200×100（CSS 1:1 同步）
PASS 像素采样：红块中心 R255/0/0／绿块 G204（#00cc00）／未画区 alpha=0
PASS toDataURL 走原生（data:image/png;base64, 前缀——fixture 首版断言太弱，收紧后破坏才现形）
```

**破坏验证**（3 处，各被精确抓住）：① `fillRect` 转发摘除（noop）→ **2 条**红（像素读回全 0）；
② onReady 尺寸同步摘除 → 恰好 **1 条**红（canvas 保持默认 300×150，内容尺寸断言直接现形）；
③ `toDataURL` 假串 → 恰好 **1 条**红——⚠️ 首轮 **0 红**：fixture 的检查是
`indexOf('data:image/png') === 0`，假串 `data:image/png,BROKEN` 恰好也命中——当场收紧为
`data:image/png;base64,` 前缀（R13 坑 2 的又一现场：断言里的字符串边界必须钉死）。还原后
md5 与基准一致。

**已知限制**（写进 CAPABILITY）：`RenderingContextSettings` 的 antialias/alpha 在浏览器 2D 里
无对应开关（记录）；Canvas 尺寸的**后续变更**不重新同步内容尺寸（onReady 后改 `.width()` 需
重画）；`XComponent` 未实现（表层类另一半，记警告）。

**触及**：`runtime/src/canvas.js`（新分片，第 14 个）、`runtime/src/area.js`（CANVAS 分支）、
`runtime/src/main.js`（@include + 安装全局 3 个名字）、`tools/stats.mjs`（手写 35 → 36）、
`fixtures/pages/CanvasDemo.ts`、`harmony-proj/`（CanvasDemo.ets + main_pages.json）、
`test/canvasedemo.html`、`run.sh`、`electron/run.sh`

**触及**：`runtime/src/canvas.js`（新分片，第 14 个）、`runtime/src/area.js`（CANVAS 分支）、
`runtime/src/main.js`（@include + 安装全局 3 个名字）、`tools/stats.mjs`（手写 35 → 36）、
`fixtures/pages/CanvasDemo.ts`、`harmony-proj/`（CanvasDemo.ets + main_pages.json）、
`test/canvasedemo.html`、`run.sh`、`electron/run.sh`

## R32：表层类另一半 `XComponent` ✅

**测量**（新增 `pages/XCompDemo.ets` → 官方构建）实测形态：`XComponent.create({id, type,
controller}, "bundle/module")`——**create 有第二参**（bundle/module 字符串，记录）；
`XComponentType = { SURFACE = 0, COMPONENT, NODE }`（enums.d.ts 声明顺序）；
`onLoad(cb)` 在 surface 创建后触发；`XComponentController` 的 rect —— JSDoc 原文：
**"不调用 set 则返回组件实际尺寸"**。

**实现**（接在 `runtime/src/canvas.js` 表层类分片，无新文件）：真机的 surface 由原生图形栈持有，
DOM 里**如实降级为占位容器**（`data-xcomponent` + type 记录）；`surfaceId` 生成
`XComponent-<id>`（DOM 化选择）；`onLoad` 经 `setTimeout(0)` 派发（与 Canvas.onReady 同思想）；
`XComponentController` 的 rect：默认取组件实际 `offsetWidth/Height`（JSDoc 原文语义），`set`
只记录（真机改 surface 缓冲尺寸，DOM 无对应物）；`onDestroy` 只登记——DOM 里的销毁时机是
元素摘除，触发时机已写进 docs（不测）。

```
$ bash run.sh xcompdemo
=== ALL PASS ===                    （7 条断言，双端同数）
PASS 占位容器（data-xcomponent，type=SURFACE）／onLoad 触发且 surfaceId 非空／组件尺寸 300×200
PASS 不调用 set → rect = 组件实际尺寸（DEF300x200，JSDoc 原文语义）
PASS set 后 get 返回记录值（RECT320x240）
```

**破坏验证**（3 处，各被恰好 1 条红抓住）：① `surfaceId` 返回空串 → 1 红（fixture 的
`LOAD` + surfaceId 非空计数正是这颗牙）；② rect 默认分支硬编码 0×0 → 1 红（JSDoc 原文语义）；
③ `setXComponentSurfaceRect` 记录断 → 1 红。还原后 md5 与基准一致。

**已知限制**（写进 CAPABILITY）：surface 是**占位**（原生图形栈无对应物，如实降级）；
`surfaceId` 格式是 DOM 化选择（真机格式来自图形栈）；`onDestroy` 的触发时机（元素摘除）
未挂卸载钩子；`XComponentType.COMPONENT/NODE` 的差异语义未建模。

**触及**：`runtime/src/canvas.js`（表层类分片扩展）、`runtime/src/area.js`（XC 分支）、
`runtime/src/main.js`（安装全局 3 个名字）、`tools/stats.mjs`（手写 36 → 37）、
`fixtures/pages/XCompDemo.ts`、`harmony-proj/`（XCompDemo.ets + main_pages.json）、
`test/xcompdemo.html`、`run.sh`、`electron/run.sh`

**触及**：`runtime/src/canvas.js`（表层类分片扩展）、`runtime/src/area.js`（XC 分支）、
`runtime/src/main.js`（安装全局 3 个名字）、`tools/stats.mjs`（手写 36 → 37）、
`fixtures/pages/XCompDemo.ts`、`harmony-proj/`（XCompDemo.ets + main_pages.json）、
`test/xcompdemo.html`、`run.sh`、`electron/run.sh`

## R33：信息展示收官 `QRCode`（真实编码器 + 独立解码交叉验证）✅

**测量**（新增 `pages/QrDemo.ets` → 官方构建）实测形态：`QRCode.create(value)` create 单参数；
`color` 默认 **'#ff000000'**、`backgroundColor` 默认 **'#ffffffff'**（API 11+）、`contentOpacity`
默认 1 范围 [0,1]（全部 JSDoc 原文）；最多 512 字符（超出取前 512）。

**实现**（QRCode 组件接在 `runtime/src/show.js` 信息展示家族）：**不自己实现编码器**——
编码器是真机源码直接复用（~~R33 移植的 node-qrcode~~ **R41 换成 arkui_qrcodegen 的 WASM**，
`global.ArkuiQrcodegen`，单文件内嵌、file:// 可用，
**库代码零修改**，只加我们自己的 ESM 胶水入口）；未加载 vendor 时**记警告并降级**（不静默、
不假画）。渲染在渲染后同步阶段（`redrawQr`，挂在 `syncDrawings`——不变量 18：等真实尺寸）；
canvas 内容尺寸 1:1、quiet zone 4 模块（渲染差异：真机组件 API12+ 满幅绘制无 quiet，已记录）、颜色变化整幅重画。

**交叉验证的牙齿**：解码器来自**另一个独立第三方** jsQR@1.4.0（test/vendor，Apache-2.0，
原样拷贝）——"画出来的码能被独立解码器读回原文"（qr1 ASCII / qr2 UTF-8 多字节 / qr3 定制色
三块都能解码回原文）才是有牙齿的断言。两库互为独立实现，编码错了就过不了这条。

**入向合规**：两件第三方源码**首次入库**，登记在 `THIRD-PARTY-NOTICES.md` 新增 §3b
（出处、版本、许可原文、复现命令）。

```
$ bash run.sh qrdemo
=== ALL PASS ===                    （15 条断言，双端同数；R40 +采样，R44 +过小拒绝×3）
PASS 三 canvas 渲染落位（总模块数含 quiet zone 37）／沿用原生 <canvas>
PASS 独立解码：qr1/qr2/qr3 全部解码回原文（jsQR 独立实现）
PASS 像素断言：默认背景 #ffffffff 不透明白／定制背景 '#eeeeff' → rgb(238,238,255)
```

**破坏验证**（3 处）：① vendor 缺席时不记警告（移除 vendor script 的破坏环境）→ 3+ 条断言红；
② 前景色未经 ARGB 归一（画成全透明）→ 恰好 **2 条**红（解码 null，qr3 有定制前景仍绿）；
③ quiet zone 摘除 → 恰好 **1 条**红（(5,5) 采样点从背景区变暗模块区）。还原后 md5 与基准一致。

**过程里抓到的一个真问题**：**ArkUI 的 8 位颜色字面量是 ARGB**（'#ff000000' = 不透明黑，JSDoc
原文默认），CSS 是 RRGGBBAA——位数歧义必须归一，否则默认前景画成全透明（首跑解码 null）。

**已知限制**（写进 CAPABILITY）：~~ECC 级别按移植库默认（L 级，推断）~~ **R40 确证 M 级**
（真机 `qrcode_modifier.cpp:44` 硬编码 `QRCODE_ECC_MEDIUM`，且 node-qrcode 默认本就是 M——
R33 的"L 级"注记是误判，实渲染从未变过；显式传参后语义对齐有据）。qrdemo 新增 ECC 采样断言
（渲染矩阵与 vendor-M 100 格逐格一致，L 级 25 模块对不上 29）。
真机可能不同）；`contentOpacity` 作用于内容层（真机语义待核对）；512 截断未测（fixture 未覆盖）。

**触及**：`runtime/vendor/`（新目录：qrcode bundle + LICENSE）、`test/vendor/`（jsQR + LICENSE）、
`runtime/src/show.js`（QRCode 组件 + redrawQr）、`runtime/src/draw.js`（syncDrawings 的 QR 口）、
`runtime/src/main.js`（安装全局）、`fixtures/pages/QrDemo.ts`、`harmony-proj/`（QrDemo.ets +
main_pages.json）、`test/qrdemo.html`、`run.sh`、`electron/run.sh`

**触及**：`runtime/vendor/`、`test/vendor/`、`runtime/src/show.js`（QRCode 组件 + redrawQr）、
`runtime/src/draw.js`（syncDrawings 的 QR 口）、
`runtime/src/main.js`（安装全局）、`fixtures/pages/QrDemo.ts`、`harmony-proj/`（QrDemo.ets +
main_pages.json）、`test/qrdemo.html`、`run.sh`、`electron/run.sh`

## R34：输入收官 `TextInput` / `TextArea` / `Search` + `Hyperlink` ✅

**测量**（新增 `pages/TextDemo.ets` → 官方构建）实测形态：`TextInput.create({placeholder, text,
controller})`／`TextArea.create({placeholder})`／`Search.create({value})`；`.maxLength(n)`；
`onChange` 双参签名 `(value: string, previewText?, options?)`（text_common.d.ts 原文）；
`onSubmit((enterKey, event) => …)`；`EnterKeyType`（.d.ts 原文：Go=2…NEW_LINE=8，0/1 未声明——
产物没引用就不挂）；`Hyperlink(address, content?)`。

**实现**（`runtime/src/input.js` 扩展，沿用原生 input/textarea/search 基座）：
`text/placeholder` 直落（text → `el.value`）；`maxLength` → 原生截断属性；`caretColor` →
`style.caretColor`；**onChange 按 `node.type` 分流**（checkbox/radio → change+boolean，
text/textarea/search → input+change + 字符串值——R27 的 boolean 包装对文本输入不适用，本轮
重构了这条分支的分流条件，还顺手清掉了 R27 遗留的 DBG 调试行）；`onSubmit` 挂 keydown wrapper
（enterKey 未设取 Done=6，.d.ts 默认值原文）；`Hyperlink` → **原生 `<a>`**（href 直落、
target=_blank、无子组件时显示 content——JSDoc 原文）；`TextInputController` 基座（caretPosition）。

```
$ bash run.sh textdemo
=== ALL PASS ===                    （16 条断言，双端同数）
PASS TextInput：初始 text→value／placeholder／maxLength(4) 原生截断属性／caretColor
PASS input → onChange('abcd')（值字符串，R27 的 boolean 包装按 type 分流）
PASS TextArea 原生 <textarea>／Search type=search + value 直落／search change 也派发 onChange
PASS Hyperlink：<a>＋href=address＋content 渲染＋外链新开
PASS Enter → onSubmit(6, event) 回调真发（R38 起端到端断言）
```

**破坏验证**（2 处，均如实收尾）：① TextInput 的 onChange 误用 checkbox 的 boolean 包装
（首跑 log=''）→ 按分流修复后回原文（红条在修正前出现，修复即绿）；② **Enter → onSubmit
回调的 value 派发本轮未打通**（keydown 已到达元素、wrapper 已挂、最后一环待查）——断言改为
"注册面"，并如实写进 docs/CAPABILITY 已知限制（别把没验的当结论）。

**已知限制**（写进 CAPABILITY）：`onChange` 无 previewText 对应（DOM 取舍，已记录）；
`onSubmit` 的 SubmitEvent（keepEditable 等）无 DOM 对应、**回调派发未打通**；`Search` 的
`searchButton` 等未实现（记警告）。

**触及**：`runtime/src/input.js`（输入收官：三组件 + Hyperlink + TextInputController 基座 +
EnterKeyType + maxLength/caretColor/onSubmit 属性）、`runtime/src/area.js`（文本输入 onChange
分流）、`runtime/src/main.js`（安装全局 7 个名字）、`fixtures/pages/TextDemo.ts`、
`harmony-proj/`（TextDemo.ets + main_pages.json）、`test/textdemo.html`、`run.sh`、
`electron/run.sh`

**触及**：`runtime/src/input.js`（输入收官：三组件 + Hyperlink + TextInputController 基座 +
EnterKeyType + maxLength/caretColor/onSubmit 属性）、`runtime/src/area.js`（文本输入 onChange
分流）、`runtime/src/main.js`（安装全局 7 个名字）、`fixtures/pages/TextDemo.ts`、
`harmony-proj/`（TextDemo.ets + main_pages.json）、`test/textdemo.html`、`run.sh`、
`electron/run.sh`

## R35：平台模块收官 `@ohos.multimedia.media`（AVPlayer 垫片）✅

**测量**（新增 `pages/MediaDemo.ets` → 官方构建，`import media from '@ohos.multimedia.media'`）
实测形态：`media.createAVPlayer()` Promise 面；`avPlayer.url = '…'` → 状态机 'initialized'；
`prepare()` → 'prepared'；`play()` → 'playing'；`pause()` → 'paused'；
`on('stateChange', (state, reason) => …)`（双参，reason DOM 恒空）；
`duration/currentTime/seek/stop/release` 全挂。

**实现**（`runtime/ohos-shims.js` 新增 `multimedia.media` 垫片，第 15 个平台模块）：
**AVPlayer → HTMLAudioElement 的状态机垫片**——状态机语义是断言主体（真实解码/发声无 DOM
对应，取舍已记录）。三个如实降级：
① **订阅先行**（fixture 首跑实测）：`on('stateChange')` 必须在 url 赋值**之前**，否则
'initialized' 在订阅前发生、被丢；
② **autoplay 政策**：合成 click（dispatchEvent）不算真实手势，Chromium 拒 `audio.play()`
→ 垫片 muted + catch 后照走状态机（Electron 主进程另加 `autoplay-policy=no-user-gesture-required`）；
③ **currentTime 的来源**（DOM 化映射）：data URI 短音频真实解码时长为 0（实测时钟不推进）
→ 垫片记录 play 起点的真实挂钟，playing 期间按墙钟推进、pause 冻结——语义真实（"播放了多久"）
但不来自音频解码。

**验收**：`bash run.sh mediademo`——浏览器 8 条全绿（状态机全链路 + 时钟推进）；
Electron 状态机全绿、**时钟推进在 Electron 未打通**（offscreen 渲染下 audio 时钟不动，
垫片挂钟来源在 Electron 环境未生效）——**断言分端**并如实写进 docs/CAPABILITY 已知限制
（别把没验的当结论）。

**已知限制**（写进 CAPABILITY）：`currentTime` 挂钟来源（不来自音频解码）；`duration` 对
data URI 恒 -1（无真实解码）；`seek` 的 offset/`SubmitEvent` 类语义无对应；`AVRecorder` 未实现。

**触及**：`runtime/ohos-shims.js`（multimedia.media 垫片，第 15 个平台模块）、
`electron/main.js`（autoplay-policy 放行）、`fixtures/pages/MediaDemo.ts`、
`harmony-proj/`（MediaDemo.ets + main_pages.json）、`test/mediademo.html`、
`run.sh`、`electron/run.sh`

## R36：小件收官 `Flex` / `Span` / `LoadingProgress` / `Blank` ✅

**测量**（新增 `pages/SmallDemo.ets` → 官方构建）实测形态：`Flex.create({direction,
justifyContent, alignItems, wrap})` 是 **create 选项**（与 CSS 同名对齐，取值层已把枚举值
对齐成 CSS 关键字，透传即可）；`Span.create('…')` 是 **Text 的内联子段**（Text 栈内挂 span）；
`LoadingProgress.color` → spinner 的 currentColor；`Blank.color` → 空白背景。

**实现**（新分片 `runtime/src/small.js`，第 15 个，手写优先）：Flex → display:flex 直落 +
applyCreateArgs 的 Flex 分支（create 参数在组件创建时落 CSS——属性应用时的 span 栈还没有
子节点，几何在渲染后由浏览器布局给出）；Span = span 元素 + 字体属性落自身
（fontColor/fontSize/decoration——decoration 的枚举值就是 CSS 关键字，挂 global 后直接
透传）；LoadingProgress → CSS spinner（`border-top-color: transparent` 的圆环 + rotate
动画，`color` → currentColor）；Blank → flex:1 占位（Row/Column 内自动填充剩余空间），
color → 空白背景。**`FlexDirection`/`TextDecorationType` 挂 global**（此前产物没引用这两个
枚举，本轮起需要）。

```
$ bash run.sh smalldemo
=== ALL PASS ===                    （14 条断言，双端同数）
PASS Flex：display:flex／direction=Row → row／SpaceBetween → space-between／
     Blank 在 Flex 里占满中段（L 在 R 左侧）
PASS Span：内联子段文本连续／fontColor/fontSize 落自身／decoration → underline + 颜色
PASS LoadingProgress：spinner 容器＋旋转动画＋color → currentColor
PASS Blank.color → 空白背景
```

**破坏验证**（3 处，各恰好 1 条红）：① Flex.create 参数不落 CSS → `justifyContent` 红
（Blank 占满是**布局结果**，不受参数影响——各断言管各的面）；② Span 属性分派短路 →
decoration 红（fontColor/fontSize 走的是样式层也变红，但内联文本仍在）；③ Blank 的 flex:1
摘除 → 占满断言红（宽 0 现形）。还原后 md5 与基准一致，inputdemo 回归绿。

**已知限制**（写进 CAPABILITY）：`Span` 的 `textShadow`/`textCase` 只记录；`LoadingProgress`
的 spinner 是 CSS 近似（真机是弧形进度动画）；`Flex` 的 `alignItems` 基座默认 center
（与 ArkUI 默认一致）。

**触及**：`runtime/src/small.js`（新分片，第 16 个）、`runtime/src/area.js`（SMALL 分支）、
`runtime/src/main.js`（@include + 安装全局 4 组件 + 2 枚举 + applyCreateArgs Flex 分支）、
`tools/stats.mjs`（手写 38 → 42）、`fixtures/pages/SmallDemo.ts`、`harmony-proj/`
（SmallDemo.ets + main_pages.json）、`test/smalldemo.html`、`run.sh`、`electron/run.sh`

## R37：分步器 `Stepper` / `StepperItem` ✅

**测量**（新增 `pages/StepDemo.ets` → 官方构建）：`Stepper.create({index})` + 五事件
（`onNext`/`onPrevious` 双参 `(index, pendingIndex)`、`onChange(prevIndex, index)`、
`onSkip()`、`onFinish()`，全部照 `.d.ts` JSDoc）；`StepperItem` 只有 `prevLabel`/`nextLabel`/
`status(ItemState)` 三个属性方法。本 SDK 里 Stepper 全文 `@deprecated since 22
@useinstead Swiper`——产物仍真实引用，照实现。

**实现**：`StepperItem` → 隐藏 div（`data-stepper-item`）；`Stepper` → 内置导航条
（prev/pages/next），子项在渲染后同步阶段汇入 pages 段，label 汇入导航条文案（缺省回退
‹/›）。派发语义 ~~照 `.d.ts` 推断~~ **R39 照真机源码纠偏**（ace_engine
`stepper_pattern.cpp` 的 `HandlingRight/LeftButtonClickEvent`）：**先 `onChange(index, pending)`
再 `onNext`/`onPrevious`**；Skip 页点 next 只发 onSkip、**不切页**；末页 Normal 只发 onFinish、
不切页；Waiting/Disabled 点 next 整体忽略；编程改 index 静默切页（swiper 桥不转发事件）。
**`ItemState` 枚举值按声明顺序 `{Normal:0, Disabled:1, Waiting:2, Skip:3}`**——产物把
`ItemState.Skip` 原样留给运行时求值，照抄"想当然"的值（0/1/2）会让 onSkip 永不触发。

```
$ bash run.sh stepdemo
=== ALL PASS ===                    （26 条断言，双端同数；R37 时 16，R39 照真机纠偏后 26）
PASS 结构：三页汇入 pages 段／首页可见／导航条存在／label 汇入（back0/next0）
PASS 注册面：onChange/onNext/onPrevious/onSkip/onFinish 各一条
PASS 派发链（R39 真机时序）：点 next → CHG0>1;NEXT0,1;（onChange 先发）→ Skip 页 →
            只发 SKIP; 不切页 → 末页 → 只发 FIN; 不切页 → prev → CHG2>1;PREV2,1;
PASS 导航边界（R38）：go(99)/go(-1) 越界拒绝／编程跳页静默不发事件／缺省 label 回退 ‹/›
PASS 多实例与状态族（R38）：路由外 DSL 建第二台 Stepper／Waiting/Disabled 落 data-status
            ／onChange 注册两次覆盖语义（坑 88 同族）／Waiting 页点 next 被忽略（真机语义）
            ／sp1 索引不受 sp2 影响
PASS 回归：Stepper.* 不再记"未实现"警告
```

## R39：语义纠偏——对照 OpenHarmony 真机源码 ✅

**参考仓库**：`/data/work/compiler/Ark`（完整 OpenHarmony 树，54 个子系统，5.4G）。对本项目
最有价值的三个：`arkui_ace_engine`（真机 ArkUI 框架，`frameworks/core/components_ng/pattern/`
下每个组件的 C++ pattern 是**语义与事件时序的权威**）、`arkui_qrcodegen`（真机 QRCode 组件的
编码器源码——**R41 已直接复用**（见上文「R41」）、`arkcompiler_ets_runtime`（R24 ArkVM
调研的对象本体）。

**纠偏内容（Stepper）**：R37 按 `.d.ts` JSDoc 实现的派发时序与真机源码有**三处分歧**，本轮全部
对齐——①顺序：真机**先 FireChangeEvent 再 FireNextEvent**（我们原先反了）；②Skip 页：真机只
FireSkipEvent、**不切页不发 onChange**（页面去向由 app 决定；我们原先自动前进并补发 onChange）；
③Waiting/Disabled：真机点击**整体忽略**（我们原先按 Normal 放行）。另外确认：末页 onFinish
也不切页；prev 的 pendingIndex 经 `clamp(index-1, 0, maxIndex)`（第 0 页点 prev 会发
change(0,0)+prev(0,0)，照抄）；编程改 index 走 swiper 桥**静默切页**。

**教训（新坑 94）**：`.d.ts` JSDoc 只给**签名**（参数、默认值），不给**时序**（事件先后、
要不要切页、边界态如何分流）——后者必须读真机 pattern 源码。R37 的实现"每条都符合 JSDoc"，
但整条链路的顺序是错的。

**验收**：`bash run.sh stepdemo`（26 条断言）双端通过。**破坏验证（3 处，各 1 红）**：顺序反转
→ 派发链断言红；Skip 页误切页 → onSkip 组红；Waiting 放行 → 忽略断言红。还原后 md5 一致。

**触及**：`runtime/src/small.js`（fireNext/firePrev/goTo 照真机重写）、`test/stepdemo.html`
（期望值改真机时序，16→26 条）、五文档、`.reasonix/handoff.md`


**破坏验证**（3 处）：① STEP 分派短路 → **9 红**（注册面 5 + 派发链 4）；② XC 分派短路 →
**1 红**（通用 data-* 落点走 `JSON.stringify`，导航条文案带引号 `"back0"` 现形）；
③ Skip 语义短路 → **1 红**（Skip 页错走 onNext）。还原后 md5 一致。

**已知限制**（写进 CAPABILITY）：`ItemState.Waiting` 的视觉语义（隐藏 next 按钮、换进度条）
未实现，按 Normal 放行；`ItemState.Disabled` 禁用语义未实现；create 的 `index` 只在创建时
生效（后续改不跳页）；无 STEPPER_UNSUPPORTED 记警告通道（label/status 均已实现，未用到的
通用样式属性走基座）。

**过程教训**（坑 90/91，DEVELOPING）：破坏验证中断后 `BROKEN-1` 短路残留源码，后续测试全在
破坏态下跑、派发断言被误删——恢复后按"先证注册、再证派发"重建。**中断恢复先清残留、对
md5、重跑绿态**；分派分支必须与兄弟分支同级（嵌进兄弟组件的条件块是静默死分支）。

**触及**：`runtime/src/small.js`（Stepper/StepperItem/ItemState/XC_ITEM_ATTRS/STEP_ATTRS）、
`runtime/src/area.js`（STEP/XC 分派分支）、`runtime/src/main.js`（安装全局
Stepper/StepperItem/ItemState）、`tools/stats.mjs`（手写 42 → 44）、`fixtures/pages/StepDemo.ts`、
`harmony-proj/`（StepDemo.ets + main_pages.json）、`test/stepdemo.html`、`run.sh`、
`electron/run.sh`

## R38：质量切片——渐进强类型化 + 测试补全 + 两个真 bug ✅

**起因**：R37 提交时 Mimosa 钩子提示"没拿到完整扫描结论，请重跑完整审计"；顺手把三件事一起收：
①重跑 Mimosa deep 审计；②补全测试流程与断言；③渐进强类型化。

**强类型化（渐进路线，红线 0 错误）**：TypeScript 用 ets-loader 自带的 4.9.5（项目零 npm 依赖）。
**检查单元是【拼接后的产物】而不是分片**——15 个分片运行时是同一个 IIFE 的函数作用域片段，
按文件检查会得到 153 个假 "Cannot find name"（分片模式 370 错 → 产物模式 211 错，假阳性全消）。
三件套：`runtime/src/runtime.d.ts`（与 lib.dom 的 **Element 声明合并**，把 123 个挂载状态字段
`__stepCbs/__svg/__arkuiComp…` 固化成接口词汇表——拼错字段名直接红）+ `tsconfig.check.json`
（checkJs + strictNullChecks；`noImplicitAny` 约 1508 个，列为后续路线）+ `tools/typecheck.mjs`
（接进 `check-all.sh` 成为**第 5 步**，红线 0）。211 → 0 逐桶修完，修法全部 JSDoc/括号级
（零运行时改动），机制沉淀为坑 92（`x = x || {}` 赋值表达式类型坍缩）与坑 93（属性位置 JSDoc
不生效）。

**两个真 bug（类型检查挖出，都有潜伏史）**：
1. `onSubmit` 的 wrapper 写了 `value(...)`——未定义标识符，Enter 一按 ReferenceError 且被自家
   try/catch 吞掉，这就是 R34 "派发未打通之谜" 的全部真相；修复（`value`→`v`）后 textdemo
   弱断言升级为端到端 `SUB6;`，并顺手补上一直缺失的 `enterKeyType` 属性处理器
   （此前 wrapper 读的 data-enter-key 无人写入）——inputdemo 新增 onSubmit 组（27→29 条）。
2. v2 装饰器内部绑定 `const Event` 与 Scroller 的 `new Event('scroll')` 同处一个 IIFE 作用域——
   遮蔽后 `dispatchEvent` 收到的是装饰器函数实例（TypeError）。lazy.html 一直绿是因为该分支
   有 `flush()` 兜底——炸点是潜伏的。修复：内部改名 `EventDeco`（装饰器表键名不变，产物前奏
   不受影响）。教训：当年只防住了"挂 global 遮蔽 window"，没防住"IIFE 内部互相遮蔽"。

**测试补全**：stepdemo 16→**25 条**（新增导航边界：越界拒绝/编程跳页派发/缺省 label 回退；
多实例与状态族：路由外 DSL 建第二台 Stepper、Waiting/Disabled 落 data-status、onChange 覆盖
语义、实例隔离）。**破坏验证（3 处）**：越界守卫摘除 → **4 红**；Skip 语义反转 → **3 红**；
enterKeyType 处理器摘除 → **2 红**（失败信息恰好演示回退 Done(6)）。还原后 md5 一致。

**审计（Mimosa deep，2026-09-21 重跑）**：见 `.reasonix/handoff.md` 会话日志的审计结论行。

**触及**：`runtime/src/runtime.d.ts`（新）、`tsconfig.check.json`（新）、`tools/typecheck.mjs`（新）、
`tools/check-all.sh`（+1 步）、`package.json`（typecheck script）、`runtime/src/{input,v2,small,
main,nav,ability,draw,animation,gesture,show,popup,area}.js`（JSDoc 类型注解 + EventDeco 改名 +
onSubmit 修复 + enterKeyType 补全）、`test/{stepdemo,inputdemo,textdemo}.html`、五文档

## R45：`Image` 组件——真实 `<img>` 基座 ✅

剩余骨架里最常用的组件落地上线。**测量**（新增 `pages/ImageDemo.ets` → 官方构建）：
`Image.create(src)` 单参；`objectFit(ImageFit)` 的枚举是自由变量（ImageFit 数值照 `.d.ts`
声明顺序 Contain=0/Cover=1/Auto=2/Fill=3/ScaleDown=4/None=5/对齐族 7..15/MATRIX=16）；
`alt(src)` 占位、`onError`/`onComplete`/`onLoad`、`syncLoad`。测量时踩了两个流程坑：
①harmony-proj 的页面源是**声明式 ArkTS**（`@Entry @Component struct`），不是产物里的 ViewPU
类；②ArkTS 禁内联对象字面量类型/参数需非空收窄。

**实现**（新分片 `runtime/src/image.js`，第 17 个）：根 = div 包装（`__arkuiImage`），内含
主 `<img>` + alt 占位 `<img>`（绝对定位垫底，主图未加载/失败时顶上——真机 alt 的
"placeholder during loading" 语义）；`objectFit` → CSS `object-fit`（五个枚举语义与 CSS
关键字同名对齐：contain/cover/fill/scale-down/none；Auto 不映射记 data-*；对齐族与 MATRIX
记警告）；`onComplete` 载荷带**真实解码尺寸**（naturalWidth/Height）+ 组件尺寸；回调经
`__imgCbs` 闭包 + **同步认领**（load 事件与补派发双触发只跑一次——首跑当场抓住双发抛错）。
图片 URL 用绝对路径 `/test-assets/...`（measimage 同约定；相对路径在 /test/ 页面下会 404）。

**widgets 旧契约升级**：Widgets 页的 `Image('img.png')` 让全矩阵跑出 `querySelector('img')` 命中
**预插的无 src alt 占位图**（getAttribute('src')=null）——修法：alt 占位图**惰性创建**（设了
.alt() 才进 DOM），src 解析不出 URL 时记 data-src + 警告（不再伪造 src='null'）。

**验收**：`bash run.sh imagedemo`（15 条断言：基座/objectFit 两档对照+枚举数值/alt 占位/
onError/onComplete 载荷 13×5/syncLoad/回归）+ `bash run.sh widgets`（Image 断言恢复）双端通过。**破坏验证（3 处）**：objectFit CSS
映射短路 → **2 红**；SLIDE_SWITCH... alt error 顶上摘除 → 0 红（TryAlt 路径已覆盖，无观察面
——如实记录）；fire 同步认领撤销 → **3 红**（双发抛错回归）。还原后 md5 一致。

**触及**：`runtime/src/image.js`（新，第 17 个分片）、`runtime/src/area.js`（IMAGE 分派分支）、
`runtime/src/main.js`（@include + Image/ImageFit 挂 global + syncDrawings 钩子）、
`runtime/src/runtime.d.ts`（Image 词汇表）、`tools/stats.mjs`（手写 44→45）、
`harmony-proj/.../ImageDemo.ets` + `fixtures/pages/ImageDemo.ts`、`test/imagedemo.html`、
`run.sh`、`electron/run.sh`

## R46：`Scroll` 滚动容器——真实 overflow 基座 ✅

**测量**（新增 `pages/ScrollDemo.ets`，声明式）：`Scroll(scroller)` create 单参**直接是 Scroller
实例**（不是 {scroller} 选项对象——首跑把它当选项对象解包，`_bind` 没跑、scrollBy 全哑，探针
抓到 `未绑定容器`）；`scrollable(ScrollDirection)`（Vertical=0/Horizontal=1/Free=2/None=3）、
`scrollBar(BarState)`（Off=0/Auto=1/On=2）、`edgeEffect(EdgeEffect)`（Spring=0/Fade=1/None=2）、
`onScroll(x,y)`/`onScrollEdge(side)`/`onScrollStart/End/Stop`；Scroller 侧
`scrollTo({xOffset,yOffset})`/`scrollBy`/`scrollEdge(Edge)`/`scrollPage({next})`/`currentOffset()`
/`isAtEnd()`。

**实现**（新分片 `runtime/src/scroll.js`，第 18 个）：根 = div，overflow 由 scrollable 决定；
`scrollBar(Off)` → 注入 `scrollbar-width:none` + ::-webkit 规则；`scrollBarColor/Width` →
`scrollbar-color/width`（Chromium 121+）；`edgeEffect` → overscroll-behavior（None→none）。
**Scroller 扩面**（layout.js）：`scrollTo` 支持 `{xOffset,yOffset,animation}` 官方形参
（animation=true → DOM smooth 近似）；新增 `scrollBy`/`scrollEdge`/`scrollPage`/`isAtEnd`；
`currentOffset()` 按 `.d.ts` 返回 `{xOffset,yOffset}`（保留 x/y 键兼容旧用例）。主动滚动
（scrollBy/scrollEdge/scrollPage）改 scrollTop 后**同步派发** scroll 事件（确定性）。
事件收口：`onScrollEdge` 只在**到达沿**触发一次（lastEdge 记忆，离开再到才再发）；
`onScrollStart/End` 是真机手势语义——DOM 化为"滚动静默 80ms 收口"（近似，标注）。

**验收**：`bash run.sh scrolldemo`（16 条断言：基座/Scroller 五法/事件三族/回归）双端通过。
**破坏验证（3 处，各 1 红）**：overflow 映射短路；滚动条隐藏选择器破坏；onScroll 派发删除。
还原后 md5 一致。

**触及**：`runtime/src/scroll.js`（新，第 18 个分片）、`runtime/src/layout.js`（Scroller 扩面）、
`runtime/src/area.js`（SCROLL 分派分支）、`runtime/src/main.js`（@include + Scroll/枚举挂
global）、`runtime/src/runtime.d.ts`、`tools/stats.mjs`（手写 45→46）、
`harmony-proj/.../ScrollDemo.ets` + `fixtures/pages/ScrollDemo.ts`、`test/scrolldemo.html`、
`run.sh`、`electron/run.sh`

## R47：`ImageAnimator` 帧动画——逐帧定时器 + 状态机 ✅

剩余骨架里确定性最高的组件（纯 setTimeout 驱动，headless 虚拟时间下完全确定）。**测量**
（新增 `pages/AnimatorDemo.ets`）：`ImageAnimator.create()` 无参；`images([{src},…])` 的
ImageFrameInfo 单帧可带 duration（优先于全局）；`duration` = **每帧** ms（默认 1000）；
`iterations` 默认 1、-1 无限；`state(AnimationStatus)`（Initial=0/Running=1/Paused=2/
Stopped=3）；事件只有 **onStart/onPause/onRepeat/onCancel/onFinish 五枚——本 SDK 的 d.ts
没有 onFrame 属性**（不要照旧文档实现）。产物顺序 `state` 先于 `onStart` 应用 → 回调必须
**延时派发**（同步发会丢，实测）；`images` 字面量每次重渲染重建 → **深 diff 防重置帧序**。

**实现**（新分片 `runtime/src/animator.js`，第 19 个）：根 = div + 主 `<img>`；引擎 = 逐帧
setTimeout + 迭代计数：Running 推进、Paused 停表保持当前帧、Stopped 停表回第一帧、播完
iterations → 状态落 Stopped + onFinish（保持末帧）。

**验收**：`bash run.sh animatordemo`（13 条断言：逐帧推进到帧 1/Paused 停表保持/恢复推进/
onFinish 恰一次/状态落 Stopped/保持末帧）双端通过。**破坏验证（3 处）**：state 同值守卫摘除
→ **0 红**（重渲染窗口恰无断言，如实记录）；引擎不推进 → **6 红**；Paused 不清已挂定时器 →
**2 红**（帧 1 被越过）。还原后 md5 一致。

**触及**：`runtime/src/animator.js`（新，第 19 个分片）、`runtime/src/area.js`（ANIMATOR 分派
分支）、`runtime/src/main.js`（@include + ImageAnimator/AnimationStatus 挂 global）、
`runtime/src/runtime.d.ts`、`tools/stats.mjs`（手写 46→47）、
`harmony-proj/.../AnimatorDemo.ets` + `fixtures/pages/AnimatorDemo.ts`、`test/animatordemo.html`、
`run.sh`、`electron/run.sh`

## R44：已确证组件的语义回归扫描 ✅

对 R39–R43 确证过的语义逐项**重读真机源码找首轮漏掉的边界行为**——扫出两处分歧并修正、
一处一致转确证，全部补上守卫断言：

| 组件 | 扫描点 | 真机行为 | 结果 |
|---|---|---|---|
| Stepper | `maxIndex_ = TotalCount()`、动画中点击忽略 | 前者与我们等价；后者我们无转场动画不适用 | 一致/记录 |
| Navigation 联动 | `UpdateTitleModeChange()`：高度≥max→Full、==56→Mini | 端点触发 | **一致转确证**（原"端点判定是本实现的选择"） |
| Marquee | `step≤0`：真机只在 `step>0` 时除以 step | step≤0 → duration = 距离×85 **不除、不替换 6** | **分歧已修正**（原错替换成 6） |
| QRCode | 组件尺寸 < 矩阵模块数：真机记错误**拒绝绘制** | `qrcode_modifier.cpp:55` | **分歧已修正**（原 cell 兜底 1px 硬画溢出） |

**新守卫断言**：showdemo——DSL 建 `step:0` 跑马灯，时长 = 距离×85 精确（3400ms）；
qrdemo——DSL 建 20px QRCode（内容 'tiny' 矩阵 V1=21 模块 + quiet 8 = 29px 需求）：拒绝绘制 +
出声 + **只尝试一次**（后续补画不重试不出声）。为此把 `syncDrawings` 暴露为
`__arkui_dom_syncDrawings` 钩子（DSL 建的绘制类组件不经过渲染管线，测试需要手动触发）。

**过程教训**：破坏/恢复脚本两次把方向写反（old/new 颠倒），靠 `grep BROKEN` 回读才抓到——
破坏脚本必须**回读验证**（恢复后 assert 无 BROKEN 残留），不能只看脚本打印。

**验收**：qrdemo 15 / showdemo 28 条双端通过；破坏验证 2 处（1 红 / 3 红），还原后 md5 一致。

**触及**：`runtime/src/show.js`（Marquee step≤0 分支 + QRCode 尺寸守卫）、`runtime/src/main.js`
（syncDrawings 钩子）、`test/{qrdemo,showdemo}.html`（回归断言）、五文档

## R43：语义确证第三轮——滚动联动 + SLIDE_SWITCH 照真机修正 ✅

**① 滚动联动**（`title_bar_pattern.cpp`，原"阈值/缩放比是实现选择"）：确证 + 两处修正——
收缩模型真机 = `高度 clamp(default+scroll, 56, Full)`，**阈值 = 滚满 Full−Mini px 与实现一致**；
**副标题透明度 = (H−56)/(max−56)**（1 线性到 0；原实现 0.7×(1−col)，已修正）；主标题真机是
**字号插值**（主题 `title_primary=30fp` ↔ `title_secondary=26fp`，映射 `Curves::SHARP`
= cubic-bezier(0.4,0,0.6,1)），DOM 侧等价实现 scale = (26+SHARP(p)×4)/30（原线性高度比，
已修正；SHARP 关于中心对称，p=0.5 时同为 0.5）。

**② SLIDE_SWITCH**（原 scale(0.8) 推断）：照 `rosen_transition_effect.cpp` 确证
`SLIDE_SWITCH_SCALE=0.85`（真机自带动效 curve(0.24,0,0.5,1)/600ms 属渲染层，DOM 侧时长仍走
外层窗口）。transitiondemo ⑪ 断言从"出声说推断"升级为"确证参数 0.85"。

**验收**：navtransdemo + transitiondemo 双端通过。**破坏验证（3 处，各 1 红）**：副标题公式回
0.7 → 公式断言红（0.529≠0.756）；SHARP 换线性 → scale 断言红（0.899≠0.884）；SLIDE_SWITCH 回
0.8 → offText 断言红。还原后 md5 一致。

**触及**：`runtime/src/nav.js`（副标题/主标题公式 + SHARP 求值器）、`runtime/src/animation.js`
（SLIDE_SWITCH 参数）、`test/{navtransdemo,transitiondemo}.html`（公式化断言）、五文档

## R40：语义清账——真机源码对照三连 ✅

**① Navigation push/pop**（原 R25 推断 300ms 全页滑）：照 `navigation_group_node.cpp` 确证——
入页 `+50% → 0`（`width×HALF`）、被盖页视差 `0 → -20%`（标题栏再 -2%）、弹出页 `0 → +50%`、
露出页 `-20% → 0`，同一根 `InterpolatingSpring(0,1,342,37)`、时长上界 450ms；CSS 用
`cubic-bezier(0.2,0,0,1)` 作临界阻尼近似。

**② Marquee 时长**（原 R28 推断 step×16ms/帧）：照 `marquee_pattern.cpp` 确证——
`duration = 距离 × 85 / step`（`DEFAULT_MARQUEE_SCROLL_DELAY=85`，LINEAR，step 默认 6vp、
大于文本宽按 6 兜底），LEFT 方向距离 = 容器宽 + 文本宽；CSS 变量喂真实起止像素，动画布局后
启动，基座改 block（真机占满行宽）。夹具 mq1 加 `step: 30`（默认 6 两圈 8.5s 超虚拟预算）——
走完整重测流程（.ets → hvigorw → 产物固化）。

**③ QRCode ECC**（原 R33 注记 L 级系误判）：真机 `qrcode_modifier.cpp:44` 硬编码
`QRCODE_ECC_MEDIUM`，且 node-qrcode 默认本就是 M——从未真渲染过 L。显式传参对齐 +
qrdemo 采样断言。

**验收**：navtransdemo **52** / showdemo **27** / qrdemo **12** 条双端通过。**破坏验证（3 处，
各 1 红）**：转场时长回 300ms／Marquee 换回旧公式／QRCode 显式打回 L。还原后 md5 一致。

## R41：QRCode 编码器换成真机源码 `arkui-qrcodegen`（WASM）✅

**做法**：不写一行业务代码——把 OHOS `arkui_qrcodegen` 的 C++ 源码（7 个 .cpp + 8 个 .h，
88.5KB）**逐字复制**进 `runtime/vendor/arkui-qrcodegen/src/`（md5 对源校验），本地附加物只有
三样：securec 三函数兼容 glue、emcc 构建脚本、同步加载器。产物是**单文件 WASM 脚本**（24KB
wasm base64 内嵌，`file://` 与 `http://` 同一份）——浏览器与 Electron 天然同源同行为，这就是
"最大兼容性和稳定性"的落点：编码器与真机设备**字面上同一份代码**。

**关键语义**（读真机源码拿到）：`QrcodeImageEncodeString(text, ecc)` 返回
`{version, width, data}`，`data[i] & 0x1` 为暗格（`0x80` 是函数图案标记位）；ECC 用组件硬编码的
MEDIUM(0)。加载器把矩阵拷成 `Uint8Array` 后立即 `QrcodeImageFree`，无跨调用状态。

**为什么 STANDALONE_WASM**：emscripten 6 的 JS 工厂是 async 的，而 QRCode 首绘在渲染后同步
阶段（不变量 18）等不起——STANDALONE 产物不带 emscripten 运行时，加载器用同步的
`new WebAssembly.Module` 自己实例化 + `__wasm_call_ctors` 初始化 dlmalloc。

**替换面**：show.js 编码调用、qrdemo（vendor script + 编码器对照断言改为"渲染矩阵 = 真机编码器
MEDIUM 输出，100 格采样一致；MEDIUM/HIGH 可区分"）、widgets 页 vendor 引用、node-qrcode vendor
删除（THIRD-PARTY-NOTICES §3b 重写）。jsQR 保留——它与编码器来自独立实现，交叉验证的独立性
反而更纯了。渲染差异如实记录：真机组件 API12+ 满幅绘制无 quiet zone，本实现保留 4 模块 quiet
（QR 规范 + jsQR 解码依赖）。

**验收**：`bash run.sh qrdemo`（12 条）+ `bash run.sh widgets` 双端通过。**破坏验证（1 处，
1 红）**：编码 ECC 换 HIGH(1) → 编码器对照断言红（采样 55/100）。还原后 md5 一致。

**触及**：`runtime/vendor/arkui-qrcodegen/`（新：src + glue + build.sh + LICENSE）、
`runtime/vendor/arkui-qrcodegen.js`（新产物）、`runtime/vendor/qrcode-1.5.4.*`（删除）、
`runtime/src/show.js`（编码调用 + 降级路径补警告——顺手清掉一处 BROKEN-1 残留注释）、
`runtime/src/main.js`（注释）、`test/{qrdemo,components}.html`（vendor 引用）、
THIRD-PARTY-NOTICES §3b、五文档

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
| 产物/源一致守门 | `npm run check:runtime` | `runtime/arkui-dom-runtime.js` 是 `runtime/src/` 的拼接产物；`--check` 逐行比对（孤儿分片/成环/漏展开也报错），漂移即非 0 退出；`npm run build:runtime` 重拼 |
| 文档数字守门 | `npm run stats:check-doc` | `ARCHITECTURE.md` §6 的整块实测数字逐行比对，漂移即非 0 退出；`stats:write-doc` 就地重写 |
| 覆盖统计 | `npm run stats` | 文档里的所有数字都由它产出（`--json` 机器可读） |

`npm run check` 当前：**7 步全绿（preflight + 生成物一致 + 产物/源一致 + 文档数字 + typecheck + 浏览器 41 用例 + Electron 40 用例）**。

## 下一步

**权威清单在 `docs/ROADMAP.md`**（每项带可复现的验收命令）。当前优先：

1. 骨架组件的视觉语义——手写 47 个：形状族 8（R26）、输入类 4+3（R27/R34）、
   信息展示类 4+1（R28/R33）、弹出类 3（R29）、表层类 2（R31/R32）、小件 4（R36）、
   分步器 2（R37）、Image（R45）、Scroll（R46）、ImageAnimator（R47）；`UIContext` 已收（R30）、`@ohos.multimedia.media` 已收（R35）。
   剩余候选以骨架清单（`node tools/stats.mjs` 的"骨架·仅 data-*"）为准
2. ~~**继续把 `runtime/src/main.js` 拆细**~~ **已拆到位（2026-09-21，源拆分第三步）**：9 个分片，
   `main.js` 剩 **1869 行 / 86,452 B**（基础设施 / 状态 v1 / ViewPU / 属性映射 / Tabs / Swiper /
   组件注册表 / 具体组件 / LazyForEach / 枚举路由 / 安装全局），已拆出
   `animation` / `gesture` / `nav`(1031 行) / `layout`(262) / `draw`(408) / `area`(237) / `v2`(251) /
   `ability`(196)。剩下的是组件注册表与安装全局（**不建议动** —— 前者被各节引用、后者是 IIFE 的出口）
   和若干更小的子节，性价比有限；机制随时可用（`tools/build-runtime.mjs` + `check:runtime`）。

> 已完成：`transition`（见上文「R22 收口」）、**手势分组与优先级仲裁**（见上文「R23 收口」）、
> **`Navigation` 标题栏/工具栏/分栏**（见上文「R12 收口」）、
> **`Navigation` 转场动画 + `onTitleModeChange` 滚动联动**（见上文「R25 收口」）、
> **runtime 源码分片**（R5c）、**R24 ArkVM/`.abc` 路径调研**（`docs/ARKVM-RESEARCH.md`）、
> **SVG 形状族**（见上文「R26」）、**输入类**（见上文「R27」）、**信息展示类**（见上文「R28」）、
> **弹出类**（见上文「R29」）、**UIContext**（见上文「R30」）、**Canvas**（见上文「R31」）、
> **XComponent**（见上文「R32」）、**QRCode**（见上文「R33」）、**输入收官**（见上文「R34」）、
> **`@ohos.multimedia.media`**（见上文「R35」）、**小件收官**（见上文「R36」）、
> **分步器**（见上文「R37」）。

**仍未覆盖**：`chainMode`、其余骨架组件的视觉语义（候选池见 `node tools/stats.mjs`）、
`ItemState.Waiting/Disabled` 语义（R37 记限制）。
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
- **`runtime/` 的"源拆、产物不拆"已跑通并拆到 3 个分片**（2026-09-21）：`runtime/arkui-dom-runtime.js`
  是 `runtime/src/` 的**拼接产物**（`tools/build-runtime.mjs`，`// @include <分片名>` 做拼接点），
  已拆出 `animation.js`（476 行：显式动画 + 出现/消失过渡）与 `gesture.js`（617 行：手势含分组与仲裁），
  `main.js` 剩 3524 行。两次拆分**产物都与拆分前逐字节一致**（220,899 B / `md5sum -c` 自证，
  `git` 里产物零改动）。门禁第 3 步 `build-runtime --check` 守"产物 = 源"。
  为什么必须"源拆、产物不拆"：产物是经典脚本，30 个手写 HTML 与 Electron 按固定顺序加载它；
  分片共享同一个闭包（`elmtRecords`/`propDeps`/`ViewStackProcessor`…），其中 `animWindow` 还是
  **可变绑定**（动画分片里 `let` 重新赋值、批量重渲染段在块外读它并 push）——拆成多个 `<script>`
  要把 6 个导入名 + 3 个导出名显式穿线，并让 30 处加载顺序成为新的失败模式。

---

## 测量结果（①.5）

原计划"直接代码生成 150 个组件"**优先级错了**。用重页面（`pages/Rich.ets`：自定义组件 + `@Prop` + `@Link` + `@Builder` + `ForEach` + `List` + `if/else` + `Button`）测量后，真正的难点是 **7 个机制**，不是组件数量。

两个样本（模板应用 / 重页面）的完整接口面对比见 `docs/surface-measurement.md`——**样本 A 严重低估**（组件 2→9、状态类 1→4、运行时全局 4→7、协议方法 +4）。
