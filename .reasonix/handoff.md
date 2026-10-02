# HANDOFF — arkui-dom-runtime

> 仓库记忆。不在本文件 = 没发生。每次会话开始读它，结束时裁剪它。
> 细节的唯一权威是五文档：`README.md` / `docs/ROADMAP.md` / `docs/ARCHITECTURE.md` /
> `docs/CAPABILITY.md` / `docs/DEVELOPING.md`；另有专题汇总统稿 `docs/CANGJIE-KERNEL.md`
> （仓颉内核线：架构/ABI/挂载/泵模式/坑速查）。本文件只做索引与进度，不复制内容。

## TL;DR（当前 — 下次会话必须 1 分钟内理解）

- 目标：**ArkTS（ArkUI 声明式）应用跑在 Electron / 浏览器**——复用官方 `ets-loader` 做
  ArkTS→JS 转换，自研 JS 侧 DOM 运行时；不需要 Rosen / ark_js_vm / 宿主 ArkUI / RichPreviewer
- 上次切片：**R159 chainMode 补验收口 + v2 容器代理收口 + image 扩展**（R159 三 agent 限额
  中断后主会话接管收尾）——
  A=chaindemo 测试页修复（kick 实例必须持住：`ViewPU.create` 不返回实例，裸 `kick` 被
  id=kick 的 DOM 命名全局劫持→属性翻写静默无效→flush 管线整轮没跑→链完全不成；
  +组内局部 warns 尾部引用 ReferenceError）+ **运行时真缺口**：syncChainLayout 容器锚距
  从 offset*（边框盒）改 client*−padding（内容盒，与 applyAlignRules 同口径）——RC 带
  1px 边框时锚距多 2px、链尾越过真实底边。
  B=v2 W5 回归修复：v2NotifyPathMonitors fire 后重注册段 cell（真机 bindRun 每次重跑
  analysisProp，v2_monitor.ts:520-531）——元素替换后尾段 cell 仍指旧元素，新元素字段写
  （rep.name=x）无法唤醒；抽 v2RegisterMonitorSegs（bind 与 fire 后重走共用）。
  C=image 段 data: URI 直解码（dataUriToBlob，绕 CSP connect-src——Electron 注入的
  default-src 'self' 拦 fetch(data:)，浏览器无 CSP 端看不到此差异）。
  集成另修：Electron all 块补收 chaindemo（R145/R154 漏收家族第 4 例）；builtindemo
  收口断言容忍恰零末帧+改收敛轮询（负载/虚拟时钟竞态，第七跑 imageext running… 同族
  ——真实图像解码吃墙钟、虚拟时钟帮不上，机器 15min 负载 51 时首现；qemu pkill 减压
  复验即绿）。
  验收：chaindemo 23 / v2sem 59 / imageext 19 条断言五端通过；
  门禁 11 步全绿（b62f3b3，Mimosa 0 findings seal sha256:b48554dc…）；
  五端矩阵 87/99/87/87/87。
  更早：**R158 Tabs 长尾收官 + Repeat templateId 分桶深化**（多智能体 A/B 双线）——
  A=Tabs animationMode 三值（CONTENT_FIRST/ACTION_FIRST/NO_ANIMATION——NO_ANIMATION 仅
  点击路径禁动画 fromClick 判定、changeIndex/拖拽/spring 不受影响，与 duration=0 全局
  门控分家）+ onContentWillChange（(cur,coming)=>boolean false 拒绝切换——守卫在改 index
  之前、拒绝时 sel/unsel/动画对/onChange 全不发、抛错 fail-open）+ onContentDidScroll
  （拖拽逐帧四参 sel/idx/pos/len 与 onGestureSwipe 同帧同期）+ customContentTransition
  留警告；**TABS_UNSUPPORTED 收敛至仅 customContentTransition**；tabanim 81→99。
  B=Repeat templateId 分桶深化——st.pool 单池升级 `Map<tplKey, Array>`（同模板桶 LIFO/
  跨模板桶不取/桶上限 16/桶）、case#1 tplKey 守卫（同键换模板转新建）、删除旧跨模板
  复用回退；batchfunc ① 组 39→49、页总 62→72。
  门禁 11 步全绿（41a3f4c，Mimosa 0 findings seal sha256:1f817ebd…）；
  五端矩阵 84/98/84/84/84。
  更早：**R157 chainMode 链式排列 + Gauge/DataPanel 绘制深化**（多智能体 A/B/C；
  A 因限额中断由主会话补完收尾）——A=RelativeContainer chainMode（SPREAD/SPREAD_INSIDE/
  PACKED 三分支+溢出居中+GONE 跳过+双链共存 bias 失效——真机 cpp:768-830 逐式对齐；
  **链识别无显式分组**：链头=双锚规则+chainMode 标记、成员沿邻接图遍历；**chainBias 不存在**
  ——bias 取自 alignRules 内字段）；B=Gauge 指针 CSS 线条（角度=弧度插值）+description+
  DataPanel strokeWidth(24vp)/trackShadow(box-shadow 近似 radius 20/offset 5,5)/closeEffect
  （缺省 false=阴影开启）+trackBackgroundColor 接入；C=chainMode 布局算法+Gauge/DataPanel
  d.ts 全属性面。**Agent 限额耗尽应对**：A 中断时主会话补 chainBiasOf JSDoc（typecheck 归零）
  +gaugedemo 接线（run.sh all 块+dispatch）。验收：`bash run.sh gaugedemo`（30 条断言，
  五端通过）；门禁 11 步全绿（0a64208，Mimosa 0 findings seal sha256:fa6e8011…）；
  五端矩阵 **85/98/85/85/85**。
  更早：**R156 Repeat onMoveThrough + @ohos:curves 垫片 + onTotalCount 登记**
  A=Repeat onLazyLoading 懒加载协议（R152 记档警告分支升级真实现；签名 `onLazyLoading(index)`
  绝对索引——C 纠偏任务书"差值"假设；单发防死循环/只写该索引 BusinessError 103804/
  min(arrLen,totalCount) 裁剪）+ __arkui_dom_repeatLazy 驱动钩子；① 组 23→30、页总 53。
  B=edgeEffect 三态（SDK 枚举实证 Spring=0/Fade=1/None=2 **无 Shadow**——任务书
  "Spring/Shadow/None"纠偏，shadow 收前向扩展值；None=越界硬停+直接落边界；
  Tabs.edgeEffect since 12 单参/Swiper 真名 effectMode；G8 大写 None 警告兼容）+
  tabanim 46→66。C=onLazyLoading 协议（getItemUnmonitored 同步单发/:1592 BusinessError/
  :411 复位）+ @ohos:curves 模块面（**ICurve 可读**——__curveString 序列化参数包；
  springMotion 系 interpolate 不可用——Swiper.curve ICurve 读取铺路）。
  **集成三修**：坑 117 家族五连红根治记档（三条铁律入 R155.1 行）；batchfunc 46→53、
  tabanim 46→66 声明同步；门禁 11 步全绿（4a6ce49/8708dbe，Mimosa 0 findings seal
  sha256:1941ab4e…）；五端矩阵 84/97/84/84/84。
  更早：**R154 Repeat onMove 派发 + Swiper indicator 三态 + 弹簧曲线槽位**
  （多智能体 A/B/C）——A=Repeat onMove 两参裸 number 协议（RepeatMoveEvent 类型
  不存在，C 调研 grep 零命中纠偏；拖拽落定单发/取消同发/from==to 不派发；数据源
  责任=开发者 splice——权威七步注释 pu_repeat_virtual_scroll_2_impl.ts:71-83；
  List/Grid 父容器激活）+ __arkui_dom_repeatMove 驱动钩子四步（视觉重排→splice→
  派发→R153 键 diff 收口）+ ① 组 15→23。B=Swiper indicator 三态（DotIndicator
  几何/配色全量/DigitIndicator 两段 Text/入参=链式 setter 配置对象——arkswiper.ts
  口径）+ 弹簧曲线槽位（builtin.js finishCurve——spring 走 R126 解算器初速=采样
  速度，css 串直通，未声明保持 ease-out）+ Swiper.curve 移出 UNSUPPORTED +
  builtindemo 29→48。C=onMove 协议 + indicator 全属性清单（两处纠偏任务书错误
  假设：RepeatMoveEvent 不存在、selectedWidth 实为 selectedItemWidth）。
  **集成实锤三修**：Android WebView 串行化 'none 0s ease 0s'（startsWith 比较）+
  builtinSampleVelocity **dt 下限 8ms**（合成同拍 dispatch v0 达 10 万 px/s、弹簧
  飞出数万 px 不收敛——真机指针事件按帧合并无此形态，运行时健壮性修复全端受益）+
  builtindemo 虚拟预算 VTBUDGET=12000 per-case 机制（弹簧收口等待 1200ms 使全页
  虚拟耗时超默认 8000）。验收：`bash run.sh batchfunc`（46 条断言，五端通过）、
  builtindemo 48 条五端通过；门禁 11 步全绿（5d0febb，Mimosa 0 findings seal
  sha256:80a4cf63…）；五端矩阵 84/97/84/84/84。
  更早：**R153 Repeat 键 diff 深化 + Tabs 长尾第三片**（多智能体 A/B/C）——
  A=Repeat 三分支（暂存区摘入→按新序 append 回填，不做 LCS；键保留只 updateIndex
  未变跳重放/复用先 updateItem 再 updateIndex/否则新建；持久池 16；scratch 重放+
  逐位补丁=节点身份保持，与 ForEach 整体重建的可观测差异）+11 条断言；B=Tabs
  barGridAlign 栅格（档位/偶数/居中逐式对齐 ace_engine）/animationCurve 双默认
  （点击 cubic/拖拽 spring 内禀 270 不受 duration 控制）/pageFlipMode/cachedMaxCount
  （evicted 标记+display 淘汰）+20 条；C=pu_repeat_impl diff 伪代码级精读即时注入 A。
  **集成实锤存量假绿**：run.sh batchfunc 浏览器 dispatch 指向从未存在的
  test/batchfuncdemo.html（浏览器一直 0 条假绿、Electron 同名规则跑真页）——勘误
  指回 test/batchfunc.html；tabanim 声明 26→46 声明文法教训（"26 条；扩至 46 条"
  缺"条断言"文法守门解析不到）。门禁 11 步全绿（69844ca，Mimosa 0 findings seal
  sha256:0861771e…）。
  更早：**R152 Media 时钟贯通 + Tabs 长尾第二片**（多智能体 A/B/C）——A 翻案
  R35 陈旧账（「Electron 时钟未打通」=只验过放宽断言；垫片墙钟端无关），实修 seek
  移墙钟基点/completed 定格/垃圾冻结点/WAV RIFF 时长四缺口 + video.js onPrepared/
  onUpdate 事件桥；mediademo 8→19 条合并分端双端同绿。B=Tabs 动画族（onGestureSwipe
  拖拽逐帧/onAnimationStart·End/animationDuration 缺省 300 非 0——C 简报纠偏 API11+
  口径；事件序 sel→unsel→animStart→change）+ tabanim 26 条。C=Repeat 产物形态蓝图
  （构造式+指令式/RepeatItem 不解构/键 `${index}__`+WeakMap）+ Tabs 动画真机行为。
  **集成三修**：typecheck 尾巴、batchfunc 跨月 data-today 转负向（R94 同族）、
  mediademo 五端容差族（WebKitGTK GStreamer 探测延迟 playing 进入 0.16s/Android
  WebView 近空 WAV 瞬间播完 S:completed 先行+续播停冻结点——引擎能力差异两态合法）。
  门禁 11 步全绿（6f88f22，Mimosa 0 findings seal sha256:bb179f4f…）；五端
  83/96/83/83/83。
  更早：**R151 v2 语义三件 + Tabs 长尾第一片**（多智能体 A/B/C + 主会话集成）——
  A=v2.js（279→707 行）：@Reusable 复用池（ctor 键/LIFO/容量 100-200/出池 reset 链在
  finalizeConstruction 收尾）、@Computed 依赖收集+脏失效缓存（写命中立即重算+递归传播，
  ARCHITECTURE「不缓存」设计决定节重写）、@Monitor 点分路径（绑定期逐段注册+写路径
  重评估，items.0.name 形态）；B=main.js Tabs 区段：vertical 方向矩阵/barMode/bar 尺寸
  （不随轴交换）/barOverlap/回调族（click→sel→unsel→change 同索引去重）+ 顺修
  __tabsContentEl 从未赋值旧 bug；C=真机简报（puv2_globalreuse.ts/swiper_pattern.cpp
  等 file:line）即时注入 A/B 纠偏。主会话集成抓三件：typecheck 7 处 JSDoc 归零
  （含 purgeDetachedRecords var 化——v2.js 入池包装需重绑函数声明绑定）、batchfunc
  跨月 data-today 断言转负向（显示月钉死 2026-09 vs 动态今天，R94 同族）、electron
  负载型瞬态两例（模拟器常驻挤兑，减压复验即绿）。验收：v2sem 44 条/tablong 26 条
  五端通过；门禁 11 步全绿（61a947b，Mimosa 0 findings seal sha256:d7e48cc9…）；
  五端矩阵 82/95/82/82/82。
  更早：**R150 lazyvh 锚定漂移修复**（R149 记档缺口 closure）——设备逐项量测
  推翻"锚定失效"：窗口内锚定精确（0.2px），266.4 出在**估高分支落点**（仅前 8 项
  实测时 offsetOf 用估高 advance ~87.1/项 vs 实测 ~90.4，92 项累计 −266px；锚定
  只管窗口内测量位移，结构性管不到区间级估高差；桌面估高=真值故四端测不出）。
  修复=layout.js scrollToIndex 估高分支 flush 后目标已入窗则按真实 offsetTop
  二次对齐（桌面 delta≈0）；hiDpi 放宽断言恢复严格 ±2。Android 3 连过 22 条+
  桌面/Gecko/WebKit 全绿；门禁 11 步全绿（9d5db67，Mimosa 0 findings seal
  sha256:a29827bd…）。
  更早：**R149 Android 第五端入阵**（System WebView 移动 Blink）——zcode
  android-emulator 插件协同（MCP 本会话未投影→CLI 直驱；SDK 用户态装 /data/android-sdk，
  许可用户本人接受）。**链路三坑**：adb reverse（NAT 不可靠）/playwright connectOverCDP
  不支持 WebView→原始 CDP ws/Page.navigate 应答永不来→fire-and-forget+每次求值新连接。
  引擎差异两族：高 DPI 舍入（6 页容差化+scrollbar-width 移动分支无此属性）+ **真缺口**
  grid/waterflow 到底判定精确 >= 浮点 shortfall 漏发 onReachEnd→ceil 对齐 scroll.js。
  已知移动缺口记档：lazyvh scrollToIndex 高 DPI 估高漂移 266px（锚定待修，桌面判据不动）。
  验收 80/80+守门全对；门禁 10→11 步（6d android 条件步）；五端 80/94/80/80/80
  （a27f8dc，Mimosa 0 findings seal sha256:1b6b5a3e…）。realfs 在 Android 走 OPFS
  探测成功分支（System WebView 原生支持，20 条）——覆盖表两态皆合法。
  **R149.1 iOS 通路终局判定**：官方 ios-simulator 插件实测结构性不可行（MCP server
  包装 xcrun simctl/xcodebuild，preflight 判 darwin-only——Linux 实测输出
  `{"ok":false,"detail":"linux"}`；无远程模式；iOS 模拟器运行时 Apple 专有）。
  iOS WKWebView 门禁级验证只能等 macOS 环境（届时按第五端同款矩阵接入）；
  Linux 上 WebKitGTK 已是 WebKit 家族代理。闭案。
  更早：**R148 WebKit 第四端入阵**（R145 清单收官）——判定翻案：系统已有
  libwebkit2gtk-4.1/libgtk-3，缺的只有 3 个小库（用户 sudo 装）。`webkit/run.sh`
  （wk-venv python 定位、缺席显式跳过）+ `tools/wk-matrix.py`（playwright，
  #result 单通道——坑 115 纪律）+ 覆盖表。唯一引擎差异：errbounddemo ⑥ 前置
  `stack.indexOf('\n')>0` 烙 V8 假设（JSC 未抛 Error stack 单行）→ 断言引擎中立化，
  runtime 归一化两端都对。坑复刻自抓：run.sh "all" 当过滤子串传执行器（R144
  同型坑）在 webkit 侧又犯一次才修。验收 80/80 ALL PASS（计数与 Chromium 逐例
  一致）+ 守门 134 处全对（3 覆盖值）；门禁 9→10 步；四端 80/94/80/80（28a39fa，
  Mimosa 0 findings seal sha256:9cb679df…）。
  更早：**R147 batchinput/Motion 重构建入阵**——R145 清单最后一个开发性尾巴。
  两页 R66 产出但 main_pages 未登记→从未编译（batchinput 编译失败根因：四族组件
  不在 CLT 26 SDK，页头注释早预言但没人编译过）。登记→裁四族段→BUILD OK→fixture
  冻结（钩子拦 cp，Read/Write 合规）→测试页裁 12 条+格式归一（原页 `✅ ALL PASS`
  前缀 firefox 驱动不认）。**又抓真 runtime 缺口**：input.js Checkbox.create 丢弃
  group（batch-input.js 注释自曝"补一行即生效"没做）→ 组员带不动组状态 → 补落
  data-arkui-checkbox-group。验收 batchinputdemo 14 条 / motiondemo 23 条（一次过，
  非盲写页）三端 ALL PASS；三端矩阵 80/94/80；门禁 9 步全绿（6c1b94e，Mimosa
  0 findings seal sha256:03b00b0f…）。
  更早：**R146 孤儿页腐化修复**——batchlayout/navshimdemo 修完入三端矩阵
  （78/92/78）。诊断颠覆 R145 判定：live DOM 转储证明不是 runtime 腐化，是
  **R66 页面盲写从未运行**——①@State→DOM 异步重渲染断言却同步读（补 await tick）；
  ②style.flex 序列化是 '1 1 0%'；③bad=1 期望与冻结模块相反（runtime 恒拒非法值
  是对的）；④裸 global 改 globalThis。**navshimdemo 才是真 runtime bug**：
  playPageTransition 用 rAF 驱动逐帧回调（坑⑧家族 headless 不派发，PT 只落 0）
  → 改短定时器 16ms 步进（WAAPI 视觉层不动），全仓唯一消费方。验收
  batchlayout 24 条 / navshimdemo 13 条三端 ALL PASS；门禁 9 步全绿（7302fba，
  Mimosa 0 findings seal sha256:5098e247…）。**守门新陷阱：ROADMAP 表格行一行
  两个不同用例名各带「N 条断言」→ 无法归类红**（navshimdemo 声明挪 CAPABILITY
  导航垫片行）。
  更早：**R145 驱动完备性清账**——① electron all 补 5 例（a11ydemo/i18ndemo/
  rdbdemo/netadvdemo/leak，单跑实测计数与浏览器端逐一相同，双端声明固化为门禁
  全覆盖，84→89 例+netfile 两连）；② 孤儿页判定：batchmediademo 复活入矩阵
  （16 条双端 ALL PASS+守门声明），batchlayout（4 FAIL+global is not defined）/
  navshimdemo（1 FAIL）判腐化待修（**陷阱：无文档声明的页失败会被 assert-counts
  静默跳过——先修后进**），batchinput/Motion 判可实现未驱动（main_pages 未登记
  无 fixture）；③ firefox 驱动 title+#result 双通道早退（focusdemo 26.8s→3.8s）
  + 解析漂移哨兵（计划数 vs 独立行计数，首版 TSV 比对的新鲜度缺陷被单跑场景抓出）；
  ④ WebKit 评估记未来切片（无二进制，~120MB 下载+GTK 依赖）。门禁 9 步全绿
  （d39a2af，Mimosa 0 findings seal sha256:d6ca431b…）。
  更早：**R144 Firefox(Gecko) 跨引擎全矩阵入仓**——企业级标准检查问出
  "矩阵一直 Chromium-only"→ 3 页冒烟后正式化第三验证端：`firefox/run.sh`（geckodriver
  定位/缺席显式跳过）+ `tools/ff-plan.py`（解析 run.sh all 块=单一事实来源）+
  `tools/ff-matrix.py`（geckodriver 环回 HTTP 执行器）。选型实录：Fx 156 BiDi 无
  script.* → 经典 WebDriver；判定 = title 超时回退 #result（focusdemo 不设 title）。
  实测 75/75 ALL PASS 零真失败；唯一计数差 realfs 20/21 摆动 = OPFS 探测时序敏感
  分支（两端 backend 同 localStorage）→ assert-counts 增 `--overrides`（分端期望
  值表、值域集合、偏差仍红，firefox/assert-overrides.tsv 带理由）。门禁 8→9 步
  （6b firefox 条件步）；验收 75/75 + 守门 129 处全对（3 处覆盖值）；门禁 9 步全绿
  （9c60fcd，L2 复查修 ff-plan argv 路径 04a2b24，最终树 Mimosa 0 findings
  seal sha256:aee512f0…）。
  更早：**R143 更新通道文档化 + ROADMAP 行修复**——初版更新通道做在应用内
  （updater.js：清单+下载+sha256 原子 rename）——Mimosa 深扫抓 4 高危（SSRF 入口/
  URL 派生路径穿越）无法收敛为 0 findings，**按纪律改道：更新通道=部署侧 shell 四步**
  （清单 curl→版本比对→下载+sha256sum -c 对账→原子 mv→UPGRADE 升级四步解包），
  UPGRADE.md 全流程可复制命令；运行时包内零更新网络入口（静态审计面为零，深扫回归
  0 findings，最终树 seal sha256:bded64db…）；ROADMAP 行修复：R142 行被此前 seal 脚本引号错误粘尾（重建整行）、
  R135 行 hash 字面量修正；E0-4 挂钟窗口说明一并入档（R141 15000 轮 churn 密度高于
  8h 值守）。
  更早：**R142 E2-1 完成：尾部 sync 批级提升（增量走查收官）**——rerenderElmt 内
  的 4 个尾部 sync 提升到 flush() 批末：批内 N 个 dirty id 原本各跑 4 次登记扫描
  （3300 行批量=13200 次），批级一次语义等价（sync 作用于登记集全局终态）且降为 4 次；
  PERF 记账同步移至 flush；stress10k bulk_flush 16.4→15.4ms；stress1k/attrheavy/
  新六页回归全 PASS；门禁 8 步（7c52f67，Mimosa 0 findings seal sha256:c064f960…）。
  **E2-1 增量走查至此完成（R139 登记集驱动 + R142 批级提升）；优化器 v3 的
  updateFunc 级属性 diff 属独立立项（本轮明确不覆盖）**。
  更早：**R141 sys.* dark 表烘制 + WithTheme colorMode 联动 + 15000 轮扩窗 soak**
  （E0-4/E1-4 尾巴收口）——gen-sys-resources.mjs 增 dark 段解析→__arkui_dom_resources_dark
  （391 条；125829120 light #182431ff→dark #ffffffff 实证）；WithTheme colorMode 联动
  （DARK→sys 表切 dark【全局效应如实注释——真机 scope 换表走 C 层】；light 表引用定格修：
  复切时误捕 dark 引用的时序 bug）；i18ndemo +3 条→21 条双端全绿；**soak Run 2：15000 轮
  扩窗**（offscreen ~1.3ms/轮全程 <1 分钟，churn 密度高于 8h 值守）——heap 锯齿 9→25→12MB
  无单调增长、DOM/recs 恒定=无泄漏；soak-report.md Run 2 入档。门禁 8 步（eb47f9d，
  Mimosa 0 findings seal sha256:a7b28e23…）。更早：**R140 E1-6/E2-2 尾巴收口**——axe-core@4.10.2
  （MPL-2.0）vendor 进 test/vendor（NOTICES §3b.3 登记；仅测试侧加载）；a11ydemo 真审计：
  全页=记录面（8 类违规属演示控件/已知缺口）、**设计面 scoped critical=0**；真审计抓出
  映射修正：ARIA 1.2 group 不支持 aria-level——accessibilityGroup(true) 时已设 level
  迁移 data-*；Image 主图 alt 缺省空串；TextInput placeholder→aria-label；stats.mjs
  PERF10 采集行（万节点进 §6）。a11ydemo 12→**14 条**双端全绿；门禁 8 步（46ae630，
  Mimosa 0 findings seal sha256:32608072…）。**企业就绪度 P0/P1/P2 三档全清（R129-R139），
  R140 为尾巴收口**。更早：**R139 E2-1 增量走查**——
  incremental.js 分片（第 46 个）：四张登记表（area/draw/align/nav）+ incSweep 惰性
  清扫（es2020 lib 无 WeakRef——Set 强引用+isConnected 清扫，不升 lib 避免连带风险；
  稳态收敛不无界增长）；登记点 8 处（area/draw/show/nav 分片能力挂上处）；**4 个
  flush 尾部 sync 改登记集驱动**——只遍历登记元素不再 querySelectorAll('*') 全树；
  显式 rootEl 局部 sync 保留旧遍历；验收（Electron 对照 R138 基线）：stress10k
  bulk_poll **216.5→144.9ms（-33%）** bulk_flush 22→16.4ms（-25%）首渲同步
  143.5→129.7ms；全矩阵无回退；报告 docs/research/incremental-report.md；坑：
  @include 行尾注释破坏 build 正则（必须独占一行）。门禁 8 步全绿（141feee，
  Mimosa 0 findings seal sha256:bcd4516f…）。**企业就绪度 P0/P1/P2 三档全清**
  （达成记录已写入 ENTERPRISE-READINESS.md——按定义达"可签 SLA 的产品化交付"档）。
  更早：**R138 E1-7 尾巴 + E2-2 万节点压测基线（双代理并行）**——**E1-7 尾巴**：
  docs/UPGRADE.md（第六+1 文档）：分发形态表/升级策略核心节（全量替换+userData 不动
  【R74 口径修正：简报误记 R75】+升级四步+检查清单+回滚【无 schema 迁移机制如实声明】）/
  资源版本对应硬契约/日志诊断汇总/已知限制（无自动更新通道）；**E2-2 万节点基线**：
  Stress10kDemo（3300 行×3 组件≈9905 节点+单点动态）+ stress10k.html（PERF10 行；
  批量轮询放宽 2000 tick）；**基线实测（Electron）：首渲同步 143.5ms / bulk_poll 216.5ms /
  bulk_flush 22ms——万节点远优于千节点预算线性外推**，E2-1 增量走查对照基线就位。
  stress10k 5 条 Electron ALL PASS；门禁 8 步（581d49d，Mimosa 0 findings
  seal sha256:9331c193…）。**P1 功能面 7 项全清**；P2 余 E2-1 增量走查。
  更早：**R137 E1-2 SQLite + E1-5 多窗口（双代理并行）**——**E1-2**（relationalstore.js
  第 45 分片）：sql.js@1.8.0 WASM 选型（双端同构优先于原生 ABI）；RdbStore 全家对 d.ts
  行号；持久化=export→b64→file.fs 真后端（重启重建实测）；修复 file.fs writeSync 数字
  fd 契约 bug（验证台替身建模暴露）；rdbdemo 34/12 分形态双端全绿；**E1-5 多窗口**：
  win2 IPC 族+window.multi 垫片（无桥 code=801）；multiwindemo 15 条 Electron 专属
  （焦点断言依赖 X11 真焦点环）；**新坑：仓库根 type:module 使 vendor 的 UMD 文件被当
  ESM——module.exports 导出块静默失效（keys=0 无报错）**，vendor/sqljs 放局部
  package.json commonjs 修复；WASM 取自 npm registry 1.8.0 原件。门禁 8 步全绿
  （bb5273c，Mimosa 0 findings seal sha256:4a7fb214…）。**P1 进度 5/7**（余 E1-3 尾巴
  =无、E1-6 已完、余 E1-2 已完——实际余：E1-6 完成、升级策略文档（E1-7 尾巴））。
  更早：**R136 E1-6 无障碍 ARIA 映射**——a11y.js 分片（第 44 个）：A11Y_ROLES
  静态映射表（20 组件→button/textbox/img/switch/slider/progressbar/meter/menu/combobox/
  listitem/list/tabpanel）+ mountNode 挂载落点（一次性落 role；显式 role 优先幂等守卫）
  + accessibility* 四件真落 ARIA（Text→aria-label/Description→aria-description 双写/
  Level 数值落 auto 不落/Group(true)→role=group——area.js 拦截在通用兜底前，坑 86 同族；
  此前经通用兜底落 data-* AT 读不到）；axe-core 接入列后续（vendor 400KB+）；
  a11ydemo 12 条双端全绿；测试页坑（R135 同族）：VSP.restore 后 parentOfTop 为 null——
  seed 容器直挂模式；门禁 8 步（b54f35c，Mimosa 0 findings seal sha256:c4581186…）。
  **P1 进度 4/7**（余 E1-2 SQLite/E1-5 多窗口/E1-7 尾巴=升级策略文档）。
  更早：**R135 E1-3 i18n 系统化**——i18n.js 分片（第 43 个）：System 面+isRTL+
  Calendar（月 1-based 口径）+NumberFormat（Intl locale 敏感）+Util.unitConvert（线性
  长度+温度）；**setResourceLocale**（qualifier 目录 zh_CN/en_US 拉取合并进 app.values+
  base 值快照复原——覆盖污染须回快照）；ohos-shims i18n 旧名转发；RTL 贯通（WithEnv
  DIRECTION→dir 复验+isRTL 同源）；i18ndemo 18 条双端全绿；测试页坑：VSP.restore 后
  parentOfTop 为 null——seed 容器直挂模式；门禁 8 步（c5eb871，Mimosa 0 findings
  seal sha256:e303943c…）。P1 进度 3/7（余 E1-2 SQLite/E1-5 多窗口/E1-6 无障碍）。
  更早：**R134 E1-7 打包态资源（R128 留白收口）**——packager 拷 harmony-proj
  resources/base 随包 + runtime resBase() 探测（URL 含 /test/ → '../'，http/file 双态
  同构；resolver media 分支与字节预热共用）；**打包 resourcedemo 冒烟 9 条 PASS**
  （string/color/float 真值+媒体字节 460B 预热实测 file:// 下可用）；门禁 8 步
  （a901748，Mimosa 0 findings seal sha256:2c01867d…）。升级策略文档化待补（E1-7 尾巴）。
  更早：**R133 E1-1 网络栈强化（P1 功能面第一项）**——net.http 垫片：retry
  {maxRetry,backoffMs}（本项目扩展形状如实注释；5xx/网络层失败重试、200 零重发、耗尽报
  2300007）+ 整体超时覆盖重试窗口（AbortController 终局异常留痕+上抛——async.html 旧
  断言回归保护）+ usingProxy/usingCache/maxLimit 记录面（真机系统代理走 C 层语义不在 DOM
  侧）；serve.py 加 /flaky?fail=N（按 query 隔离计数——页内复用同 query 串污染下一跑的
  陷阱二跑抓）//delay?ms=N/DELETE 端点；netadvdemo 7 条双端全绿；门禁 8 步（8ae9f3c，
  Mimosa 0 findings seal sha256:7d53085b…）。更早：**R132 E0-4 长跑稳态（P0 可信度底线六项全清）**——tools/soak.sh（非门禁）：
  Electron offscreen + ARKUI_SOAK_ROUNDS 驱动 errbounddemo 的 `__arkui_soak_step` churn
  钩子，采样 heapUsed/DOM/elmtRecords 三指标 CSV；**150 轮验收：heap r25=8MB→r150=9MB
  （GC 稳态水位）+DOM/记录账零积累=无泄漏趋势**；报告 docs/research/soak-report.md（边界：
  重组件长跑/8h 窗口未覆盖，扩窗只改轮数一处）；**过程坑三个全修**：① sampler 注册在
  第一个 whenReady 闭包外 win 不可达（ReferenceError 被 catch 吞 CSV 只剩表头）；② 判定后
  app.exit 抢在采样前（soak 模式退出权让渡给 sampler）；③ 页面钩子闭包引用页内局部 G。
  门禁 8 步全绿（462d3b3，Mimosa 0 findings seal sha256:47c27665…）。
  更早：**R131 P0 批次二（E0-2/E0-6 双代理并行，都动 electron/main.js——git 基线+diff 合并）**——
  **E0-2 崩溃上报**：appendCrashLog → userData/logs/crash-YYYYMMDD.jsonl（按日分文件+每分钟
  每类 20 条节流）；process 兜底钩子（记录后不退出——fail-fast 语义变化已注释）+render-gone
  扩接+arkui:report:error IPC+preload reportError 桥；渲染侧接线=errbounddemo 缓冲尾部
  →reportError（**22/23 分端断言**——浏览器无 electronAPI 自然跳过）；**E0-6 启动可诊断**：
  did-fail-load→data:URL 诊断页（五字段）+[boot-fail] 摘要；空壳探针仅生产形态（测试模式
  零注入）；catch 配套诊断页截图留存（退出码 3 不变）；已知限制：404 页属加载成功不走诊断页。
  验收：JSONL 五键行落盘实测+断链启动 [boot-fail] code=-312 摘要+诊断页截图。**P0 仅余
  E0-4 长跑稳态**。门禁 8 步全绿（76441a6，Mimosa 0 findings seal sha256:7730ae76…）。
  更早：**R130 企业就绪度 P0 批次（R66 a+c 多智能体并行复刻：5 代理+主会话集成）**——
  **E0-1 错误边界**（errorboundary.js：__arkui_dom_errors 环形缓冲+ErrorBoundary 最小面；
  flush 逐 elmtId try/catch+applyAttr 包裹；errbounddemo 22 双端）→ **E0-3 焦点管理**
  （focus.js：Tab 链正值组语义+requestFocus 受理序号 token 防 rAF 迟到覆盖+焦点环；
  focusdemo 25 双端）→ **E1-4 sys 资源表**（gen-sys-resources.mjs：resources.txt 反查
  7477 条 base 优先/#AARRGGBB→RRGGBBAA 重排；直填 __arkui_dom_resources 零改动；
  sysresdemo 13 双端）→ **E0-5 供应链+CSP**（check-all 第 8 步 supply；CSP 注入——
  **新坑：script-src 缺 unsafe-inline 时 47 个内联脚本测试页整页静默死，#result 停
  running 且无 console 报错，CSP 违规只在 DevTools 可见**）→ **E2-3 差异清单**
  （DEVICE-DIFF.md 46 条）。三页 60 条新增双端全绿；门禁 8 步（supply 无 lock 显式跳过）。
  ENTERPRISE-READINESS 勾账 5 项。P0 余 E0-2/E0-4/E0-6。
  更早：**R129 企业就绪度差距账（规划，零代码）**——`docs/ENTERPRISE-READINESS.md`
  （第六文档位）：**16 工作流原子分解**，P0 可信度底线 6 项（E0-1 错误边界/E0-2 崩溃
  上报/E0-3 焦点管理/E0-4 长跑稳态/E0-5 供应链 CSP/E0-6 启动可诊断）→ P1 功能面 7 项
  （网络/SQLite/i18n/sys.* 资源/多窗口/无障碍/打包态资源）→ P2 规模化 3 项（增量走查/
  万节点压测/真机差异清单）；每任务带可执行验收与依赖；**完成定义**：P0+P1 主干=可承接
  内部工具交付，+P1 全部+P2=可签 SLA。下一片默认 E0-1 错误边界。更早：**R128 $r 真实资源解析**——**产物形态实测**：ets-loader 把 $r('app.*') **预展开**
  成带 app-id 的 Resource 字面量（ids_map：10001=color/10002=float/10003=string/20000=media）；
  **生成器** gen-app-resources.mjs（源=harmony-proj 资源+ids_map → generated-app-resources.js
  第 42 分片，--check 防漂移）；resolveResource 扩展（string/color/float 裸数字/media 路径串）
  ——Text/fontSize/fontColor/Image 全走此路；**双端零 IPC**（electron 也走 http 同源，fetch
  一态两用）；resourceManager 真实现（getString/getColor 0xAARRGGBB/getMedia Uint8Array+
  媒体字节预热 __arkui_res_ready）；d.ts 勘误：无 getNumberByNameSync、getMediaByNameSync
  返回 Uint8Array；未知资源兜底=名字进名字出+警告。resourcedemo 9 条双端全绿；index 旧兜底
  断言更新（50fp=50px）；门禁 7 步（ca7c16c，Mimosa 0 findings seal sha256:7f5b0992…）。
  留白：sys.* 资源表烘制（resources.txt id→值，R123 反查法可批量生成）；打包态资源目录拷贝。
  更早：**R127 hs/GHC 内核打包态（内核线收官：五语言全部可分发）**——data/kernel/hs/
  平铺 GHC 闭包（NEEDED 传递闭包 10 包+thr RTS+libffi，ldd 递归收集）+ **逐个 patchelf
  $ORIGIN**（DT_RUNPATH 不继承；ldconfig 不认识 GHC→packager 内置零依赖静态证）；
  ARKUI_KERNEL_KIND=hs 切内核（cjkEnsure 双分支）；**坑 110：GHC 必须载 _thr- 变体 RTS**
  （非线程下 setNumCapabilities 静默死，dev 态 readdir 碰对/打包即露馅；addon 扫描 thr 优先）；
  **坑 111：K 变体槽名错位**（cangjie→"default"/hs→"hs"，handler 全走 cjkXxxK(slot)——
  init 槽与 handler 槽不一致=全调用「内核未初始化」）；hs 内核补 upper+缺参文案对齐仓颉
  （cjk.html 38 断言双内核共用）；addon 编译配方补录。验收：dev electron 双内核各 38
  ALL PASS、打包冒烟双份 PASS（hs 零 LD_LIBRARY_PATH）、五内核 smoke 106、门禁 7 步
  （3e2268a，Mimosa 0 findings seal sha256:77f0048a…）。更早：**R126 真机确证扫尾（挂账两枚清零）**——**overDrag 回弹**：欠阻尼弹簧
  （scrollable.cpp:27-29 mass1/k228/c30 → 恒 UNDER_DAMPED；解析解逐式照抄
  spring_model.cpp:150-174）→ builtinSpringRebound（定时器解算/0.5px 精度收口）；
  Swiper/Tabs 回弹换弹簧（commit 仍 duration 契约，**两路互斥**——并存会被 duration 兜底
  提前收口）、Scroll/List 惯性到边→越界冲激回弹（impulse start=end→c2=v0/w，内容 translate
  呈现越界）；**SLIDE 结案**：JSDoc 原文=asymmetric(appear:move(START), disappear:move(END))
  LTR 左入右出——NG 效果链确无此枚举、纯 d.ts 层糖（R43/R48 悬案定谳）；**勘错**：
  TransitionEdge 原名 TOP/BOTTOM/START/END（此前 Left/Right 名字错数值对，幸无引用）。
  transitiondemo 58→60、builtindemo 26→29 双端全绿；门禁 7 步（d404087，Mimosa 0 findings
  seal sha256:1d1e3a77…）。**真机确证候选清单至此清零**。更早：**R125 组件内置手势**——新分片 builtin.js（第 41 个）：Swiper 拖拽翻页
  （拖拽舞台 absolute+transform 跟手、邻页前方；半页阈值 swiperProportion_=2.0/速度
  780vp/s/边界摩擦 swiper_helper.cpp:566-578 原文/400ms——参数逐个对真机源码）+ Tabs
  内容区滑动（scrollable 默认 true）+ List/Scroll 拖拽滚动+惯性（**惯性短定时器不用
  rAF——headless 节流，坑⑧同族**；Scroll.fling 升级真惯性）；Swiper 六件真语义
  （vertical/disableSwipe/duration/onAnimationStart 三参/End/GestureSwipe——on* 拦在
  通用事件分支前，坑 86 同族）；**坑 109：@State 不能包 SwiperController**；四件套
  BuiltinDemo + test/builtindemo.html（可编程时钟劫持 performance.now 测速度翻页）
  26 条双端全绿，门禁 7 步（1d564be，Mimosa 0 findings seal sha256:de650eca…）。
  留白：overDrag 边界回弹 spring 曲线（确证扫尾候选）。更早：**R124 主题真值清账第二轮**——nav.js 三处「推断」升原文（56/112/138 资源键
  双证；**R42「137 之谜」结案**：资源真有 title_emphasize_twolines_height=137
  （125831117），但 Navigation Full 双行走 full_* 家族 138——两族键并存，当年"未使用
  常量险些误改"判断正确）；Badge 数值徽章 padding 0 4px→0 6px（numerical_badge_padding
  125834809）+ showdemo +1 断言（28→29，README/ROADMAP/CAPABILITY 三处计数同步）；
  fontSize 10/badgeSize 16/color White 经查全是 JSDoc 原文（R28 已对）；五组件主题值
  存档（Marquee 37.5px/Counter/Stepper 48vp/Toggle 28vp/Slider 360vp——消费点证据不足
  或原生控件不适用者不应用只存档）；全量「推断」grep 复盘 12 处：主题数值类清账完毕，
  余 2 处语义推断属行为边界。showdemo 29 + batchverify 124 双端全绿；门禁 7 步
  （f7f24b8，Mimosa 0 findings seal sha256:be3a73a6…）。更早：**R123 Piece theme 原文对齐（R122 推断值清算）**——**方法论解锁：SDK 系统资源
  主题真值可反查**：`previewer/common/resources/entry/resources.txt`（restool 反查文本，
  含全部 theme pattern 的 id→值 + light/dark 块；sysResource.js 只有 ID 映射，真值在此）。
  piece_pattern（id:125829904）五键 + 标量 id:125830637-125830643 → height 28vp/
  text_lines 1/font_weight 4/paddingH 8vp/paddingV 0/iconSize 16vp/interval 4vp、
  文字 #182431、bg 前景色×α0.05（corner_radius_piece=14vp=高/2 印证）——**R122 推断
  6 中 3 错**（padding 12/4→8/0、interval 6→4、文字色）→ runtime 已按原文修正；
  hover 补齐（bg_color_hovered=前景 α0.047→:hover 注入）；扩面盘点：FolderStack/
  GridContainer/XCN/ContainerReader/UIPicker 均有 demo 页行为覆盖无真空。batchverify
  120→**124 双端全绿**；**同法可清其余组件的推断值**（badge/calendar/…_pattern 全在
  resources.txt）。门禁 7 步全绿（ee34d05，Mimosa 0 findings seal sha256:59f7f97c…）。
  更早：**R122 Piece 落地——可实现组件全部清零（里程碑）**——操作块标签（收件人
  语义）：胶囊 div（圆角=主题高/2）+ 文本 span + 图标 img；**图标即删除按钮**
  （showDelete 控 GONE、点击图标→onClose，文本点击不触发）；iconPosition 默认 End +
  interval padding 朝文本一侧；showDelete 三型容错（bool/0|1 number/其余 false）；
  font 五件落**内层 span**（area.js 表拦截通用 cssProp）；空 content 整行不建
  （BuildChild nullptr）；默认图标 = SDK previewer ohos_piece_delete.svg 原文内嵌；
  主题数值 pattern JSON 不在源码树→全部标推断；产物可达性证明 = ets-loader
  components/piece.json。batchverify 103→**120 条双端全绿**（Piece 16+结构行 1）；
  **HANDWRITTEN 补账 4 名**（ContentSlot/WithEnv/ArcList R118.2/R121 漏登记 + Piece）
  → **手写 129 + 骨架 20[platform-only 19+not-found 1] = 149 清账，可实现未实现=0**。
  调试坑：属性须在 create→pop 之间调（applyAttr 打栈顶）。门禁 7 步全绿
  （c8ea25f，Mimosa 0 findings seal sha256:5782dbeb…）。更早：**R121 ArcList 落地（partial → 真语义）**——batch-platform 新增 ArcList：
  真机三次多项式缩放**逐常量照抄**（arc_list_layout_algorithm.cpp A-E + 钳位 348.5，
  中心 1.08/滚到底 0.4823 实测吻合）+ ScrollAlign::CENTER 静默吸附（80ms，scroll.js 先例）
  + 回调族 + header builder 展开（__arcHeader 不参与缩放）；缺口如实记录（表冠/ARC
  滚动条/链式弹簧→layoutWarnings）；调试坑：子项 transition 污染 computed style→
  transition:none、reachStart 断言须安置在回顶端点；batchverify 95→**103 条双端全绿**
  （ArcList 段 8）；**Arc 系配对齐**（ArcListItem 已真语义）。门禁 7 步全绿
  （2c5b241，Mimosa 0 findings seal sha256:6375e3eb…）。更早：**R120 剩余骨架批量判定（11 枚）**——三源核验收口 149 组件终态账
  （145 已决：手写 125+platform-only 19+not-found 1；可实现未实现仅 6 枚：Piece
  feasible + ContentSlot/WithEnv/ArcList partial + R48 遗留 partial），产出
  docs/research/R120-component-verdicts.md。更早：**R119 五内核统一契约套件**（kernel/contract_common.c 一份 41 条断言
  参数化三挂载模式跑五内核——五语言契约等价性从"断言相似"升级为"同一套测试证明"，
  全绿；run-contract.sh 编排）。更早：**R118 纯 C 内核补全**（agent 五件+pthread 作业面——五语言作业面同构；
  **坑 108：RTLD_GLOBAL 多内核同名符号 PLT 劫持**（C 的 shutdown 自引用 init 跳进
  仓颉）→ static 本地绑定；smoke 106 三连绿）。更早：**R117 Rust 内核（第五语言）**——kernel/rust cdylib（仅 libgcc_s+libc、
  零宿主序、零外部 crate；单全局锁+per-Job 锁序无环证明）；claurst 对齐
  （AgentDefinition model/maxTurns、agent.info、Generation CAS 终态不回流）；
  smoke 98（rs 段 20）；**五语言齐：仓颉/纯C/Haskell/Go/Rust**。
  更早：**R116 Go 内核（第四语言）**——kernel/go cgo+c-shared（仅 libc 依赖、
  零宿主序、标准库 JSON、goroutine 作业）；Reasonix 对齐 session.get/set Generation
  CAS + lifecycle 三态；smoke 77（go 段 20 断言）；**四语言齐：仓颉/纯C/Haskell/Go**。
  更早：**R115 Haskell 内核工业级验证**（作业面 forkIO 零驱动+协作 CAS 取消+
  快照跨语言互通+错误矩阵；hs 契约 37→72 ALL PASS、smoke→59、node 层并行重叠 6/6；
  **坑 107：writeIORef 惰性 thunk 时间戳（evaluate 强制）+ setNumCapabilities 在 C 原生
  宿主无效（atInit=1）vs node=8——并行断言安置 addon 层，C 层条件 SKIP 如实**）。
  更早：**R114 Haskell/GHC 内核（第三语言）+ 多 RTS 泛化**——`kernel/hs/kernel.hs`
  按参考 trha 数据面（Agent{state, inbox}+五态 FSM transition 逐条对 StateMachine.hs）；
  addon ensureRuntime 双布局（文件=仓颉/目录=GHC 扫描，双标志幂等）；**坑 106：GHC
  RTS↔ghc-internal 循环引用（stg 数据符号→RTS 必须 LAZY 先行）+ unsafePerformIO
  CSE 共享态（可变分配必须在 IO 里）**；hs 契约 37 条、smoke 三内核同进程全通、
  门禁 7 步全绿。**已实证语言：仓颉（生产）/纯 C（样例）/Haskell（trha 数据面）**；
  剩余候选：hs 打包（98 .so 搬运+$ORIGIN，dev级暂缓）、Rust/Go stub、trha 本体
  （用户裁定划出本线）— **PASS**
