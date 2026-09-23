if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface ImageDemo_Params {
    log?: string;
}
class ImageDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: ImageDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
    }
    updateStateVars(params: ImageDemo_Params) {
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
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ① objectFit 两档对照：7:3 的图放进 2:1 的框
            Image.create('/test-assets/known-7x3.png');
            // ① objectFit 两档对照：7:3 的图放进 2:1 的框
            Image.id('im1');
            // ① objectFit 两档对照：7:3 的图放进 2:1 的框
            Image.width(120);
            // ① objectFit 两档对照：7:3 的图放进 2:1 的框
            Image.height(60);
            // ① objectFit 两档对照：7:3 的图放进 2:1 的框
            Image.objectFit(ImageFit.Contain);
        }, Image);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Image.create('/test-assets/known-7x3.png');
            Image.id('im2');
            Image.width(120);
            Image.height(60);
            Image.objectFit(ImageFit.Cover);
        }, Image);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ② 404 图：onError 派发 + alt 占位顶上
            Image.create('/test-assets/does-not-exist.png');
            // ② 404 图：onError 派发 + alt 占位顶上
            Image.id('im3');
            // ② 404 图：onError 派发 + alt 占位顶上
            Image.width(60);
            // ② 404 图：onError 派发 + alt 占位顶上
            Image.height(60);
            // ② 404 图：onError 派发 + alt 占位顶上
            Image.alt('/test-assets/known-1x1.png');
            // ② 404 图：onError 派发 + alt 占位顶上
            Image.onError(() => {
                this.log = this.log + 'ERR;';
            });
        }, Image);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ③ onComplete：真实解码尺寸进载荷（known-13x5.png = 13×5）
            Image.create('/test-assets/known-13x5.png');
            // ③ onComplete：真实解码尺寸进载荷（known-13x5.png = 13×5）
            Image.id('im4');
            // ③ onComplete：真实解码尺寸进载荷（known-13x5.png = 13×5）
            Image.width(100);
            // ③ onComplete：真实解码尺寸进载荷（known-13x5.png = 13×5）
            Image.height(50);
            // ③ onComplete：真实解码尺寸进载荷（known-13x5.png = 13×5）
            Image.syncLoad(true);
            // ③ onComplete：真实解码尺寸进载荷（known-13x5.png = 13×5）
            Image.onComplete((msg) => {
                if (msg) {
                    this.log = this.log + 'C' + msg.width + 'x' + msg.height + ';';
                }
            });
        }, Image);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('im-log');
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
        return "ImageDemo";
    }
}
registerNamedRoute(() => new ImageDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/ImageDemo", pageFullPath: "entry/src/main/ets/pages/ImageDemo", integratedHsp: "false", moduleType: "followWithHap" });
