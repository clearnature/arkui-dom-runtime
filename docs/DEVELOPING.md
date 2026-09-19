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
runtime/       运行时（三个文件，与宿主无关）
  arkui-dom-runtime.js       ← 手写语义都加这里
  generated-components.js    ← 生成物，不要手改
  ohos-shims.js              ← 平台模块
tools/         构建/统计脚本（都是 .mjs，可直接 node 跑）
fixtures/      冻结的 ets-loader 转换产物（测试的输入）
test/          断言页（每个用例一个 .html）
electron/      Electron 宿主 + 第二套 runner
build/         产物 + Chrome profile（不要提交）
docs/          文档
```

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

1. **先确认它是不是"手写"**。若组件名在 `runtime/arkui-dom-runtime.js` 的 `components` 里已存在（`Text`/`Button`/`Column`/`Row`/`Stack`/`List`/`ListItem`/`RelativeContainer`），生成骨架**会被跳过**，你必须改手写实现。
2. **判断该改哪一侧**：
   - 只需"标签或基础样式对" → 改 `tools/gen-components.mjs` 的 `CONTAINERS` / `LEAF_TAGS` / 输入类 `type` 映射，然后 `node tools/gen-components.mjs`
   - 需要**交互/布局语义**（子项挂载方式、切换、测量）→ 改 `runtime/arkui-dom-runtime.js`，走 `ensureComponent(name, domFactory, contentUpdater)`
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
- **`pop()` 必须与 `create()` 配平**。产物里是严格配对的；你的 `contentUpdater` 若在内部 push 了节点，只有产物会 pop——**不要**在 updater 里额外 push。
- **重渲染幂等**。`updateFunc` 第 2 次执行时节点已存在（`rec.node`），必须走复用分支，不能重复 `appendChild`。

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

## 6. 任务 C：新增一个测试用例

1. 在 `fixtures/pages/` 放页面产物（见第 7 节如何生成）
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

## 7. 重新生成 fixtures（需要 HarmonyOS 工具链）

只有新增/修改 `.ets` 页面时才需要。

```bash
# 1. 在 HarmonyOS 工程里构建
cd /tmp/hmtest/app && devecocli build

# 2. 转换产物在 hvigor 的 cache（注意这条长路径）
CACHE=/tmp/hmtest/app/entry/build/default/cache/default/default@CompileArkTS/esmodule/debug/entry/src/main/ets

# 3. 固化到 fixtures
cp $CACHE/pages/NewPage.ts fixtures/pages/
cp $CACHE/entryability/EntryAbility.ts fixtures/entryability/

# 4. 确认 extract 能处理它
node tools/extract.mjs fixtures/pages/NewPage.ts build/newpage.js --cjs --register NewPage
```

> `fixtures/` 是**冻结的官方产物快照**。改它是重写测试的输入，等于把测试变成"验证我自己写的产物"——除非工具链升级，否则不要动。

---

## 8. 调试手段

| 手段 | 用法 |
|---|---|
| 布局告警 | `global.__arkui_dom_layout_warnings` —— `@Consume` 找不到祖先、`@Watch` 挂载失败、`@Provide` 重复声明都会记在这里而**不抛异常** |
| 日志 | `global.__arkui_dom_logs` —— `@ohos:hilog` 的记录（有 `if (global.__arkui_dom_logs)` 守卫，不能在模块加载期直接引用） |
| 元素记录 | `__arkui_dom_elmtRecords` —— `elmtId → {node, updateFunc, parentNode, activeBranch, childView}`，排查重渲染/泄漏的第一现场 |
| 依赖同步 | `__arkui_dom_syncAlignRules(rootEl)` 手动重算 `alignRules` |
| 组件名 | `__arkui_dom_componentNames()` |
| 覆盖冲突 | `__arkui_dom_overwrittenGlobals` |
| 后端强制 | `global.__arkui_dom_force_backend = 'opfs'`；`__arkui_dom_enable_opfs = true` |
| 截图 | `electron/main.js` 用 offscreen 模式 + **像素级非白比例**判断是否真的画出来了 |

---

## 9. 已知陷阱（都真踩过）

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

### 语义正确性

| # | 陷阱 | 正确做法 |
|---|---|---|
| ⑫ | `alignRules` 六键记错：以为是 `center`=两轴居中、`middle`=不支持 | **`center`=垂直中心，`middle`=水平中心**；`ALIGN_FRAC` 要认识 `top`/`bottom`（否则 `bottom:End` 偏 100px） |
| ⑬ | 把 `Stack({alignContent})` 当属性 setter → 落进 `cssPropEnum`（CSS 的 `align-content`，语义完全不同） | `alignContent` 是 **create 选项**，走 `applyCreateArgs`；`applyAttr` 里还要**抢在 `cssPropEnum` 之前**拦掉 |
| ⑭ | `scrollToIndex` 目标是**孙节点**（`ForEach` 包裹层是 `display:contents`），且滚动容器缺 `position` 导致 `offsetTop` 基准错 | 容器 `position:relative` + 用 `data-arkui-comp` 标记定位 |
| ⑮ | `struct` 名叫 `Provide` → 与 `@Provide` 装饰器冲突：`Cannot redeclare block-scoped variable 'Provide'` | 改名（`ProvideDemo`） |
| ③ | 用 `sed -i` 改代码文件（违反自己的规则） | 用 `edit` 工具逐行精确改 |

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

## 10. 提交前检查清单

```bash
# 1. 两套 runner 全绿
bash run.sh all && echo "browser OK"
bash electron/run.sh all && echo "electron OK"

# 2. 统计与文档一致（改了覆盖范围就更新 ARCHITECTURE.md §6 的引用块）
node tools/stats.mjs

# 3. 生成物与生成器同步
node tools/gen-components.mjs --check

# 4. 新增/修改的脚本有可执行位
ls -l run.sh electron/run.sh tools/*.mjs tools/*.py

# 5. 没改 fixtures（除非工具链升级）
```

**文档纪律**：`ARCHITECTURE.md` §6 里的数字是**引用的实测输出**，不是手写估计值。改了覆盖范围就重跑 `stats.mjs` 并同步那个引用块——否则文档会先于代码腐烂。
