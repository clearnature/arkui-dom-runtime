# INCREMENTAL REPORT —— 增量走查验收（E2-1）

> 方法：登记集驱动的 4 个 flush 尾部 sync（alignRules/draw/areas/navChrome）——
> 能力挂上时登记（WeakRef→es2020 lib 降级为 Set+isConnected 惰性清扫），
> flush 尾部只遍历登记集而非 querySelectorAll("*") 全树。
> 护栏：全矩阵（含行复用/依赖追踪/游标/断言）不回退。

## 基线对照（R138 前基线 → R139 增量后，Electron 实测）

| 指标 | 页 | 基线(R138) | 增量后(R139) | 备注 |
|---|---|---|---|---|
| stress1k 首渲同步 | stress1k | 29.8ms | 29.7ms | 1055 节点——全树本就不贵 |
| stress1k bulk_poll | stress1k | 19.8ms | ~18ms | 同上 |
| stress10k 首渲同步 | stress10k | 143.5ms | 129.7ms | 9905 节点：4×全树→4×登记集（3300 行） |
| stress10k bulk_poll | stress10k | 216.5ms | 144.9ms | **-33%**——增量收益主证 |
| stress10k bulk_flush | stress10k | 22.0ms | 16.4ms | **-25%** |

## 语义等价性

- 登记点：__areaCbs/__drawKind×4/__arkuiQrPending/__alignRules/__guideLines/__navState/__navDest 挂上处，8 处。
- 查询发现 vs 登记发现的差异面 = 「运行时之外手工赋值」——全矩阵为硬护栏，未回退。
- 显式传 rootEl（局部 sync 调用）保留旧 querySelectorAll 路径。

## 边界

-登记集是 Set<HTMLElement> 强引用（es2020 lib 无 WeakRef；不升 lib），靠 isConnected 惰性清扫收敛——不无界增长，但被摘除的节点在下次清扫前仍占集合槽位。
