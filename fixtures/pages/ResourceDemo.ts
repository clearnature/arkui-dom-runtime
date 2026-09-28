if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface ResourceDemo_Params {
    slog?: string;
    resMgr?: resourceManager.ResourceManager;
}
import type resourceManager from "@ohos:resourceManager";
class ResourceDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__slog = new ObservedPropertySimplePU('', this, "slog");
        this.resMgr = getContext().resourceManager;
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: ResourceDemo_Params) {
        if (params.slog !== undefined) {
            this.slog = params.slog;
        }
        if (params.resMgr !== undefined) {
            this.resMgr = params.resMgr;
        }
    }
    updateStateVars(params: ResourceDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__slog.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__slog.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __slog: ObservedPropertySimplePU<string>;
    get slog() {
        return this.__slog.get();
    }
    set slog(newValue: string) {
        this.__slog.set(newValue);
    }
    private resMgr: resourceManager.ResourceManager;
    aboutToAppear(): void {
        // 同步 API（resourceManager.d.ts 实测面）：字符串双形态 + 颜色(number) + 媒体
        const s1: string = this.resMgr.getStringByNameSync('res_hello');
        const s2: string = this.resMgr.getStringSync({ "id": 16777228, "type": 10003, params: [], "bundleName": "com.example.arkuidomprobe", "moduleName": "entry" });
        const c1: number = this.resMgr.getColorByNameSync('res_brand');
        const m1: Uint8Array = this.resMgr.getMediaByNameSync('startIcon');
        this.slog = s1 + '|' + s2 + '|' + c1 + '|' + m1.byteLength;
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.width('100%');
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create({ "id": 16777229, "type": 10003, params: [], "bundleName": "com.example.arkuidomprobe", "moduleName": "entry" });
            Text.fontSize(18);
            Text.id('t-str');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create({ "id": 16777228, "type": 10003, params: [], "bundleName": "com.example.arkuidomprobe", "moduleName": "entry" });
            Text.fontColor({ "id": 16777230, "type": 10001, params: [], "bundleName": "com.example.arkuidomprobe", "moduleName": "entry" });
            Text.id('t-color');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('float');
            Text.fontSize({ "id": 16777231, "type": 10002, params: [], "bundleName": "com.example.arkuidomprobe", "moduleName": "entry" });
            Text.id('t-float');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Image.create({ "id": 16777225, "type": 20000, params: [], "bundleName": "com.example.arkuidomprobe", "moduleName": "entry" });
            Image.width(32);
            Image.height(32);
            Image.id('img-media');
        }, Image);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.slog);
            Text.id('t-slog');
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
        return "ResourceDemo";
    }
}
registerNamedRoute(() => new ResourceDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/ResourceDemo", pageFullPath: "entry/src/main/ets/pages/ResourceDemo", integratedHsp: "false", moduleType: "followWithHap" });