- 更早：**R67**（R66 批量组件验收：37 结构 + 兜底绊网 + 14 真编译语义；绊网
  `__arkui_dom_generatedFilled`——手写注册缺席时骨架静默兜底，坑 98）；**R24 收口**（渲染
  路径决策 3f6e209：previewer 实证点火崩在窗口层、es2abc 无 JS 输出——留在分支 B）；
  **定位声明 5ba8874**（ArkTS 桌面应用引擎，Electron 主目标）
- 更早：**R49**（ListItemGroup 分组容器上线：header→items→footer 子序、space 只作用
  item 间、spaceWidth 压过 space、divider ::before 槽、List.sticky 组头吸顶）— **PASS**
  （listitemgroup 19 条双端；破坏 5/3/1 红；手写 48）
- 上一轮：**R48**（多代理验证轮：28 个只读调研代理并行完成 23 个平台组件批量判定
  [platform-only 14/partial 3/feasible 4/not-found 2] + 5 个高价值组件实现级摘要；产物入库
  `docs/research/`；CAPABILITY 增"平台特定组件批量判定"章节——清单 23 项一次性处置完毕）
  — **PASS**（纯只读调研，无实现改动）
- 上一轮：**R47**（ImageAnimator 帧动画上线，新分片 animator.js 第 19 个：逐帧 setTimeout
  引擎 + AnimationStatus 状态机 [Running 推进/Paused 停表保持/Stopped 回首帧/播完落 Stopped]；
  回调延时派发 + images 深 diff——state 先于 onStart 应用、images 字面量重渲染重建，同步发/直接
  重置都会坏）— **PASS**（animatordemo 13 条双端；破坏 0/6/2 红——0 红一条无观察面如实记录；
  手写 47）
