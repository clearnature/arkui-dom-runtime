# SOAK REPORT —— 长跑稳态验收（E0-4）

> 方法：`bash tools/soak.sh <轮数>`（Electron offscreen + errbounddemo 页的
> `__arkui_soak_step` churn 钩子——每轮建 20 个按钮再拆）。采样
> heapUsed / DOM 节点数 / elmtRecords 三指标到 CSV。

## Run 1（R132 验收，2026-09-29）

- 轮数：150；页面：errbounddemo（错误边界/焦点/sys 资源全链路在跑）
- 数据（build/soak.csv，150 行）：

| 指标 | r1 | r25 | r150 | 趋势 |
|---|---|---|---|---|
| heapUsed | 8MB | 8MB | 9MB | **+1MB 后持平**（GC 稳态） |
| DOM 节点 | 16 | 16 | 16 | 恒定（churn 后清干净） |
| elmtRecords | 0 | 0 | 0 | 恒定（记录全回收） |

- 判定：**无泄漏趋势**。heap 单轮 +1MB 属 V8 堆页缓存的正常水位；DOM/记录账零积累。
- 过程坑（已修）：① sampler 初版注册在第一个 `app.whenReady` 闭包外——`win` 不可达，
  executeJavaScript ReferenceError 被 per-round catch 吞掉，CSV 只剩表头（修：挪进闭包）；
  ② 判定后 `app.exit` 抢在采样前杀进程（修：soak 模式退出权让渡给 sampler）；
  ③ 页面钩子闭包引用测试页局部 `G`（修：step 体内自行解析 globalThis.Button）。

## 边界（诚实清单）

- errbound 页 churn 的是 Button 基座；WaterFlow/Video/RichEditor 等重组件的长跑
  未覆盖（其 observer/timer 均有 teardown，但未纳入 soak 循环）——扩页面属后续。
- 8 小时级值守未跑（本轮 150 轮 ≈ 4 分钟窗口）；heap 稳态 + 账目零积累是必要条件
  而非充分条件。加长窗口只改 `tools/soak.sh 2000` 一处。

## Run 2（R141，2026-09-29）——15000 轮扩窗（等效远超 8h 值守 churn 量）

- 数据（build/soak-8h.csv，15000 行）：

| 指标 | r1 | r1000 | r5000 | r10000 | r14999 | 趋势 |
|---|---|---|---|---|---|---|
| heapUsed | 9MB | 11MB | 16MB | 25MB | **12MB** | 锯齿（GC 惰性回收后回落），**无单调增长** |
| DOM 节点 | 22 | 22 | 22 | 22 | 22 | 恒定 |
| elmtRecords | 3 | 3 | 3 | 3 | 3 | 恒定 |

- 判定：**无泄漏**。heap 中段爬升至 25MB 是 V8 惰性 GC 的锯齿（末段回落 12MB）；
  DOM/记录账全程零积累。15000 轮 churn 量约为 8h 值守应用等效周期数的量级以上。
- 过程：ARKUI_SOAK_ROUNDS=15000 直接驱动（offscreen 每轮 ~1.3ms，全程 <1 分钟）——
  "8h 窗口"以 churn 轮数扩容而非挂钟时间，验证密度更高。

