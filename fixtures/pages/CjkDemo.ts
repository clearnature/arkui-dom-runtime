if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface CjkDemo_Params {
    sum?: number;
    fibN?: number;
    echoText?: string;
    kernelMode?: string;
}
import cjk from "@ohos:cjk";
class CjkDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__sum = new ObservedPropertySimplePU(0, this, "sum");
        this.__fibN = new ObservedPropertySimplePU(0, this, "fibN");
        this.__echoText = new ObservedPropertySimplePU('', this, "echoText");
        this.__kernelMode = new ObservedPropertySimplePU('checking', this, "kernelMode");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: CjkDemo_Params) {
        if (params.sum !== undefined) {
            this.sum = params.sum;
        }
        if (params.fibN !== undefined) {
            this.fibN = params.fibN;
        }
        if (params.echoText !== undefined) {
            this.echoText = params.echoText;
        }
        if (params.kernelMode !== undefined) {
            this.kernelMode = params.kernelMode;
        }
    }
    updateStateVars(params: CjkDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__sum.purgeDependencyOnElmtId(rmElmtId);
        this.__fibN.purgeDependencyOnElmtId(rmElmtId);
        this.__echoText.purgeDependencyOnElmtId(rmElmtId);
        this.__kernelMode.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__sum.aboutToBeDeleted();
        this.__fibN.aboutToBeDeleted();
        this.__echoText.aboutToBeDeleted();
        this.__kernelMode.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __sum: ObservedPropertySimplePU<number>;
    get sum() {
        return this.__sum.get();
    }
    set sum(newValue: number) {
        this.__sum.set(newValue);
    }
    private __fibN: ObservedPropertySimplePU<number>;
    get fibN() {
        return this.__fibN.get();
    }
    set fibN(newValue: number) {
        this.__fibN.set(newValue);
    }
    private __echoText: ObservedPropertySimplePU<string>;
    get echoText() {
        return this.__echoText.get();
    }
    set echoText(newValue: string) {
        this.__echoText.set(newValue);
    }
    private __kernelMode: ObservedPropertySimplePU<string>;
    get kernelMode() {
        return this.__kernelMode.get();
    }
    set kernelMode(newValue: string) {
        this.__kernelMode.set(newValue);
    }
    aboutToAppear(): void {
        this.runKernel();
    }
    async runKernel(): Promise<void> {
        const available: boolean = await cjk.isAvailable();
        if (!available) {
            this.kernelMode = 'degraded';
            return;
        }
        this.kernelMode = 'kernel-live';
        this.sum = await cjk.add(20, 22);
        const f = await cjk.call('fib', { n: 12 });
        if (f !== null) {
            const v: number = Number(f['result']);
            if (!Number.isNaN(v)) {
                this.fibN = v;
            }
        }
        this.echoText = await cjk.echo('arkts-to-cangjie');
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.padding(12);
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('R108 CjkDemo');
            Text.fontSize(16);
            Text.fontWeight(FontWeight.Bold);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.kernelMode);
            Text.id('kernel-mode');
            Text.fontSize(14);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('sum=' + this.sum);
            Text.id('sum-out');
            Text.fontSize(14);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('fib=' + this.fibN);
            Text.id('fib-out');
            Text.fontSize(14);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('echo=' + this.echoText);
            Text.id('echo-out');
            Text.fontSize(14);
        }, Text);
        Text.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "CjkDemo";
    }
}
registerNamedRoute(() => new CjkDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/CjkDemo", pageFullPath: "entry/src/main/ets/pages/CjkDemo", integratedHsp: "false", moduleType: "followWithHap" });
