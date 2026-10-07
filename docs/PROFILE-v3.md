# PROFILE-v3 · 优化器 v3 立项 profiling 报告（R161）

> 目的：回答「优化器 v3 该不该做、切哪里」。方法：electron/main.js 新增
> `ARKUI_PROFILE=1`（CDP 采样 CPU profiler，100µs，包住页面执行），三重型页
> 实测 → `tools/profile-report.mjs` 热点聚合。数据：2026-10-04 本机 Electron
> 44.2.0（负载中等，采样占比相对结论不受绝对值影响）。

## 数据

| 页 | 总采样 ≈ CPU | 引擎 runtime JS | 页面模块 | native (program) | GC |
|---|---|---|---|---|---|
| stress10k（3300 行挂载） | 0.40s | **18.4%** | 2.6% | **73.9%** | 1.6% |
| attrheavy（100 行×重属性） | 0.12s | 13.5% | 1.9% | （program 同为最大桶） | — |
| perfbig（60 行树） | 0.23s | 5.8% | 0.7% | 39.9%（其余 idle 52%） | 0.1% |

引擎侧 TOP 函数（stress10k，self %）：

| 函数 | % | 管线 |
|---|---|---|
| applyAttrInner | 4.2 | 属性应用主循环 |
| textLike | 1.7 | 文本类组件判定 |
| applyTextClamp | 1.6 | 文本截断属性 |
| observeComponentCreation2 | 1.0 | 组件创建登记 |
| applyAttr | 0.8 | 属性分发 |
| mountNode | 0.8 | DOM 挂载 |

## 结论（立项判定）

1. **引擎 JS 侧不是大头**：最重的 stress10k 上引擎 runtime 只占 18.4%；
   最大桶是 native (program)（Blink 布局/样式回收算，40–74%）——那是
   DOM/样式层面的成本，**不在编译期优化器的射程内**。
2. **JS 侧热点高度集中在属性应用管线**（applyAttrInner/applyAttr/textLike/
   applyTextClamp 合计 ≈ 8–9% 总 CPU，占引擎 JS 的一半）。v1.1 的静态/动态
   分裂已减少「写入哪些属性」；剩下的杠杆是「怎么写」——同帧去重、批量
   style 写入（读 textLike/applyTextClamp 的重复调用形态）。
3. **判定：v3 立项为「属性应用管线专项」**，范围=applyAttrInner 分发去重 +
   textLike/applyTextClamp 快路径缓存；**预期收益上限 ≈ stress 类页 5–8% 总
   CPU**（JS 侧减半的乐观估计），普通页面收益个位数。属"值得做但不是
   性能倍增器"——做完属性专项后若还要挖，下一步方向在 DOM 结构侧（减少
   节点/属性数量），那属于运行时渲染策略而非编译期。

## 第一刀实测结论（R162，v3 判定关闭）

落地两刀（语义零变化，全矩阵绿）：①textLike 同值去重（`__lastText` memo，
跳过同值 textContent 写）②applyTextClamp 幂等守卫（同参重放跳过 style 三连写）。

**after 实测（stress10k，run 同机同载）**：引擎桶 18.4%→18.2%、textLike
1.7%→1.6%、applyTextClamp 1.6%→1.5%——**噪声级，无可测收益**。根因：
stress10k 的 bulk update 每行写的是【新值】，挂载期全是首写——同值重放在
本项目的代表性负载里不存在（PERF 页全部如此：stress 更新值、lazyvh 滚动
换内容、tabanim 动画帧变 transform）。

**v3 终局判定**：JS 属性管线专项的收益上限被实测证伪（比立项时估的 5-8%
还要低——接近 0）。**v3 关闭**；两刀保留为卫生改进（只减少冗余 DOM 写，
零回归）。若未来出现"同值重放为主"的负载形态（如大量静态页热重载），
两刀自动生效。真正的性能杠杆在 **DOM 结构侧**（减少节点数/样式属性数——
运行时渲染策略，非编译期），需要单独立项且与语义保真目标权衡。

## tracing 量化（R164，DOM 结构侧专项方向裁定）

方法：`electron/main.js ARKUI_TRACE=1`（CDP Tracing 域，页面执行窗，互斥时间口径
——嵌套不双计）→ `tools/trace-report.mjs` 分桶。两重型页交叉：

