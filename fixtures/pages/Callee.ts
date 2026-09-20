if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface Callee_Params {
}
class Callee extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: Callee_Params) {
    }
    updateStateVars(params: Callee_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
    }
    aboutToBeDeleted() {
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.width('100%');
            Column.height('100%');
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('被启动的 ability 窗口');
            Text.id('calleeText');
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
        return "Callee";
    }
}
registerNamedRoute(() => new Callee(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/Callee", pageFullPath: "entry/src/main/ets/pages/Callee", integratedHsp: "false", moduleType: "followWithHap" });