- 上一轮：**R46**（Scroll 滚动容器真 overflow 基座上线，新分片 scroll.js 第 18 个 + Scroller
  扩面：scrollTo 官方形参 {xOffset,yOffset,animation}/scrollBy/scrollEdge/scrollPage/isAtEnd、
  currentOffset 返回 {xOffset,yOffset}；onScrollEdge 到达沿触发；onScrollEnd 80ms 静默收口
  [DOM 化近似]）— **PASS**（scrolldemo 16 条双端；破坏 1/1/1 红；手写 46）
- 上一轮：**R45**（Image 组件真 <img> 基座上线，新分片 image.js 第 17 个：objectFit 五枚举→CSS object-fit、alt 占位惰性创建、onComplete 载荷带真实解码尺寸）— **PASS**（imagedemo 15 条双端；手写 45）
- 上一轮：**R44**（已确证组件语义回归扫描：重读真机源码找边界行为——扫出两处分歧已修
  [Marquee step≤0 不除、QRCode 过小拒绝绘制] + onTitleModeChange 端点转确证；新增
  `__arkui_dom_syncDrawings` 钩子；qrdemo 15 / showdemo 28 双端；破坏 1 红/3 红）
- 上一轮：**R43**（语义确证第三轮，两处实现修正：滚动联动副标题透明度 = (H−56)/(max−56)、
  主标题字号插值 L=30fp↔M=26fp 经 SHARP；SLIDE_SWITCH scale 0.8→0.85 照
  `rosen_transition_effect.cpp`）— **PASS**（navtransdemo + transitiondemo 双端；破坏 1/1/1 红）
