if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface BatchLayoutDemo_Params {
    log?: string;
    foldLog?: string;
    hoverLog?: string;
    node?: BatchNode;
}
class BatchNode extends XComponentNode {
    fired: number;
    constructor(uiContext: UIContext) {
        super(uiContext, {}, 'batch-xcn', XComponentType.NODE, '');
        this.fired = 0;
    }
    onCreate(): void {
        this.fired = this.fired + 1;
    }
    onDestroy(): void {
        this.fired = this.fired - 1;
    }
}
class BatchLayoutDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.__foldLog = new ObservedPropertySimplePU('', this, "foldLog");
        this.__hoverLog = new ObservedPropertySimplePU('', this, "hoverLog");
        this.node = null;
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: BatchLayoutDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.foldLog !== undefined) {
            this.foldLog = params.foldLog;
        }
        if (params.hoverLog !== undefined) {
            this.hoverLog = params.hoverLog;
        }
        if (params.node !== undefined) {
            this.node = params.node;
        }
    }
    updateStateVars(params: BatchLayoutDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
        this.__foldLog.purgeDependencyOnElmtId(rmElmtId);
        this.__hoverLog.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
        this.__foldLog.aboutToBeDeleted();
        this.__hoverLog.aboutToBeDeleted();
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
    private __foldLog: ObservedPropertySimplePU<string>;
    get foldLog() {
        return this.__foldLog.get();
    }
    set foldLog(newValue: string) {
        this.__foldLog.set(newValue);
    }
    private __hoverLog: ObservedPropertySimplePU<string>;
    get hoverLog() {
        return this.__hoverLog.get();
    }
    set hoverLog(newValue: string) {
        this.__hoverLog.set(newValue);
    }
    private node: BatchNode | null;
    aboutToAppear(): void {
        this.node = new BatchNode(this.getUIContext());
        const node = this.node;
        const okTexture: boolean = node.changeRenderType(NodeRenderType.RENDER_TYPE_TEXTURE);
        const okInvalid: boolean = node.changeRenderType(9);
        this.log = 'rt=' + (okTexture ? '1' : '0') + ',bad=' + (okInvalid ? '1' : '0') + ';';
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            FolderStack.create({ upperItems: ['fs-upper'] });
            FolderStack.id('fs');
            FolderStack.alignContent(Alignment.Center);
            FolderStack.enableAnimation(false);
            FolderStack.autoHalfFold(true);
            FolderStack.onFolderStateChange((e: OnFoldStatusChangeInfo) => {
                this.foldLog = this.foldLog + 'F' + e.foldStatus + ';';
            });
            FolderStack.onHoverStatusChange((p: HoverEventParam) => {
                this.hoverLog = this.hoverLog + 'H' + (p.isHoverMode ? '1' : '0') + ';';
            });
        }, FolderStack);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('upper');
            Text.id('fs-upper');
            Text.width('80%');
            Text.height(60);
            Text.backgroundColor('#c8e6c9');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('lower');
            Text.width('80%');
            Text.height(60);
            Text.backgroundColor('#ffcdd2');
        }, Text);
        Text.pop();
        FolderStack.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            GridContainer.create({ columns: 4, sizeType: SizeType.SM, gutter: 8, margin: 12 });
            GridContainer.id('gc');
        }, GridContainer);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('c0');
            Text.backgroundColor('#bbdefb');
            Text.height(40);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('c1');
            Text.backgroundColor('#bbdefb');
            Text.height(40);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('c2');
            Text.backgroundColor('#bbdefb');
            Text.height(40);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('c3');
            Text.backgroundColor('#bbdefb');
            Text.height(40);
        }, Text);
        Text.pop();
        GridContainer.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('xcn-log');
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.foldLog);
            Text.id('fs-fold-log');
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.hoverLog);
            Text.id('fs-hover-log');
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
        return "BatchLayoutDemo";
    }
}
registerNamedRoute(() => new BatchLayoutDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/BatchLayoutDemo", pageFullPath: "entry/src/main/ets/pages/BatchLayoutDemo", integratedHsp: "false", moduleType: "followWithHap" });
