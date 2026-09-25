if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface PanelDemo_Params {
    log?: string;
    hVal?: number;
}
class PanelDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.__hVal = new ObservedPropertySimplePU(0, this, "hVal");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: PanelDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.hVal !== undefined) {
            this.hVal = params.hVal;
        }
    }
    updateStateVars(params: PanelDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
        this.__hVal.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
        this.__hVal.aboutToBeDeleted();
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
    private __hVal: ObservedPropertySimplePU<number>;
    get hVal() {
        return this.__hVal.get();
    }
    set hVal(newValue: number) {
        this.__hVal.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Panel.create(true);
            Panel.id('pn');
            Panel.mode(PanelMode.Half);
            Panel.dragBar(true);
            Panel.onChange((mode: PanelMode) => {
                this.log = this.log + 'M' + mode + ';';
            });
            Panel.onHeightChange((h: number) => {
                this.hVal = h;
            });
        }, Panel);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('panel body');
            Text.id('pn-body');
        }, Text);
        Text.pop();
        Panel.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('h=' + this.hVal);
            Text.id('pn-h');
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('pn-log');
            Text.fontSize(12);
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
        return "PanelDemo";
    }
}
registerNamedRoute(() => new PanelDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/PanelDemo", pageFullPath: "entry/src/main/ets/pages/PanelDemo", integratedHsp: "false", moduleType: "followWithHap" });
