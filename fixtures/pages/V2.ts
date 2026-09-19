if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
/*
 * ArkTS 状态管理 V2 用例页。
 *
 * 覆盖：@ComponentV2 / @Local / @Param / @Once / @Event / @Monitor
 *       @Provider / @Consumer / @ObservedV2 / @Trace / @Computed
 *
 * 所有可断言节点都带 id —— 断言必须按 id 选节点，不能 querySelector('div')
 * （RelativeContainer 之类也是 div，文本断言会假通过）。
 */
// ── @ObservedV2 + @Trace：深度观测。V2 用【显式标记】而不是 V1 的 @Observed。──
@ObservedV2
class TaskItem {
    @Trace
    name: string;
    @Trace
    done: boolean;
    id: number; // 刻意不加 @Trace：改它【不应】触发重渲染
    constructor(id: number, name: string) {
        this.id = id;
        this.name = name;
        this.done = false;
    }
}
class V2Child extends ViewV2 {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda, extraInfo) {
        super(parent, elmtId, extraInfo);
        this.initParam("label", (params && "label" in params) ? params.label : '');
        this.initParam("seed", (params && "seed" in params) ? params.seed : 0);
        this.initParam("mode", (params && "mode" in params) ? params.mode : 'once');
        this.onPing = "onPing" in params ? params.onPing : () => { };
        this.inner = 0;
        this.hitCount = 0;
        this.finalizeConstruction();
    }
    public resetStateVarsOnReuse(params: Object): void {
        this.resetParam("label", (params && "label" in params) ? params.label : '');
        this.resetParam("seed", (params && "seed" in params) ? params.seed : 0);
        this.resetParam("mode", (params && "mode" in params) ? params.mode : 'once');
        this.onPing = "onPing" in params ? params.onPing : () => { };
        this.inner = 0;
        this.hitCount = 0;
        this.resetComputed("doubled");
        this.resetMonitorsOnReuse();
    }
    @Param
    readonly label: string;
    @Param
    readonly seed: number;
    // 编译器强制：@Once 必须同时是 @Param
    @Once
    @Param
    mode: string;
    @Event
    onPing: (n: number) => void;
    @Local
    inner: number;
    @Local
    hitCount: number; // @Monitor 回调里累加，用于断言回调确实触发了
    @Monitor('inner')
    onInnerChange(monitor: IMonitor) {
        this.hitCount += 1;
    }
    @Computed
    get doubled(): number {
        return this.inner * 2;
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 4 });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(`${this.label}/${this.mode}`);
            Text.id('v2child-label');
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(`${this.inner}`);
            Text.id('v2child-inner');
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(`${this.doubled}`);
            Text.id('v2child-doubled');
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(`${this.hitCount}`);
            Text.id('v2child-hits');
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('ping');
            Button.id('v2ping-btn');
            Button.onClick(() => { this.inner += 1; this.onPing(this.inner); });
        }, Button);
        Button.pop();
        Column.pop();
    }
    public updateStateVars(params) {
        if (params === undefined) {
            return;
        }
        if ("label" in params) {
            this.updateParam("label", params.label);
        }
        if ("seed" in params) {
            this.updateParam("seed", params.seed);
        }
        if ("mode" in params) {
            this.updateParam("mode", params.mode);
        }
    }
    rerender() {
        this.updateDirtyElements();
    }
}
class V2Consumer extends ViewV2 {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda, extraInfo) {
        super(parent, elmtId, extraInfo);
        this.theme = 'unset';
        this.finalizeConstruction();
    }
    public resetStateVarsOnReuse(params: Object): void {
        this.resetConsumer("theme", 'unset');
    }
    @Consumer('v2theme')
    theme: string;
    initialRender() { this.observeComponentCreation2((elmtId, isInitialRender) => {
        Text.create(`consume=${this.theme}`);
        Text.id('v2consume');
        Text.fontSize(12);
    }, Text); Text.pop(); }
    rerender() {
        this.updateDirtyElements();
    }
}
class V2 extends ViewV2 {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda, extraInfo) {
        super(parent, elmtId, extraInfo);
        this.count = 0;
        this.items = [new TaskItem(1, 'a'), new TaskItem(2, 'b')];
        this.touches = 0;
        this.parentHits = 0;
        this.monitorNow = -1;
        this.monitorBefore = -1;
        this.monitorDirty = -1;
        this.theme = 'dark';
        this.lastPing = -1;
        this.finalizeConstruction();
    }
    public resetStateVarsOnReuse(params: Object): void {
        this.count = 0;
        this.items = [new TaskItem(1, 'a'), new TaskItem(2, 'b')];
        this.touches = 0;
        this.parentHits = 0;
        this.monitorNow = -1;
        this.monitorBefore = -1;
        this.monitorDirty = -1;
        this.theme = 'dark';
        this.lastPing = -1;
        this.resetComputed("summary");
        this.resetMonitorsOnReuse();
    }
    @Local
    count: number;
    @Local
    items: TaskItem[];
    @Local
    touches: number; // 未加 @Trace 的字段，改它不应触发重渲染
    @Local
    parentHits: number;
    // 从 IMonitor 读回 now/before/dirty，用来验证回调入参形状与 SDK 的 .d.ts 一致
    @Local
    monitorNow: number;
    @Local
    monitorBefore: number;
    @Local
    monitorDirty: number;
    @Provider('v2theme')
    theme: string;
    @Local
    lastPing: number;
    @Monitor('count')
    onCountChange(monitor: IMonitor) {
        this.parentHits += 1;
        const v: IMonitorValue<number> | undefined = monitor.value<number>();
        if (v !== undefined) {
            this.monitorNow = v.now;
            this.monitorBefore = v.before;
        }
        this.monitorDirty = monitor.dirty.length;
    }
    @Computed
    get summary(): string {
        return `count=${this.count},items=${this.items.length}`;
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.padding(12);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.summary);
            Text.id('v2summary');
            Text.fontSize(14);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(`${this.lastPing}`);
            Text.id('v2ping');
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(`${this.parentHits}`);
            Text.id('v2parenthits');
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(`${this.monitorNow}`);
            Text.id('v2monitornow');
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(`${this.monitorBefore}`);
            Text.id('v2monitorbefore');
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(`${this.monitorDirty}`);
            Text.id('v2monitordirty');
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(`${this.touches}`);
            Text.id('v2touches');
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('inc');
            Button.id('v2inc');
            Button.onClick(() => { this.count += 1; });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // @Trace 字段：改 name 应触发重渲染（数组长度不变）
            ForEach.create();
            const forEachItemGenFunction = _item => {
                const it = _item;
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create(`${it.id}:${it.name}${it.done ? 'Y' : 'N'}`);
                    Text.id(`v2item${it.id}`);
                    Text.fontSize(12);
                }, Text);
                Text.pop();
            };
            this.forEachUpdateFunction(elmtId, this.items, forEachItemGenFunction, (it: TaskItem) => String(it.id), false, false);
        }, ForEach);
        // @Trace 字段：改 name 应触发重渲染（数组长度不变）
        ForEach.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('rename');
            Button.id('v2rename');
            Button.onClick(() => { this.items[0].name = 'renamed'; });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 非 @Trace 字段：改它【不应】触发重渲染（用来验证 @Trace 不是"全都观测"）
            Button.createWithLabel('touch');
            // 非 @Trace 字段：改它【不应】触发重渲染（用来验证 @Trace 不是"全都观测"）
            Button.id('v2touch');
            // 非 @Trace 字段：改它【不应】触发重渲染（用来验证 @Trace 不是"全都观测"）
            Button.onClick(() => { this.touches += 1; });
        }, Button);
        // 非 @Trace 字段：改它【不应】触发重渲染（用来验证 @Trace 不是"全都观测"）
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('touchid');
            Button.id('v2touchid');
            Button.onClick(() => { this.items[0].id = 99; });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('theme');
            Button.id('v2theme');
            Button.onClick(() => { this.theme = 'light'; });
        }, Button);
        Button.pop();
        {
            this.observeComponentCreation2((elmtId, isInitialRender) => {
                if (isInitialRender) {
                    let componentCall = new V2Child(this, {
                        label: 'child',
                        seed: 7,
                        mode: 'fixed',
                        onPing: (n: number) => { this.lastPing = n; }
                    }, undefined, elmtId, () => { }, { page: "entry/src/main/ets/pages/V2.ets", line: 131, col: 7 });
                    ViewV2.create(componentCall);
                    let paramsLambda = () => {
                        return {
                            label: 'child',
                            seed: 7,
                            mode: 'fixed',
                            onPing: (n: number) => { this.lastPing = n; }
                        };
                    };
                    componentCall.paramsGenerator_ = paramsLambda;
                }
                else {
                    this.updateStateVarsOfChildByElmtId(elmtId, {
                        label: 'child',
                        seed: 7,
                        mode: 'fixed'
                    });
                }
            }, { name: "V2Child" });
        }
        {
            this.observeComponentCreation2((elmtId, isInitialRender) => {
                if (isInitialRender) {
                    let componentCall = new V2Consumer(this, {}, undefined, elmtId, () => { }, { page: "entry/src/main/ets/pages/V2.ets", line: 138, col: 7 });
                    ViewV2.create(componentCall);
                    let paramsLambda = () => {
                        return {};
                    };
                    componentCall.paramsGenerator_ = paramsLambda;
                }
                else {
                    this.updateStateVarsOfChildByElmtId(elmtId, {});
                }
            }, { name: "V2Consumer" });
        }
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    static getEntryName(): string {
        return "V2";
    }
}
registerNamedRoute(() => new V2(undefined, {}), "", { bundleName: "com.example.hmtest", moduleName: "entry", pagePath: "pages/V2", pageFullPath: "entry/src/main/ets/pages/V2", integratedHsp: "false", moduleType: "followWithHap" });
