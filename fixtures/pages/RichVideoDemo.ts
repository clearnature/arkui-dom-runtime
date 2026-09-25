if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface RichVideoDemo_Params {
    log?: string;
    controller?: VideoController;
    richCtrl?: RichEditorController;
}
class RichVideoDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.controller = new VideoController();
        this.richCtrl = new RichEditorController();
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: RichVideoDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.controller !== undefined) {
            this.controller = params.controller;
        }
        if (params.richCtrl !== undefined) {
            this.richCtrl = params.richCtrl;
        }
    }
    updateStateVars(params: RichVideoDemo_Params) {
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
    private controller: VideoController;
    private richCtrl: RichEditorController;
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            RichEditor.create({ controller: this.richCtrl });
            RichEditor.id('re');
            RichEditor.placeholder('edit here');
            RichEditor.onReady(() => {
                this.log = this.log + 'RD;';
            });
        }, RichEditor);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Video.create({ controller: this.controller });
            Video.id('vd');
            Video.controls(false);
            Video.autoPlay(false);
            Video.muted(true);
        }, Video);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('rv-log');
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
        return "RichVideoDemo";
    }
}
registerNamedRoute(() => new RichVideoDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/RichVideoDemo", pageFullPath: "entry/src/main/ets/pages/RichVideoDemo", integratedHsp: "false", moduleType: "followWithHap" });
