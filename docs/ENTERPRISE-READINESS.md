# ENTERPRISE-READINESS —— 企业就绪度差距账与任务原子分解

> 定位：从"门禁全绿的工程"到"企业级可交付"之间的差距账。每条任务是**原子**的——
> 一轮会话可独立收口，带可执行验收标准；完成即在任务行尾记（轮次/提交）。
> 与五文档关系：本文件是**规划面**，完成的事实仍记入 ROADMAP；已知限制的
> 语义细节仍以 CAPABILITY.md 为准。
>
> 分档：**P0 可信度底线**（不做没人敢上生产）/ **P1 企业功能面** / **P2 规模化承诺**。
> 原子格式：`E?-? 标题 [S/M/L]` —— 目标 / 原子步骤 / 验收（可执行） / 依赖。

---

## P0 可信度底线

### E0-0 本账建立 ✅（R129）
本文件。验收：ROADMAP 登记 + 每任务有验收标准。

### E0-1 渲染错误边界（ErrorBoundary）[M]
- 目标：任一组件 render/属性应用抛错不炸整页——错误被边界捕获、降级渲染、可恢复。
- 步骤：① 新分片 `errorboundary.js`：在 rerender/applyAttr 管线挂 try/catch 钩子，
  错误信息进 `__arkui_dom_errors` 环形缓冲（最近 N 条，含组件名/elmtId/stack 首行）；
  ② `ErrorBoundary` 组件面（onError 回调 + fallback 内容槽，对齐 SDK errorboundary
  语义若 d.ts 缺席则按最小面标注推断）；③ 渲染管线错误不再中断同批其余 elmtId。
- 验收：新建 `errbounddemo` 页——坏组件（属性回调抛错/render 抛错）≤N 条断言双端
  ALL PASS：页面其余组件照常渲染、`__arkui_dom_errors` 有记录、onError 收到载荷；
  现有全矩阵不回退。
- 依赖：无。

### E0-2 崩溃/错误上报钩子 [S]
- 目标：主进程侧收集渲染进程 uncaught + 主进程异常 → 本地 JSONL（企业接 SIEM 的挂点）。
- 步骤：① main.js `process.on('uncaughtException'/'unhandledRejection')` +
  `webContents 'console-message'/'render-process-gone'` → `userData/logs/crash-*.jsonl`；
  ② preload 暴露 `reportError(payload)`；③ 运行时 E0-1 的 errors 缓冲尾部随页面关闭上报。
- 验收：打包冒烟扩展——人为触发一条渲染错误 → userData/logs 出现含该错误的 JSONL 行；
  门禁不回退。
- 依赖：E0-1（载荷格式）。

### E0-3 焦点管理 + 键盘可达性 [L]
- 目标：Tab 序可达、`.focusable()`/`.defaultFocus()`/focusControl 语义、onKeyDown 系统化。
- 步骤：① 新分片 `focus.js`：tab 序 = DOM 原生序 + `focusable(false)`/`tabIndex` 映射；
  ② `focusControl`/`requestFocus` API 面（focus_control.d.ts）；③ `onKey*/onKeyEvent`
  派发统一（现有零散 onKeyDown 收口）；④ 焦点环样式（:focus-visible 注入，可关）。
- 验收：`focusdemo` 页——Tab 序列断言（合成 Tab 键序列 → document.activeElement 链）、
  requestFocus 编程聚焦、focusable(false) 剔除；双端 ALL PASS。
- 依赖：无（可与 E0-1 并行）。

### E0-4 长跑稳定性（内存/稳态）[M]
- 目标：8 小时级稳态不泄漏、不死锁——企业值守应用底线。
- 步骤：① 扩展现有 leak 页：路由循环 ×N、定时器/监听器登记账（`__arkui_dom_leaks`
  自省：timer/handle/MutationObserver 计数随路由循环不增长）；② 8h 稳态脚本
  `tools/soak.sh`（非门禁；Electron offscreen 循环路由 + 采样 heapSize 到 CSV）；
  ③ 结果入档 docs/research/soak-report.md。