| bucket（互斥） | stress10k | attrheavy | 说明 |
|---|---|---|---|
| **style 样式重算** | **1.1%**（15.2ms） | **0.1%**（1.1ms） | Document::recalcStyle 等 |
| layout 布局+排版 | **31.0%**（420ms） | 15.6%（116ms） | performLayout 21.8% + ShapeText 文本整形 7.8% 等 |
| paint 绘制合成 | 5.9% | 3.9% | PrePaint/Paint/Raster/Compositing |
| parse 解析（一次性） | 27.4% | 25.1% | CSSParser 8.9% + JS parse/eval + 资源解码——**仅首渲染** |
| script 脚本回调 | 5.8% | 2.1% | Timer/微任务/GC |
| other（RunTask 为主） | 28.7% | 53.2% | **页面自身 JS 泵**（驱动轮询），非运行时 |

**方向裁定（数据说话）**：
1. **A 档（样式写批处理）被证伪**——style 重算 0.1-1.1%，R162 "(program) 是
   样式" 的直觉在样式侧没有对应物；样式写入的 recalc 成本可忽略。
2. **B/C 档（减节点）是唯一结构杠杆**——layout+文本整形 16-31% 随节点/文本量
   走，paint 连带；减节点 ≈ 等比缩这部分（B 档合并容器=中等降幅；C 档虚拟化=
   长列表页大幅降幅，真机 LazyForEach 同语义）。
3. **新识别的独立杠杆：parse 25-27%**（一次性加载成本，与 DOM 结构无关）——
   CSS/JS 模块体积与注入策略的优化面，仅影响首渲染时长，rerender 型负载不受益；
   不并入本专项，记档待议。

### Electron ↔ Chrome 对拍（R164.1，双端交叉验证）

工具：`tools/chrome-trace.sh`（bash 启停 Chrome + python CDP 直连只算不写——
双层包装器过扫描纪律）；同页同类别同互斥口径，Chrome 154.0.8037.97（真实时钟，
与 electron ARKUI_TRACE 一致）。**构成可比、绝对 ms 不可比**（视口/窗口构成
不同：Electron 窗 480×400 vs Chrome headless 默认 800×600，attrheavy 行换行差异
即证）。

| bucket（互斥 %） | stress10k E44 | stress10k C154 | attrheavy E44 | attrheavy C154 |
|---|---|---|---|---|
| style 样式重算 | 1.1 | 1.4 | **0.1** | **0.4** |
| layout 布局+排版 | 31.0 | 35.1 | 15.6 | 3.6 |
| parse 解析 | 27.4 | 28.3 | 25.1 | 42.6 |
| paint 绘制合成 | 5.9 | 9.3 | 3.9 | 6.6 |
| script 回调 | 5.8 | 7.9 | 2.1 | 1.0 |
| other（RunTask/页面泵） | 28.7 | 18.0 | 53.2 | 45.9 |

**对拍结论**：
1. **style≈0 四测一致（0.1-1.4%）**——A 档证伪在双引擎/双版本/双环境上稳健，
   不是 Electron 特有现象。
2. **layout+排版是渲染侧主导**（stress10k 双端 31-35%）且随页型缩放——B/C
   杠杆跨端成立；attrheavy 两腿差异（15.6 vs 3.6）来自视口换行差异，提醒
   B 档复验时**统一视口口径**。
3. **parse 一次性成本双端均显著（25-43%，短窗口占比放大）**——独立杠杆结论
   跨端成立。
4. 方法论：跨端对拍只信构成比与排序，不信绝对毫秒（窗口/视口/版本全不同）。

## B0 起步审计（R165，用户裁定「B 起步、C 随后」）——坍缩收益趋零 + 坑 97 漏网存量缺陷

工具：`tools/layout-audit.sh`（Chrome 启停在 bash）+ `chrome-trace.py rootdump`
（**真实时钟 CDP JSON 树**——不用 --dump-dom 虚拟时钟「终态树不完整」假象、不用
outerHTML「void 元素丢子树」盲区，两坑均 textdemo 实测）+ `layout-audit.py`
（只读分析：三档坍缩模拟 + 非法挂载检测）。

**坍缩三档（87 页实测）**：
| 档 | 结果 | 定性 |
|---|---|---|
| T0 contents 透传层 | 每页 0-1 个（0.0-0.3%） | 收益趋零 |
| T1 同向白名单层 | 每页 0-1 个 | 收益趋零 |
| 宽档「带几何也删」 | stress10k 33.3% 等 | **假上限**（Row 有 width/height/padding，无实现可删） |

**→ B 档（合并嵌套纯布局容器）按数据如实收缩：页面形态是「单容器+大量带几何
叶子行」，非「多层无几何套娃」，坍缩候选 0-1 节点/页，不值得动 DOM 结构。**
（页面真实形态：stress10k 9905 节点全带 comp、Row 直挂 ForEach contents 层 1 个。）

