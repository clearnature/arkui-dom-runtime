if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface AnimDemo_Params {
    w?: number;
    op?: number;
    fin?: string;
}
class AnimDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__w = new ObservedPropertySimplePU(100, this, "w");
        this.__op = new ObservedPropertySimplePU(1, this, "op");
        this.__fin = new ObservedPropertySimplePU('', this, "fin");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: AnimDemo_Params) {
        if (params.w !== undefined) {
            this.w = params.w;
        }
        if (params.op !== undefined) {
            this.op = params.op;
        }
        if (params.fin !== undefined) {
            this.fin = params.fin;
        }
    }
    updateStateVars(params: AnimDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__w.purgeDependencyOnElmtId(rmElmtId);
        this.__op.purgeDependencyOnElmtId(rmElmtId);
        this.__fin.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__w.aboutToBeDeleted();
        this.__op.aboutToBeDeleted();
        this.__fin.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __w: ObservedPropertySimplePU<number>;
    get w() {
        return this.__w.get();
    }
    set w(newValue: number) {
        this.__w.set(newValue);
    }
    private __op: ObservedPropertySimplePU<number>;
    get op() {
        return this.__op.get();
    }
    set op(newValue: number) {
        this.__op.set(newValue);
    }
    private __fin: ObservedPropertySimplePU<string>;
    get fin() {
        return this.__fin.get();
    }
    set fin(newValue: string) {
        this.__fin.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.width('100%');
            Column.height('100%');
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.width(this.w);
            Row.height(20);
            Row.backgroundColor('#3366cc');
            Row.id('box');
        }, Row);
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('w=' + this.w);
            Text.id('w');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('op=' + this.op);
            Text.id('op');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('fin=' + this.fin);
            Text.id('fin');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('anim');
            Button.id('btn-anim');
            Button.onClick(() => {
                // ① duration>0：动画窗口包住状态变更；onFinish 要真的被调
                Context.animateTo({
                    duration: 300, curve: Curve.EaseInOut, delay: 0,
                    onFinish: () => { this.fin = this.fin + 'A;'; }
                }, () => {
                    this.w = 220;
                    this.op = 0.5;
                });
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('zero');
            Button.id('btn-zero');
            Button.onClick(() => {
                // ② duration: 0 —— 目标值要变，但【不进动画】（不带 transition）
                Context.animateTo({
                    duration: 0,
                    onFinish: () => { this.fin = this.fin + 'Z;'; }
                }, () => {
                    this.op = 0.8;
                });
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('imm');
            Button.id('btn-imm');
            Button.onClick(() => {
                // ③ animateToImmediately（.d.ts since 12）
                Context.animateToImmediately({
                    duration: 250, curve: Curve.Linear,
                    onFinish: () => { this.fin = this.fin + 'I;'; }
                }, () => {
                    this.w = 260;
                });
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('loop');
            Button.id('btn-loop');
            Button.onClick(() => {
                // ④ CSS transition 表达不了的参数（iterations/playMode）—— 必须出声，不能静默
                Context.animateTo({
                    duration: 200, iterations: 3, playMode: PlayMode.Alternate
                }, () => {
                    this.w = 300;
                });
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('delay');
            Button.id('btn-delay');
            Button.onClick(() => {
                // ⑤ delay 要真的进 transition-delay
                Context.animateTo({ duration: 150, delay: 120, curve: Curve.Linear }, () => {
                    this.op = 0.2;
                });
            });
        }, Button);
        Button.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "AnimDemo";
    }
}
registerNamedRoute(() => new AnimDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/AnimDemo", pageFullPath: "entry/src/main/ets/pages/AnimDemo", integratedHsp: "false", moduleType: "followWithHap" });
