if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface GridRowDemo_Params {
}
class GridRowDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: GridRowDemo_Params) {
    }
    updateStateVars(params: GridRowDemo_Params) {
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
            GridRow.create({ columns: 12, gutter: 8 });
            GridRow.id('gr');
            GridRow.width('100%');
        }, GridRow);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            GridCol.create({ span: 6 });
        }, GridCol);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('a');
            Text.id('gc-a');
        }, Text);
        Text.pop();
        GridCol.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            GridCol.create({ span: 6 });
        }, GridCol);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('b');
            Text.id('gc-b');
        }, Text);
        Text.pop();
        GridCol.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            GridCol.create({ span: 4 });
        }, GridCol);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('c');
            Text.id('gc-c');
        }, Text);
        Text.pop();
        GridCol.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            GridCol.create({ span: 4 });
        }, GridCol);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('d');
            Text.id('gc-d');
        }, Text);
        Text.pop();
        GridCol.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            GridCol.create({ span: 4 });
        }, GridCol);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('e');
            Text.id('gc-e');
        }, Text);
        Text.pop();
        GridCol.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            GridCol.create({ span: 12 });
        }, GridCol);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('f');
            Text.id('gc-f');
        }, Text);
        Text.pop();
        GridCol.pop();
        GridRow.pop();
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
        return "GridRowDemo";
    }
}
registerNamedRoute(() => new GridRowDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/GridRowDemo", pageFullPath: "entry/src/main/ets/pages/GridRowDemo", integratedHsp: "false", moduleType: "followWithHap" });
