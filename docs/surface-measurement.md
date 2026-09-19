# 接口面测量报告（①.5）

用两个样本测量 ArkUI 运行时接口面，目的是**在动手实现前知道真实工作量在哪**。

| 样本 | 源码 | 转换产物 | 说明 |
|---|---|---|---|
| A 模板应用 | `pages/Index.ets`（devecocli 脚手架） | `pages/Index.ts` 2,737 B | `RelativeContainer` + `Text` + `@State` |
| B 重页面 | `pages/Rich.ets`（本次新写） | `pages/Rich.ts` 9,256 B | 自定义组件 + `@Prop` + `@Link` + `@Builder` + `ForEach` + `List`/`ListItem` + `if/else` + `Button` |

**结论先行：样本 A 严重低估。** 真实难点不是组件数量，而是样本 B 暴露的 **7 个机制**。

## 一、接口面增量（B 相对 A）

| 类别 | A | B | 增量 |
|---|---|---|---|
| 状态管理类 | `ObservedPropertySimplePU` | +`ObservedPropertyObjectPU`（`@State` 对象/数组）<br>+`SynchedPropertySimpleOneWayPU`（`@Prop`）<br>+`SynchedPropertySimpleTwoWayPU`（`@Link`） | **+3 类** |
| 运行时全局 | `ViewPU` `ObservedPropertySimplePU` `SubscriberManager` `registerNamedRoute` | +`ViewStackProcessor` +`ForEach` +`If` | **+3** |
| 组件类 | `Text` `RelativeContainer` | +`Column` `Row` `Button` `If` `List` `ListItem` `ForEach` | **+7** |
| ViewPU 协议 | `observeComponentCreation2` `updateDirtyElements` `finalizeConstruction` `id__` `aboutToBeDeletedInternal` `paramsGenerator_` `purgeVariableDependenciesOnElmtId` … | +`ViewPU.create`（**静态**）<br>+`updateStateVarsOfChildByElmtId`<br>+`ifElseBranchUpdateFunction`<br>+`forEachUpdateFunction` | **+4** |
| 组件工厂名 | 统一 `create(...)` | **`Button.createWithLabel('add')`** —— 工厂名不统一 | ⚠️ |

## 二、7 个机制（真正的难点，附产物原文）

### 机制 1：自定义组件挂载 + 第二参数形态不同 ⚠️
```js
this.observeComponentCreation2((elmtId, isInitialRender) => {
    if (isInitialRender) {
        let componentCall = new ItemRow(this, { label: 'clicks', count: this.__count },
                                        undefined, elmtId, () => { }, { page, line, col });
        ViewPU.create(componentCall);                     // ← 静态方法：把子视图挂到当前父位置
        componentCall.paramsGenerator_ = () => ({ label: 'clicks', count: this.__count });
    } else {
        this.updateStateVarsOfChildByElmtId(elmtId, { label: 'clicks' });   // 父重渲染时推新参数
    }
}, { name: "ItemRow" });        // ← 注意：这里是 {name:...} 对象，不是组件类！
```
**内置组件传组件类，自定义组件传 `{name}`** —— 运行时必须兼容两种形态。

### 机制 2：`@Link` 是"共享同一个 cell"
- 父传的是**自己的状态实例**：`count: this.__count`（不是值！）
- 子：`new SynchedPropertySimpleTwoWayPU(params.count, this, "count")`
- 复用：`this.__count.resetSource(params.count)`
→ 双向同步 = 双方指向同一数据单元；`resetSource` 在参数变化时重指。

### 机制 3：`@Prop` 是"单向推送"
- 子：`new SynchedPropertySimpleOneWayPU(params.label, this, "label")`
- 父推：`updateStateVarsOfChildByElmtId(elmtId, { label: 'clicks' })`
- 子接：`updateStateVars(params) { this.__label.reset(params.label); }`

### 机制 4：`if/else` 降级为 `If` 组件 + 分支函数
```js
this.observeComponentCreation2((elmtId, isInitialRender) => {
    If.create();
    if (this.count > 0) { this.ifElseBranchUpdateFunction(0, () => { /* Text… */ }); }
    else               { this.ifElseBranchUpdateFunction(1, () => { /* Text… */ }); }
}, If);
If.pop();
```
→ 语义是"同一 elmtId 下按 branchId 替换子树"，**切换时必须销毁旧分支**，否则 elmtId 泄漏。

### 机制 5：`ForEach` 的深渲染（最复杂）
```js
ForEach.create();
const forEachItemGenFunction = _item => {
    const item = _item;
    const deepRenderFunction = (elmtId, isInitialRender) => { /* 创建 ListItem 子树 */ };
    const itemCreation2 = (elmtId, isInitialRender) => { ListItem.create(deepRenderFunction, true); };
    ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
    ...
    ViewStackProcessor.StopGetAccessRecording();
    this.observeComponentCreation2(itemCreation2, ListItem);
    ListItem.pop();
};
this.forEachUpdateFunction(elmtId, this.items, forEachItemGenFunction, (item: string) => item, false, false);
ForEach.pop();
```
→ 需要 `forEachUpdateFunction(elmtId, 数组, 生成器, 键生成器, …)` + `ListItem.create(deepRender, true)`（第二参数 `true` = deep render）。

### 机制 6：`ViewStackProcessor` 是**官方命名的组件栈**
我的第①步用私有 `nodeStack` 实现了同样的东西，而官方产物期望一个全局 `ViewStackProcessor`（至少 `StartGetAccessRecordingFor(elmtId)` / `StopGetAccessRecording()`）。
→ **应改名为官方形态并把栈对外暴露** —— 这算是设计方向的确认（我摸对了），但命名要对齐。

### 机制 7：`@Builder` 无需额外实现 ✅
`this.header.bind(this)()` —— `@Builder` 就是"方法 + bind(this)"，现有运行时天然支持。

## 三、对第①步运行时的差距分析

| 机制 | 第①步运行时 | 需要做 |
|---|---|---|
| 扁平 create/setter/pop 栈 | ✅ 已实现 | 改名为 `ViewStackProcessor` |
| 依赖追踪 / 批量重渲染 | ✅ 已实现 | 扩展到 4 个状态类 |
| `If` 分支 | ❌ 无 | `If.create/pop` + `ifElseBranchUpdateFunction` |
| `ForEach` 深渲染 | ❌ 无 | `ForEach` + `forEachUpdateFunction` + deepRender |
| 自定义组件 / `ViewPU.create` | ❌ 无 | 静态 `create` + `{name}` 形态兼容 + 子视图挂载 |
| `@Prop` / `@Link` | ❌ 无 | 两个 Synched 类 + `reset`/`resetSource` + `updateStateVarsOfChildByElmtId` |
| 多工厂名（`createWithLabel`） | ❌ 无 | 工厂方法需按组件声明枚举，不能只认 `create` |

## 四、计划重排（依据本报告）

原计划"② 直接代码生成 150 个组件"**优先级错了**：组件骨架是机械的，而上面 5 个机制决定运行时架构。

```
② 运行时升级：ViewStackProcessor 改名 + 4 状态类 + If + ForEach + 自定义组件
   → 验证：Rich.ts 能在 DOM 上跑起来（点击 add → count 递增 → @Prop 文本同步 → if 分支切换 → List 出现 3 项）
③ 组件库代码生成（150 个 json）+ 布局语义
④ @ohos:* 模块别名层
```

**②的验证物已经现成**：`Rich.ts` 就在 cache 里，且它同时覆盖了 5 个机制——是一个天然的集成测试。