- 上一轮：**R42**（语义确证第二轮，无实现改动：标题栏高度 56/112/138 确证——注意
  `navigation_declaration.h` 的 137 是未使用常量，险些误改；生命周期"先 will 后实"部分确证）
- 上一轮：**R41**（QRCode 编码器换成真机源码：OHOS arkui_qrcodegen 的 C++ 源码逐字复制
  → emscripten 编独立 WASM 单文件加载器，替换 node-qrcode vendor）— **PASS**
  （qrdemo 12 + widgets 双端；破坏 1 红（ECC 换 HIGH 采样 55/100）；jsQR 交叉验证保留）
- 上一轮：**R40**（语义清账三连：Navigation 转场 450ms 弹簧 + ±50%/20% 视差、Marquee
  时长公式 距离×85/step、QRCode ECC 确证 M）— navtransdemo 52 / showdemo 27 双端
- **真机源码参考库**：`/data/work/compiler/Ark`（OHOS 全树）。组件语义权威 =
  `arkui_ace_engine/frameworks/core/components_ng/pattern/<组件>/`。后续逐组件对照可清一批
  "推断"标注（Navigation 转场时长/曲线、Marquee 时长公式等）。
- 下一步（README「下一步」原文）：
  1. 其余骨架组件的视觉语义——**按家族推进**；已收：形状族 8 + 输入类 7 + 信息展示类 5 +
     弹出类 3 + 表层类 2 + 小件 4 + 分步器 2 + UIContext + @ohos.media（R35）；
     剩余候选以 `node tools/stats.mjs` 的"骨架·仅 data-*"清单为准
  2. ~~继续拆 `main.js`~~ **已拆到位**（15 分片）；机制随时可用

