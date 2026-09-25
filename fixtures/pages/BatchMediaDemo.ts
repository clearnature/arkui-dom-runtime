if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface BatchMediaDemo_Params {
    log?: string;
    webCtrl?: WebController;
}
class BatchMediaDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.webCtrl = new WebController();
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: BatchMediaDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.webCtrl !== undefined) {
            this.webCtrl = params.webCtrl;
        }
    }
    updateStateVars(params: BatchMediaDemo_Params) {
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
    private webCtrl: WebController;
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.padding(8);
        }, Column);
        // ① 内联族：ContainerSpan（背景圆角包裹）+ ImageSpan（内联图）+ SymbolSpan（内联符号）
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create();
            Text.id('t1');
            Text.fontSize(14);
        }, Text);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ContainerSpan.create();
            ContainerSpan.id('cs1');
            ContainerSpan.textBackgroundStyle({ color: '#ffe0b2', radius: 6 });
        }, ContainerSpan);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Span.create('A');
        }, Span);
        Span.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ImageSpan.create('/test-assets/known-7x3.png');
            ImageSpan.id('is1');
            ImageSpan.width(40);
            ImageSpan.height(24);
            ImageSpan.verticalAlign(ImageSpanAlignment.CENTER);
            ImageSpan.objectFit(ImageFit.Contain);
            ImageSpan.onComplete((res) => {
                this.log = this.log + 'IC' + res.width + 'x' + res.height + ';';
            });
        }, ImageSpan);
        ImageSpan.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            SymbolSpan.create($r('sys.symbol.ohos_star'));
            SymbolSpan.id('ss1');
            SymbolSpan.fontSize(20);
        }, SymbolSpan);
        SymbolSpan.pop();
        ContainerSpan.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Span.create('B');
        }, Span);
        Span.pop();
        Text.pop();
        // ② 独立符号图标
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            SymbolGlyph.create($r('sys.symbol.ohos_wifi'));
            SymbolGlyph.id('sg1');
            SymbolGlyph.fontSize(24);
            SymbolGlyph.fontColor(['#ff0000']);
            SymbolGlyph.renderingStrategy(SymbolRenderingStrategy.SINGLE);
            SymbolGlyph.effectStrategy(SymbolEffectStrategy.SCALE);
        }, SymbolGlyph);
        SymbolGlyph.pop();
        // ③ HTML 内容独立渲染
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            RichText.create('<p id="rt-p">hi</p>');
            RichText.id('rt1');
            RichText.width('100%');
            RichText.height(48);
            RichText.onStart(() => {
                this.log = this.log + 'RS;';
            });
            RichText.onComplete(() => {
                this.log = this.log + 'RC;';
            });
        }, RichText);
        RichText.pop();
        // ④ Web 页面加载 + 控制器
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Web.create({ src: '/test-assets/web-probe.html', controller: this.webCtrl });
            Web.id('wb1');
            Web.width('100%');
            Web.height(80);
            Web.onPageBegin(() => {
                this.log = this.log + 'WB;';
            });
            Web.onPageEnd(() => {
                this.log = this.log + 'WE;';
            });
            Web.onTitleReceive((e) => {
                this.log = this.log + 'WT' + e.title + ';';
            });
            Web.onControllerAttached(() => {
                const r = this.webCtrl.runJavaScript('1+1');
                this.log = this.log + 'WJ' + r + ';';
            });
        }, Web);
        Web.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('bm-log');
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
        return "BatchMediaDemo";
    }
}
registerNamedRoute(() => new BatchMediaDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/BatchMediaDemo", pageFullPath: "entry/src/main/ets/pages/BatchMediaDemo", integratedHsp: "false", moduleType: "followWithHap" });