- 验收：路由循环 500 轮后 timer/observer 计数与基线差 ≤ 常数；soak 报告无增长趋势。
- 依赖：E0-1（错误不静默积累）。

### E0-5 供应链与 CSP [S]
- 目标：依赖 CVE 扫描入门禁；渲染侧加 CSP。
- 步骤：① check-all.sh 加 `npm audit --omit=dev --audit-level=high` 步（第 8 步）；
  ② electron main `session.defaultSession.webRequest.onHeadersReceived` 注入
  CSP（script-src 'self'；测试页 eval CJS 仿真需 'unsafe-eval'——如实记录并留收紧项）；
  ③ vendor 目录许可清单核对（THIRD-PARTY-NOTICES 已有，audit 脚本复核）。
- 验收：门禁 8 步全绿（含 audit）；打包响应头含 CSP；矩阵不回退。
- 依赖：无。

### E0-6 启动失败可诊断 [S]
- 目标：白屏可自证——页面加载失败/运行时异常时显示诊断面而非空白。
- 步骤：① main.js did-fail-load → 错误页（含 URL/错误码/日志路径）；② 运行时
  boot 失败（模块加载异常）→ root 内渲染错误摘要。
- 验收：人为断链（错页面名）启动 → 诊断页截图非白 + 指明日志位置。
- 依赖：E0-2（日志路径）。

---

## P1 企业功能面

### E1-1 网络栈强化 [M]
- 目标：企业内网可用——代理/超时/重试/取消/证书策略。
- 步骤：① net.http 垫片加 `connectTimeout/readTimeout/retry(max,backoff)/abort`；
  ② Electron 侧走 main 进程 net 模块（系统代理继承）+ 渲染侧 fetch 双路（分端声明）；
  ③ 证书策略项（拒绝自签默认，`http.Proxy` 配置面）。
- 验收：`netdemo` 扩展——本地假服务器（tools/serve.py 加测试端点）断言超时/重试/取消；
  双端分端声明。
- 依赖：无。

### E1-2 结构化存储选型 + 落地（SQLite）[L]
- 目标：企业数据面——真 SQL + 事务，替代 preferences 自定 JSON 的"真机不通用"限制。
- 步骤：① 选型 spike（better-sqlite3 原生 / sql.js WASM——Electron 打包 ABI 与浏览器
  双端矩阵是裁决项）；② `@ohos.data.relationalStore` 垫片面（d.ts 对齐：getRdbStore/
  insert/querySql/事务）；③ 迁移指南（preferences → rdb 不自动，文档声明）。
- 验收：`rdbdemo` 页——建表/CRUD/事务回滚断言双端 ALL PASS；打包冒烟含 native 模块
  则记分发包约束。
- 依赖：无。

### E1-3 i18n 系统化 [M]
- 目标：`@ohos:i18n` 垫片面 + 资源 qualifier（zh/en 目录）+ RTL 收口。
- 步骤：① i18n 垫片（系统 Locale/Calendar/NumberFormat 映射 Intl）；② 资源加载器
  支持 `resources/zh_CN/element/` qualifier 覆盖（生成器扩展 locale 参数）；
  ③ RTL：WithEnv DIRECTION 已有 → 组件布局方向贯通（Row/方向枚举）。
- 验收：`i18ndemo` 页——切 locale 后 string 资源/日期/数字格式断言；RTL 布局方向断言。
- 依赖：E1-4（资源表 qualified 变体）——③ 可先行。

### E1-4 sys.* 资源表烘制 [S]
- 目标：`$r('sys.float.ohos_id_text_size_body1')` 类系统资源真值（现走手写默认表）。
- 步骤：① `tools/gen-sys-resources.mjs`：SDK `previewer/common/resources/entry/resources.txt`
  → `generated-sys-resources.js` 分片（R123 反查法，light 块为值、dark 存档）；
  ② `resolveResource` 的 sys 分支（numeric id 表已接 `__arkui_dom_resources`——改为
  生成表注入）。
- 验收：Index 页 fontSize 断言不变（真值 16 与旧默认一致则零改动；不一致则更新 +
  记差异）；新增 sys 表抽查断言（≤10 条）。
