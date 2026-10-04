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

## 复跑

```bash
ARKUI_PROFILE=1 ARKUI_WAIT_MS=90000 bash electron/run.sh stress10k
node tools/profile-report.mjs build/stress10k.cpuprofile
```

坑记档：① offscreen(OSR) 与 webContents.debugger 冲突——attach 后页面挂死，
profiling 模式强制非 OSR（main.js `ARKUI_PROFILE` 分支）；② Electron 44 的
sendCommand 对 Profiler.enable/start **响应不回投**（命令实际生效，stop 拿得到
采样）——启动段 1.5s 超时放行即可，别等响应。
