if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface CanvasDemo_Params {
    log?: string;
    settings?: RenderingContextSettings;
    context?: CanvasRenderingContext2D;
}
class CanvasDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.settings = new RenderingContextSettings(true);
        this.context = new CanvasRenderingContext2D(this.settings);
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: CanvasDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.settings !== undefined) {
            this.settings = params.settings;
        }
        if (params.context !== undefined) {
            this.context = params.context;
        }
    }
    updateStateVars(params: CanvasDemo_Params) {
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
    private settings: RenderingContextSettings;
    private context: CanvasRenderingContext2D;
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Canvas.create(this.context);
            Canvas.id('cv1');
            Canvas.width(200);
            Canvas.height(100);
            Canvas.onReady(() => {
                // 像素断言的两块矩形：红块与绿块（坐标钉在测试里）
                this.context.fillStyle = '#ff0000';
                this.context.fillRect(10, 20, 30, 40);
                this.context.fillStyle = '#00cc00';
                this.context.fillRect(100, 10, 20, 20);
                this.log = this.log + 'RDY;';
            });
        }, Canvas);
        Canvas.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('probe');
            Button.id('probe-btn');
            Button.onClick(() => {
                // getImageData 读回像素（填充区/背景区各采一点）
                const r = this.context.getImageData(15, 25, 1, 1);
                this.log = this.log + 'R' + r.data[0] + '/' + r.data[1] + '/' + r.data[2] + ';';
                const g = this.context.getImageData(110, 15, 1, 1);
                this.log = this.log + 'G' + g.data[1] + ';';
                const url = this.context.toDataURL();
                this.log = this.log + 'URL' + (url.indexOf('data:image/png;base64,') === 0 ? 1 : 0) + ';';
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('cv-log');
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
        return "CanvasDemo";
    }
}
registerNamedRoute(() => new CanvasDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/CanvasDemo", pageFullPath: "entry/src/main/ets/pages/CanvasDemo", integratedHsp: "false", moduleType: "followWithHap" });
