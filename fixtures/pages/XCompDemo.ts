if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface XCompDemo_Params {
    log?: string;
    controller?: XComponentController;
}
class XCompDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.controller = new XComponentController();
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: XCompDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.controller !== undefined) {
            this.controller = params.controller;
        }
    }
    updateStateVars(params: XCompDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
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
    private controller: XComponentController;
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            XComponent.create({ id: 'xc-main', type: XComponentType.SURFACE, controller: this.controller }, "com.example.arkuidomprobe/entry");
            XComponent.id('xc-main');
            XComponent.width(300);
            XComponent.height(200);
            XComponent.onLoad(() => {
                this.log = this.log + 'LOAD' + (this.controller.getXComponentSurfaceId().length > 0 ? 1 : 0) + ';';
            });
            XComponent.onDestroy(() => { this.log = this.log + 'DES;'; });
        }, XComponent);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('rect');
            Button.id('rect-btn');
            Button.onClick(() => {
                this.controller.setXComponentSurfaceRect({ offsetX: 0, offsetY: 0, surfaceWidth: 320, surfaceHeight: 240 });
                const r = this.controller.getXComponentSurfaceRect();
                this.log = this.log + 'RECT' + r.surfaceWidth + 'x' + r.surfaceHeight + ';';
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('probe');
            Button.id('probe-btn');
            Button.onClick(() => {
                // 默认 rect = 组件实际尺寸（JSDoc：不调用 set 时返回组件尺寸）
                const r = this.controller.getXComponentSurfaceRect();
                this.log = this.log + 'DEF' + r.surfaceWidth + 'x' + r.surfaceHeight + ';';
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('xc-log');
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
        return "XCompDemo";
    }
}
registerNamedRoute(() => new XCompDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/XCompDemo", pageFullPath: "entry/src/main/ets/pages/XCompDemo", integratedHsp: "false", moduleType: "followWithHap" });