## 项目目标

让 ets-loader 的转换产物在浏览器/Electron 的 DOM 上跑起来。每轮切片的节奏：**先测量**
（新建 `.ets` 页面 → 官方构建 → 读产物，抄 `.d.ts` JSDoc 原文；SDK 在
`/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools/sdk/default/openharmony/ets/component/`）
→ 实现 → 双端断言 → **破坏验证**（人为破坏实现，确认断言真的会红）→ 五文档同步。
语义没数字依据的一律标**推断**。

## 验证门（确切命令）

```
npm run check                 # 6 步：preflight / gen-components --check / build-runtime --check /
                              #       stats --check-doc / browser(run.sh all) / electron(run.sh all)
bash run.sh <用例>            # 单用例·浏览器
bash electron/run.sh <用例>   # 单用例·Electron
```

- 成败**只看退出码**，绝不 grep 日志行（`tools/check-all.sh` 设计约定 1；已发生过 4 次假通过）
- 断言数守门：运行期落盘 TSV 与文档声明比对（`tools/assert-counts.mjs`，DEVELOPING 坑 77）
- 各步日志：`build/check-logs/`

## 当前切片

- 当前切片：**无未收口切片**（拆分第三步完成）；规格入口：`docs/ROADMAP.md`「R5c」第三步记录 +
  `README.md`「下一步」+ `runtime/src/` 文件树
