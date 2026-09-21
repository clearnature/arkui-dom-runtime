if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface QrDemo_Params {
}
class QrDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: QrDemo_Params) {
    }
    updateStateVars(params: QrDemo_Params) {
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
            QRCode.create('https://example.com/qr-test-123');
            QRCode.id('qr1');
            QRCode.width(180);
            QRCode.height(180);
        }, QRCode);
        QRCode.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 含非 ASCII（UTF-8 多字节）与数字：字节模式编码的对照
            QRCode.create('你好 QR 码 123');
            // 含非 ASCII（UTF-8 多字节）与数字：字节模式编码的对照
            QRCode.id('qr2');
            // 含非 ASCII（UTF-8 多字节）与数字：字节模式编码的对照
            QRCode.width(160);
            // 含非 ASCII（UTF-8 多字节）与数字：字节模式编码的对照
            QRCode.height(160);
        }, QRCode);
        // 含非 ASCII（UTF-8 多字节）与数字：字节模式编码的对照
        QRCode.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 颜色定制
            QRCode.create('https://example.com/colored');
            // 颜色定制
            QRCode.id('qr3');
            // 颜色定制
            QRCode.width(160);
            // 颜色定制
            QRCode.height(160);
            // 颜色定制
            QRCode.color('#1234aa');
            // 颜色定制
            QRCode.backgroundColor('#eeeeff');
        }, QRCode);
        // 颜色定制
        QRCode.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "QrDemo";
    }
}
registerNamedRoute(() => new QrDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/QrDemo", pageFullPath: "entry/src/main/ets/pages/QrDemo", integratedHsp: "false", moduleType: "followWithHap" });
