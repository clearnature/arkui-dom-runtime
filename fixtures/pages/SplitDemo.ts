if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface SplitDemo_Params {
}
class SplitDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: SplitDemo_Params) {
    }
    updateStateVars(params: SplitDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
    }
    aboutToBeDeleted() {
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            RowSplit.create();
            RowSplit.id('rs');
            RowSplit.width(240);
            RowSplit.height(60);
        }, RowSplit);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('L');
            Text.id('rs-l');
            Text.width(120);
            Text.height(60);
            Text.backgroundColor('#eef');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('R');
            Text.id('rs-r');
            Text.width(120);
            Text.height(60);
            Text.backgroundColor('#fee');
        }, Text);
        Text.pop();
        RowSplit.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ColumnSplit.create();
            ColumnSplit.id('cs');
            ColumnSplit.width(120);
            ColumnSplit.height(80);
        }, ColumnSplit);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('T');
            Text.id('cs-t');
            Text.width(120);
            Text.height(40);
            Text.backgroundColor('#efe');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('B');
            Text.id('cs-b');
            Text.width(120);
            Text.height(40);
            Text.backgroundColor('#ffe');
        }, Text);
        Text.pop();
        ColumnSplit.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('done');
            Text.id('done-marker');
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
        return "SplitDemo";
    }
}
registerNamedRoute(() => new SplitDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/SplitDemo", pageFullPath: "entry/src/main/ets/pages/SplitDemo", integratedHsp: "false", moduleType: "followWithHap" });