- Lanes：单人顺序开发，无 lane 分片
- Gates（全套 `npm run check` 于每轮收口提交前执行；最近一次 = 拆分第三步）：

| Gate | 命令 | 阈值 | 原始结果 | 裁决 |
|------|------|------|---------|------|
| 环境 preflight | `node tools/preflight.mjs` | exit 0 | build/check-logs/ | PASS |
| 生成物一致 | `gen-components --check` | exit 0 | build/check-logs/ | PASS |
| 运行时拼接一致 | `build-runtime --check` | exit 0 | 9 个分片 | PASS |
| 文档断言数守门 | `stats --check-doc` | exit 0 | build/check-logs/ | PASS |
| 浏览器全量 | `bash run.sh all` | exit 0 | 33 用例 | PASS |
| Electron 全量 | `bash electron/run.sh all` | exit 0 | 32 用例 | PASS |

拆分第三步的硬判据单独记录：**重建产物 md5 = `e861eb81d1af46dac33d97fdfe1ab5df`（与拆分前一致）**。

## 开放分歧

| # | 立场 | 证据（真实文件） | 裁决 |
|---|------|-----------------|------|
| （无） | | | |

### 待办小修（非分歧，随时可做）

- ~~ROADMAP 452 行 R13 重复标题~~（R25 提交时已划掉并加指针）
- ~~`.mimosa/` 未跟踪目录~~（R25 提交时已进 `.gitignore`）
- （当前无）

## 决策日志

| 日期 | 决策 | 原因 |
|------|------|------|
| 2026-09-21 | 收口/新功能一律**新建页面**（如 NavBarDemo/NavTransDemo），不在老页面 `.ets` 上扩展 | NavDemo/Rich/Widgets 等老页面只剩官方构建的冻结产物，源不在 git；当前仅 9+1 个页面 + 3 个 ability 的 `.ets` 被跟踪 |
| 2026-09-21 | 建立 `.reasonix/handoff.md` 作为仓库记忆入口 | handoff-memory 技能；五文档仍是细节权威，本文件只做索引 |
| 2026-09-21 | Nav 转场的时长/曲线与联动阈值/缩放比记为**推断** | `.d.ts` 只说"有系统默认转场"，没给任何数字；本项目规矩：没依据的数字必须标注 |

## 会话日志

