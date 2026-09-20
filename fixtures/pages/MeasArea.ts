if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface MeasArea_Params {
    log?: string;
    bump?: number;
}
interface KidLayout_Params {
}
class KidLayout extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: KidLayout_Params) {
    }
    updateStateVars(params: KidLayout_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
    }
    aboutToBeDeleted() {
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    Kids(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('c1');
            Text.fontSize(14);
            Text.height(20);
            Text.id('c1');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('c2');
            Text.fontSize(14);
            Text.height(40);
            Text.id('c2');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('c3');
            Text.fontSize(14);
            Text.height(30);
            Text.id('c3');
        }, Text);
        Text.pop();
    }
    onMeasureSize(selfLayoutInfo: GeometryInfo, children: Measurable[], constraint: ConstraintSizeOptions): SizeResult {
        let h: number = 0;
        for (let i = 0; i < children.length; i++) {
            const r: MeasureResult = children[i].measure({
                minWidth: 0, maxWidth: 60, minHeight: 0, maxHeight: 200
            });
            h = h + r.height;
        }
        // 返回的尺寸【优先于】组件自身声明的 width/height（JSDoc 明确）
        return { width: 60, height: h };
    }
    onPlaceChildren(selfLayoutInfo: GeometryInfo, children: Layoutable[], constraint: ConstraintSizeOptions): void {
        let y: number = 0;
        for (let i = 0; i < children.length; i++) {
            const r: MeasureResult = children[i].measureResult;
            children[i].layout({ x: 0, y: y });
            y = y + r.height;
        }
    }
    initialRender() {
        this.Kids.bind(this)();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
}
class MeasArea extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.__bump = new ObservedPropertySimplePU(0, this, "bump");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: MeasArea_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.bump !== undefined) {
            this.bump = params.bump;
        }
    }
    updateStateVars(params: MeasArea_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
        this.__bump.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
        this.__bump.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __log: ObservedPropertySimplePU<string>;
    get log() {
        return this.__log.get();
    }
    set log(newValue: string) {
        this.__log.set(newValue);
    }
    private __bump: ObservedPropertySimplePU<number>;
    get bump() {
        return this.__bump.get();
    }
    set bump(newValue: number) {
        this.__bump.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.width(320);
            Column.height(400);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ① onAreaChange：拿到真实面积（同尺寸的真实 DOM 作为对照）
            Text.create('a');
            // ① onAreaChange：拿到真实面积（同尺寸的真实 DOM 作为对照）
            Text.fontSize(14);
            // ① onAreaChange：拿到真实面积（同尺寸的真实 DOM 作为对照）
            Text.width(120);
            // ① onAreaChange：拿到真实面积（同尺寸的真实 DOM 作为对照）
            Text.height(30);
            // ① onAreaChange：拿到真实面积（同尺寸的真实 DOM 作为对照）
            Text.id('t1');
            // ① onAreaChange：拿到真实面积（同尺寸的真实 DOM 作为对照）
            Text.onAreaChange((oldV: Area, newV: Area) => {
                this.log = this.log + 'A|' + newV.width + 'x' + newV.height + '|';
            });
        }, Text);
        // ① onAreaChange：拿到真实面积（同尺寸的真实 DOM 作为对照）
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ② 尺寸会变 → 第二次触发（oldValue 应是上一次的真实值）
            Text.create('w' + this.bump);
            // ② 尺寸会变 → 第二次触发（oldValue 应是上一次的真实值）
            Text.fontSize(14);
            // ② 尺寸会变 → 第二次触发（oldValue 应是上一次的真实值）
            Text.width(100 + this.bump * 40);
            // ② 尺寸会变 → 第二次触发（oldValue 应是上一次的真实值）
            Text.height(20);
            // ② 尺寸会变 → 第二次触发（oldValue 应是上一次的真实值）
            Text.id('t2');
            // ② 尺寸会变 → 第二次触发（oldValue 应是上一次的真实值）
            Text.onAreaChange((oldV: Area, newV: Area) => {
                this.log = this.log + 'B|' + oldV.width + '>' + newV.width + '|';
            });
        }, Text);
        // ② 尺寸会变 → 第二次触发（oldValue 应是上一次的真实值）
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('bump');
            Button.onClick(() => {
                this.bump = this.bump + 1;
            });
            Button.id('btn');
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('log=' + this.log);
            Text.id('logline');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            __Common__.create(true);
            __Common__.id('kid');
        }, __Common__);
        {
            this.observeComponentCreation2((elmtId, isInitialRender) => {
                if (isInitialRender) {
                    let componentCall = new 
                    // ③ 嵌套的自定义布局组件
                    KidLayout(this, {}, undefined, elmtId, () => { }, { page: "entry/src/main/ets/pages/MeasArea.ets", line: 64, col: 7 });
                    ViewPU.create(componentCall);
                    let paramsLambda = () => {
                        return {};
                    };
                    componentCall.paramsGenerator_ = paramsLambda;
                }
                else {
                    this.updateStateVarsOfChildByElmtId(elmtId, {});
                }
            }, { name: "KidLayout" });
        }
        __Common__.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "MeasArea";
    }
}
registerNamedRoute(() => new MeasArea(undefined, {}), "", { bundleName: "com.example.hmtest", moduleName: "entry", pagePath: "pages/MeasArea", pageFullPath: "entry/src/main/ets/pages/MeasArea", integratedHsp: "false", moduleType: "followWithHap" });
