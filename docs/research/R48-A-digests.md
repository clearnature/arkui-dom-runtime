# R48-A：高价值组件实现级语义摘要（WaterFlow / ListItemGroup / Refresh / DatePicker / TimePicker）

> 2026-09-24 多代理并行调研产出（方案 A）。每份摘要 = 声明面（.d.ts 逐条）+ 真机行为
> （pattern 源码引用）+ DOM 映射提案 + 夹具设计（可精确断言）+ 陷阱。来源：28 代理并行
> 工作流（见 `docs/research/R48-platform-verdicts-and-digests.md` 同轮报告与
> `.zcode/workflow-runs/` 脚本）。实现各组件时**先读对应摘要**，再按 R45-R47 节奏落地。

（正文为调研代理产出的五份摘要，约 175KB，与平台判定报告同轮生成。
完整内容见工作流产物存档：`/home/yanli/.zcode/cli/artifacts/sess_2a4a744c-fc79-4823-b652-162310a5a7aa/`
下 `dwfrun-63c2c2ca-*-artifact_*` 系列文件；本文件为入库占位与索引。）

## 摘要要点速览

- **WaterFlow**：瀑布流容器——声明面/真机 WaterFlowSection 分组布局/DOM 建议绝对定位
  按 section 计算 y 偏移/断言用各 item offsetTop。
- **ListItemGroup**：List 分组——group 头尾 + 子项折叠语义/DOM 建议 fieldset 式分组容器。
- **Refresh**：下拉刷新——refreshing 双向 + onRefreshing/onStateChange/DOM 建议
  pointer 拖拽 + threshold 触发（headless 用手动派发，坑 ⑧ 同族）。
- **DatePicker**：日历选择器弹层——lunar/start/end 区间/onChange 带
  DatePickerResult{/year,/month,/day}；真机为骨架原始组件自绘。
- **TimePicker**：时间选择器——selected/hour(s)/minute(s)/onChange 带 TimePickerResult。

（每份的完整声明面/真机函数引用/DOM 方案/断言数字见上述存档文件。）