- 依赖：无（方法学 R123 已验证）。

### E1-5 多窗口完善 [M]
- 目标：桌面多窗（多 BrowserWindow 并存 + 焦点事件 + 跨窗路由栈隔离）从"雏形"到"可用"。
- 步骤：① window v2 扩展：多窗创建 API（WindowStage 分裂）；② 焦点事件
  onWindowFocusChange 双向（主进程 → 渲染）；③ ability 栈按窗隔离复核。
- 验收：`multiwindemo`——两窗并存、焦点切换事件序、互不串栈；双端（Electron 专属用例）。
- 依赖：无。

### E1-6 无障碍基础（ARIA 映射）[M]
- 目标：屏幕阅读器可用的底线——role/aria-label/aria-disabled 系统化。
- 步骤：① 组件语义 → ARIA 属性静态映射表（Button→button、Checkbox→checkbox、
  Text→text + accessibilityText 已有的属性接入）；② accessibility 系属性
  （accessibilityText/Description/Importance 在 hml piece.json 有据）落 aria-*。
- 验收：`a11ydemo` 页——关键组件 role/aria-* 断言；axe-core 扫描（vendor 引入）
  严重违规 = 0。
- 依赖：无。

### E1-7 打包态资源与升级 [S]
- 目标：R128 留白收口——打包应用携带 app 资源；产物热升级策略文档。
- 步骤：① packager 拷 harmony-proj resources → 包内路径 + 运行时 base 探测（打包态
  相对路径分支）；② 升级策略：全量替换 + userData 不动（已有 R75 迁移）文档化。
- 验收：打包 resourcedemo 冒烟（资源真值断言在包内通过）。
- 依赖：无。

---

## P2 规模化承诺

### E2-1 增量走查（优化器 v3 前置）[L]
- 目标：重渲染只走 dirty 子树（现全树 O(N)/次）。
- 步骤：① 依赖标记已有（markDependentsDirty）→ 走查队列化：从 dirty elmtId 上溯
  最近重渲染边界；② 正确性护栏：现有全矩阵 + 行级复用断言不回退是硬门槛；③
  perf 基线对比（AttrHeavy/Stress1k flush_ms）。
- 验收：全矩阵绿 + AttrHeavy flush_ms 不劣化 + 深树场景（新压测页）亚线性证据。
- 依赖：无（风险最高，最后做）。

### E2-2 万节点压测 [S]
- 目标：把"千节点亚线性"承诺升到"万节点可用"。
- 步骤：Stress10k 页（表格型 + 列表型两种形态）+ 性能预算断言（首渲/flush 预算）。
- 验收：预算内 + 截图判定非白；数字入 ARCHITECTURE §6。
- 依赖：E2-1 收口后数字才有意义（可先测得基线）。

### E2-3 真机差异清单产品化 [S]
- 目标：采购视角的"与鸿蒙真机行为差异"一页账。
- 步骤：汇总 ARKVM-RESEARCH + 散落各文档的实现差异（三层一致性模型"实现❌刻意不同"
  的全部条目 + 嵌入泵模式等宿主差异）→ `docs/DEVICE-DIFF.md`（单表：差异/影响/依据）。
- 验收：文档评审（用户复核）；五文档交叉引用更新。
- 依赖：无。

---

## 排期建议（轮次序列）

```
E0-1 → E0-2 → E0-5 → E0-6   （P0 可信度，~3-4 轮）
E0-3（可并行）→ E0-4
E1-4 → E1-1 → E1-3 → E1-7 → E1-2 → E1-5 → E1-6   （P1 功能面，~6-8 轮）
E2-3（随时可插）→ E2-2 基线 → E2-1 → E2-2 复测    （P2 规模化，~4-5 轮）
```

## 完成定义（企业级的门槛声明）

P0 全绿 + P1 主干（E1-1/2/3/4）= **可承接企业内部工具/看板/kiosk 交付**；
+ P1 全部 + P2 = **可签 SLA 的产品化交付**。每档达成时在本节记（日期/提交）。