| 日期 | 切片 | Commits | Gates | 备注 |
|------|------|---------|-------|------|
| 2026-09-21 | R12 收口 | 4571f8f | 6/6 PASS（复跑核验） | 新增坑 85（builder 产物不保证直接子节点）；navdemo 旧契约升级为正向断言 |
| 2026-09-21 | R25 收口 | 290119c | 6/6 PASS | navtransdemo 48 条双端；破坏 13/6/5 红；navdemo 旧契约升级（转场默认开 → 断言前等 settle，74 条恢复）；新增坑 86（on* 分发陷阱）/87（@State 渲染滞后）；ROADMAP R13 重复标题已修；`.mimosa/` 进 .gitignore |
| 2026-09-21 | 拆分第三步 | 1a8c99d | 产物 md5 同拆分前 + 双端全量 PASS | main.js 4248→1869 行，3→9 分片（nav/layout/draw/area/v2/ability）；分节间空行留在 main（坑 84）；LazyForEach 在具体组件内部，切了劈半，不拆 |
| 2026-09-21 | R26 形状族 | 1eb9b53 | 双端 36 条 PASS + 破坏 19/1/4 红 | fixture 空转自纠（正方形 Circle min=max，改 80×60）；Line 起终点是属性方法不是 create 参数（编译期抓到）；新分片 shape.js（第 10 个） |
| 2026-09-21 | R27 输入类 | 98f2d2f | 双端 27 条 PASS + 破坏 3/2/2 红 | RadioOptions 无 name / Toggle 用 isOn（编译期抓到）；坑 88（事件重复注册改覆盖语义）+ target 校验防错投 + Radio 组内补发 onChange(false)；新分片 input.js（第 11 个） |
| 2026-09-21 | R28 信息展示类 | ecec6f3 | 双端 26 条 PASS + 破坏 8/1/1 红 | Badge count/value 双重载 + style 必填在 create（编译期抓到）；Marquee 定时器收口（headless 动画事件被节流）；坑 89（轮询上限吃虚拟时间预算）；新分片 show.js（第 12 个） |
| 2026-09-21 | R29 弹出类 | f22a161 | 双端 16 条 PASS + 破坏 7/3/5 红 | Select.create 单参数（selected 是属性方法）；onSelect 双参 (index, value)；MenuItem 多选语义；value() 记 data-value-text（原生 select 不可覆盖，取舍记录）；新分片 popup.js（第 13 个） |
| 2026-09-21 | R30 UIContext | 1f07f77 | 双端 8 条 PASS + 破坏 4/1 红 | getRouter 返回经典 Router 面（pushUrl，编译期实测）；animateTo 委派显式动画管道（history.api 断言把"真动画"与"裸赋值"区分开）；无新分片（本体 8 行） |
| 2026-09-21 | R31 Canvas | 497fa17 | 双端 10 条 PASS（一次通过）+ 破坏 2/1/1 红 | 原生 <canvas> 转发 + onReady 尺寸同步；像素断言天然有牙齿；fixture 的 toDataURL 断言边界太松（0 红）当场收紧；新分片 canvas.js（第 14 个） |
| 2026-09-21 | R32 XComponent | 8763aa9 | 双端 7 条 PASS（一次通过）+ 破坏 1/1/1 红 | surface 如实降级为占位容器；create 二参 bundle 串实测；接在表层类分片（无新文件） |
| 2026-09-21 | R33 QRCode | 7d1271a | 双端 11 条 PASS + 破坏 3+/2/1 红 | 两件第三方源码首次入库（qrcode bundle + jsQR），THIRD-PARTY-NOTICES §3b；ARGB→RGBA 归一（8 位颜色位数歧义，首跑解码 null）；交叉验证来自独立解码器 |
| 2026-09-21 | R34 输入收官 | 2f8af86 | 双端 16 条 PASS | TextInputController.caretPosition；Enter→onSubmit 的回调值派发未通（keydown 到、终态链接未解），CAPABILITY 记限制 |
| 2026-09-21 | R35 media | 4ec3cab | 双端通过 | AVPlayer → HTMLAudioElement 垫片（第 15 个平台模块）；Electron autoplay-policy 放行 |
| 2026-09-21 | R36 小件收官 | e8d209b | 双端 14 条 PASS + 破坏 1/1/1 红 | Flex 透传 CSS 同名；Span 内联子段；新分片 small.js（第 16 个） |
| 2026-09-21 | R37 分步器 | bf06354 | 双端 16 条 PASS + 破坏 9/1/1 红 | **破坏验证残留 BROKEN-1 跨轮持有 → 派发断言误删**（新坑 90）；分派分支嵌兄弟条件块=静默死分支（新坑 91）；ItemState 枚举值必须按声明顺序（坑 83 再现）；README R35 重复「触及」块顺手清理 |
| 2026-09-21 | R38 质量切片 | 93dd70c | 门禁 7 步全绿（+typecheck）；stepdemo 25 / inputdemo 29 双端；破坏 4/3/2 红 | **检查单元=拼接产物不是分片**（假阳性 153 全消）；runtime.d.ts Element 合并固化 123 个挂载字段；**真 bug×2**：onSubmit `value` 未定义被 try/catch 吞（R34 之谜破案）、v2 `Event` 遮蔽 Scroller new Event（flush 兜底掩盖）；enterKeyType 处理器补全；Mimosa deep 审计封印 0 findings（dependencySummary partial：零 npm 依赖无可扫包，如实记录） |
| 2026-09-21 | R39 语义纠偏 | e854fc2 | stepdemo 26 条双端；破坏 1/1/1 红 | 用户指了真机源码库 /data/work/compiler/Ark；Stepper 三处分歧照 stepper_pattern.cpp 对齐（先 CHG 后 NEXT／Skip 不切页／Waiting 忽略）；编程跳页静默（swiper 桥不转发）；新坑 94（.d.ts 给签名不给时序）；后续可用 pattern/ 目录逐组件清"推断"账 |
| 2026-09-21 | R40 语义清账 | c624b68 | navtransdemo 52 / showdemo 27 / qrdemo 12 双端；破坏 1/1/1 红 | ①Nav 转场：450ms 弹簧 + 入页 50%/视差 20%/弹出 50%（原 300ms 全页推断）；②Marquee：距离×85/step（原 step×16ms/帧），基座改 block，夹具 step 30 走完整重测；③QRCode ECC 确证 M（真机硬编码；node-qrcode 默认即 M——R33 的 L 注记是误判，从未真渲染过 L）；modules.get(row,col) 行优先，读反得转置（暗格数同、位置 43% 错） |
| 2026-09-21 | R41 编码器真机化 | 373e619 | qrdemo 12 + widgets 双端；破坏 1 红 | 用户要求"直接复用真机代码不要单独实现"：arkui_qrcodegen C++ 源码逐字复制（md5 校验）→ emcc STANDALONE_WASM（emscripten 6 工厂是 async 的，同步首绘等不起）→ base64 内嵌单文件加载器；data[i]&1=暗格、ECC 恒 MEDIUM(0)；node-qrcode vendor 删除、jsQR 保留；THIRD-PARTY-NOTICES §3b 重写 |
| 2026-09-21 | R42 语义确证二轮 | 241bb47 | 7 步门禁全绿（无实现改动） | 标题栏 56/112/138 确证（theme 默认值，138 正确——navigation_declaration.h 的 137 是未使用常量，险些误改）；生命周期"先 will 后实"部分确证；Marquee/转场文档滞留清理；FREE 初始高度同取 FULL_*（与我们一致） |
| 2026-09-21 | R43 语义确证三轮 | dfdadfb | navtransdemo + transitiondemo 双端；破坏 1/1/1 红 | 滚动联动确证 + 两处修正：副标题透明度 = (H−56)/(max−56)（原 0.7 系数错）、主标题字号插值 L=30fp↔M=26fp 经 SHARP 曲线（DOM 等价 scale=(26+SHARP(p)×4)/30，SHARP 对称故中点断言不变）；SLIDE_SWITCH 确证 scale 0.85（原 0.8 推断）；SHARP 求值器 = 二分解 x(t)=p |
| 2026-09-21 | R44 语义回归扫描 | 234ff77 | qrdemo 15 / showdemo 28 / widgets 双端；破坏 1 红/3 红 | 重读真机源码扫边界：Marquee step≤0 真机不除（原错替换 6，已修）；QRCode 过小组件真机拒绝绘制（原硬画溢出，已修 + 只尝试一次）；**widgets 无尺寸 QRCode 的旧断言编码了硬画假象 → 升级为拒绝语义**（真机 qrCodeSize≤0 分支）；onTitleModeChange 端点转确证；`__arkui_dom_syncDrawings` 钩子；破坏/恢复脚本两次 old/new 颠倒靠 grep BROKEN 回读抓到——破坏脚本必须回读验证 |
| 2026-09-24 | R45 Image | 71eec3f | imagedemo 15 条双端 + widgets 恢复；破坏 2/0/3 红 | 页面源是**声明式 ArkTS**（@Component struct），产物才是 ViewPU 类——按产物形态写源被 linter 拦（no-in/any/obj-literal）；ArkTS 禁内联对象字面量类型；alt 占位图必须惰性创建（预插空 src <img> 被 querySelector('img') 命中）；图片 URL 绝对路径 /test-assets/（MeasImage 同约定）；fire 同步认领防双发（首跑抓到 load+补派发双触发抛错） |
| 2026-09-24 | R46 Scroll | a6a209b | scrolldemo 16 条双端；破坏 1/1/1 红 | **Scroll.create 单参直接是 Scroller 实例**（不是 {scroller} 选项对象，解包错方向 _bind 没跑、scrollBy 全哑，探针抓到）；Scroller 扩面（layout.js）：官方形参 {xOffset,yOffset,animation} + scrollBy/scrollEdge/scrollPage/isAtEnd；onScrollEdge 到达沿（lastEdge 记忆）；onScrollStart/End = 滚动静默 80ms 收口（近似标注）；测试侧手动滚动后手动派发 scroll（坑 ⑧ rAF 对齐事件 headless 不可靠） |
| 2026-09-24 | R47 ImageAnimator | e32cb1d | animatordemo 13 条双端；破坏 0/6/2 红 | **本 SDK d.ts 无 onFrame 属性**（事件仅 Start/Pause/Repeat/Cancel/Finish 五枚，勿照旧文档实现）；duration=每帧 ms（默认 1000）、iterations=-1 无限；两个必踩点：产物顺序 state 先于 onStart 应用 → 回调延时派发（同步发会丢）、images 字面量重渲染重建 → 深 diff 防重置帧序；破坏脚本缩进层级照抄实际文件（工厂内 6 空格）——两次 AssertionError 都是这原因 |
| 2026-09-24 | R48 多代理验证轮 | 8da24d7 | 28 只读代理并行（53.5 分钟/54 步全 settled）；无实现改动 | **多代理加速实测**：一轮清账 23 个平台组件判定 + 5 份实现级摘要（用户原估 3-4 轮会话的调研量）；platform-only 14/partial 3/feasible 4/not-found 2；复核更正 0 条、ColorPicker×2 not-found 如实标 unconfirmed；中途配额耗尽换 provider 续跑（new-provider/mimo-v2.6-flash），结果全量到手；产物入库 docs/research/；可行队列新增 ContainerReader/Calendar/CalendarPicker/WithTheme |
| 2026-09-24 | R49 ListItemGroup | c717563 | listitemgroup 19 条双端；破坏 5/3/1 红 | 按 R48-A 摘要实现（调研零返工）；**space 只作用 item 间**（margin 实现，通用 gap 是陷阱⑤）；spaceWidth 压过 space；divider = item 顶缘外 ::before 槽（不占高度，真机首项无线同款）；footer 推迟到 pop（真机 AdjustMountTreeSequence 序）；List.sticky → position:sticky 规则；headless 经典滚动条占 15px（List 未隐藏滚动条时组宽=360-15，divider 线宽断言按内容宽算） |
| 2026-09-24 | R50 Refresh | 17ca845 | refreshdemo 25 条双端；破坏 13/6/6 红 | pointer 只收 touch；状态机 5 态；AR 先于 A3；同值不重复发；重渲染时 refreshing 选项重传（create 包装器）；默认指示器未绘制（CAPABILITY 记录）；headless 经典滚动条占 15px |
| 2026-09-24 | R51 DatePicker | 5597def | datepickerdemo 21 条双端；破坏 1/2/1 红 | 三列滚轮（year/month/day 各 5 行）；跨列联动（月变→day 夹取）；start/end 钳制+设了则 canLoop 强制 false；lunar 记警告不实现；month 0/1 基双变换；DCHG 含 CHG 子串——计数断言需负向后行断言 |
| 2026-09-24 | R52 TimePicker | 6300416 | timepickerdemo 10 条双端；破坏 2/1 红 | hour/minute/second 三列滚轮；useMilitaryTime 12h/24h（军事时间 hour 不补零）；TimePickerFormat 挂 global；ROADMAP/CAPABILITY 的 R52 条目漏记，R53 时补记 |
| 2026-09-25 | R53 WaterFlow | 539382c | waterflowdemo 21 条双端；破坏 14/6/7 红；门禁 7 步 | JS 绝对定位复刻真机换列算法（空列→严格最小→平高保左，water_flow_layout_info.cpp:271-298）；事件时序照 TriggerPostLayoutEvents，首帧 I+RS 补发必须排在布局 flush 后（新坑 96）；scrollToIndex 落点=max scroll 时 RE 过境成立（真机语义，修正 R48 摘要漏记）；layout.js scrollToIndex 扩查 FlowItem+补派发；原生 scroll 幽灵双发按 scrollTop 恒等去重（新坑 95）；WaterFlowSections shim；stats 手写 50→58（补账 TextInput/TextArea/Search/Hyperlink/QRCode 漏登记）；**budget 中断一次**：断点落 proof_dag journal（d6309220），恢复后无损续做 |
| 2026-09-25 | R54 CalendarPicker | 74e262c | calendarpickerdemo 19 条双端；破坏 1/1/1 红（B+C 合并跑）；门禁 7 步 | 可行队列选型（ContainerReader/WithTheme/Calendar 缓，理由在 ROADMAP R54）；入口三段+加减步进（+/- 触发 onChange——真机 FireChangeEvents:561-584）；同值不重发（CanReportChangeEvent:1615）；首列周日（calendar_paint_method.cpp:531）；AdjustDateToRange 夹取；静态 CalendarPickerDialog.show（OK/Cancel）；**budget 中断两次**（研究后/首跑后），断点落 todo+会话消息；首跑 4 红三因：calpAdjust 比较符反（真 bug）、标题断言混入翻页键字符、button margin 2px 破坏列位断言（后两为测试缺陷）；坑 93 再现（sel:null 状态袋坍缩，整袋断言修） |
| 2026-09-25 | R54.1 残留清账 | （本提交） | calendarpickerdemo 24 条双端；门禁 7 步 | 三条挂账清零：①Mimosa deep 审计重跑 **0 findings**（seal sha256:f6e09366…，依赖 partial=零 npm 依赖同 R38）；②hintRadius 真视觉（选中日内联 borderRadius 三档，fixture 增 cp3/cp4）；③markToday 状态接线（attr 只写 dataset 没写 st——翻月对照断言首跑即红抓到，升到可观测层后断言才有牙）；fixture 19→24 条 |
| 2026-09-25 | R55 类型化专项 | dd1d1ec | 隐式 any 1464→0；门禁 7 步全绿（noImplicitAny 已翻档） | 十六批人工（7dd7d5a/461e67e/4fa1e08/b7aff8a/dacb528/…/0a39291）+ 六组并行代理工作流（dwfrun-cff39b0a，A=main 174/B=93/C=31/D=17/E=42/F=area 20，join 后门禁循环收敛到 0）+ main.js 后半帮手 A2（转核验）；noImplicitAny=true 进门禁、试验档删除；方法论五条入 ROADMAP R55（表级 Record/工厂形状类型/evolving-let 声明处修/TS1016/按文件切组）； Mimosa deep 审计 0 findings（seal sha256:f6e09366…，R54.1 重跑） |
| 2026-09-25 | R56 TextPicker | 5680d37 | textpickerdemo 11 条双端；破坏合并 2 红；门禁 7 步绿 | 选择器三部曲收官；单列滚轮（wheel 同步单步/边界不动不发/__txpStep 暴露）；onChange 联合类型签名（窄签名被 ArkTS 10605999 拒——参数逆变）；selectedIndex 属性覆盖；对象 range 取 .text；多列/级联只取第一列记警告（R58 补齐）；首跑 4 红=坑 87 再演（onChange 同步发但 @State→DOM 滞后，断言前缺 tick）；noImplicitAny 门禁下新代码原生干净 |
| 2026-09-25 | R58 TextPicker 收尾 | c9863de | textpickerdemo 11→19 条双端；破坏 1 红（级联 build 摘除）；门禁 7 步绿 | 多列 string[][] 独立滚轮；级联 children 联动（colCount 按链深动态，父变→截断 sel+子列重置）；TextPickerDialog.show（fixed 面板 OK/Cancel 走 TextPickerResult）；引擎重构 tpxEngine 统一三态+弹层，__txpStep 单列兼容+__txpStepCol 多列；教训：多代理并行期 fixtures 漂移（test 读旧冻结件 tx4 全 null，probe 即知）；引擎重构后 __txp 变包装对象旧 handler 路径失效；dataset.selectedIndex 变 JSON 数组（R56 断言同步改） |
| 2026-09-25 | R58.1 Mimosa 重跑 | （本提交） | 审计 0 findings | deep 扫描 scan-2026-09-25T12-36-16 seal sha256:bf59cd02…（覆盖 R55~R58 全部新增代码）；依赖 completion=partial（零 npm 依赖不变）；两处流程失误实录：验证链 `\| grep && commit` 吞退出码致红门禁误提交两次（已 amend 修正），后续终验链显式捕获退出码 |
| 2026-09-27 | R97/R98 @ohos:cjk | （本提交） | cjk 双端（Electron 15 / 浏览器 6）；契约测试 22 条；门禁 7 步全绿 | 内核 v2 实现完整 c-abi 6 符号（echo/add/fib/upper/error + last_error/free）；NAPI 桥 bridge/napi/cjk_napi.node（dlopen→InitCJRuntime→dlsym，惰性挂载）；@ohos:cjk 垫片 + cjk.html 按端分流（不进浏览器 all 矩阵——windowdemo 先例，计数守门按端核对）；**坑 101**：@C 帧内 `Int64.toString()` 头部损坏（.size=6399178）→ 数字手写 ASCII；`libcangjie-std-core.so` 无 DT_SONAME → 必须 LD_LIBRARY_PATH；`dlerror()` 只能取一次；Mimosa deep 审计 0 findings（seal sha256:fe6dcc0b…） |
| 2026-09-27 | R99 内核 agent 原语 | 7991b6d | 契约测试 40 条；冒烟 14 条；cjk 双端（Electron 21 / 浏览器 6）；门禁 7 步全绿 | 内核 v3 agent 调度原语五方法（spawn 单调 id/list 按 spawn 序/send 邮箱/poll 排空/kill 收敛），注册表跨调用持久、kernel_init 重置（测试隔离语义）；trha MVP 数据面就位（控制面 CJThread 调度留下一片）；**坑 102**：包级初始化器在 dlopen dylib 不跑（容器全局量首用即 SIGSEGV）→ Option 字面默认+惰性构造；此 nightly `ArrayList.get` 返回 Option<T>；Mimosa deep 审计 0 findings（seal sha256:507a4c5f…） |
| 2026-09-27 | R100 内核并发调度器 | （本提交） | 契约测试 49 条；冒烟 18 条；cjk 双端（Electron 26 / 浏览器 6）；门禁 7 步全绿 | 内核 v4 异步作业（agent.submit/result + 有界 drainer cjthread 清空队列即返回）；c-abi.h 增可选调度符号节（pending/draining/drain_entry，缺席=旧内核向后兼容）；addon cjkCall 后置驱动（RunCJTask + RunUIScheduler 泵）；**坑 103**：Semaphore/Monitor 宿主线程不可用（栈腐蚀/6399178 垃圾值）→ 同步只用 Mutex；**坑 104**：嵌入模式 cjthread 只在 RunUIScheduler 泵窗口执行、sleep 空操作（timer 不跑）→ 禁自旋、宿主逐调用驱动；trha MVP 控制面就位；Mimosa deep 审计 0 findings（seal sha256:566b38d0…） |