**同轮审计的真产出——坑 97 漏网存量缺陷（misnest 检测）**：
- 首轮 87 页 **5 页爆雷 29 处**：components 7（Slider 挂进 TextInput）/ inputdemo 10
  （Radio 嵌 Radio）/ showdemo 3（Divider 当父）/ textdemo 5（input/a 内藏控件）/
  smalldemo 4（Span 嵌 Span）——编译产物对无子组件不生成 `.pop()`，运行时
  `__arkuiLeaf` 自动弹栈（坑 97）标记未覆盖这些族。
- **为什么历史全绿没人发现**：断言查全局 `querySelector` 不查父链；HTML 序列化对
  void 元素丢子树 → dump/截图/序列化都看不见，只有真实 DOM 树（JSON 序列化）能看见。
- 修复（六处）：inputComponent helper（盖 TextInput/TextArea/Search/Checkbox/Radio/
  Toggle/Slider 族）+ Hyperlink + Span + Divider + LoadingProgress 补 `__arkuiLeaf`；
  `parentOfTop` 增 **VOID_ELEMENT_TAGS 结构兜底**（input 等 void 层级无论漏标都弹）。
- **修复的连锁暴露（f87cda3 CI 9 腿红）**：QRCode 拒绘判据原用布局 offsetWidth——
  挂载修正后无声明 QRCode 被父拉出非 0 rect 即误绘（components qrRendered='29'，
  断言曾靠挂错状态通过）。改**声明尺寸口径**（真机 qrCodeSize=声明值）判据与绘制
  同源；QrDemo 三件双声明零误伤。
- 复验：二轮 87 页 **报警清零**；爆页双端+全 browser 矩阵（145 声明）+全 electron
  矩阵（159 声明）全绿；textdemo 增**父链防回归断言**（16→17 条，三处声明同步）。

## C 档虚拟化——C0 量化与设计（R167，A/B 证伪/收缩后唯一结构杠杆）

**C0 量化**（trace 实测）：有虚拟化的 lazyvh 页 layout=11.2%/style 0.5%；无虚拟化的
stress10k（9905 节点全挂载）layout=**31%**+paint 5.9%。stress10k 视口 600px 内仅
约 10 行（~33 节点）——**3300 行中 99% 在视口外**。收益上限估算：虚拟化后节点
9905→~60，Blink layout/paint 随节点缩 → stress 类页总 CPU 预期降 **25-30%**——
A/B 档全灭后的**本项目最大单笔性能杠杆**。

**C1 首刀落地（R167 续，content-visibility:auto 方案——比 spacer 重写小一个量级）**：
- 实现：Column/Row 加 `content-visibility: 'auto'`（Blink 原生屏外跳过）——节点保留
  DOM（查询/计数/对拍文本流零分叉）、显式 height 占位、读时强制包含（断言语义安全）。
- **收益实测（stress10k 同口径 trace）：layout 420→115.5ms（-73%）、paint 减半、
  渲染事件 12192→9109**——C0 预估兑现大头。
- 验证：browser 全矩阵 rc=0 + electron 全矩阵 rc=0（99 PASS）+ 对拍 Stress10k
  文本流不变（PASS-SUBSET 133⊆38503——c-v 不删节点实证）。
- 可扩面（记档未做）：Flex/Stack 同款；含动画/transition 容器的屏外首帧行为待观察。

**C1 全量设计**（余下切片，待接力）：
- 范围：ForEach/静态长列表的**视口窗口化挂载**——真机 LazyForEach 语义同源
  （oracle 背书：真机本就只挂视口+占位高度）。
- 机制：复用既有 lazyvh（LazyVar 页 R150 窗口机制）——spacer 占位保持布局语义
  （scrollHeight/锚距口径，R150 估高教训：窗口重挂须 flush 后二次对齐）。
- 断言影响面：stress10k 的 rows=3300 PERF 计数（挂载数变——断言改「占位+窗口」
  语义）；页级查询 `querySelectorAll` 全量行的断言需改窗口内查询（先 grep 影响面）。
- 验证链：全矩阵 rc + 第六端对拍（**虚拟化后设备/浏览器文本流应更接近**——
  真机 LazyForEach 同窗口）+ trace before/after 同口径（R162 闭环纪律）。

## 复跑

```bash
ARKUI_PROFILE=1 ARKUI_WAIT_MS=90000 bash electron/run.sh stress10k
node tools/profile-report.mjs build/stress10k.cpuprofile
```

坑记档：① offscreen(OSR) 与 webContents.debugger 冲突——attach 后页面挂死，
profiling 模式强制非 OSR（main.js `ARKUI_PROFILE` 分支）；② Electron 44 的
sendCommand 对 Profiler.enable/start **响应不回投**（命令实际生效，stop 拿得到
采样）——启动段 1.5s 超时放行即可，别等响应。
