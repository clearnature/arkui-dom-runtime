if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface BatchVerifyDemo_Params {
    webCtrl?: WebController;
    scroller?: Scroller;
}
class BatchVerifyDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.webCtrl = new WebController();
        this.scroller = new Scroller();
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: BatchVerifyDemo_Params) {
        if (params.webCtrl !== undefined) {
            this.webCtrl = params.webCtrl;
        }
        if (params.scroller !== undefined) {
            this.scroller = params.scroller;
        }
    }
    updateStateVars(params: BatchVerifyDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
    }
    aboutToBeDeleted() {
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private webCtrl: WebController;
    private scroller: Scroller;
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // A: FolderStack + GridContainer
            FolderStack.create();
            // A: FolderStack + GridContainer
            FolderStack.id('v-fs-w');
        }, FolderStack);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('fs');
            Text.id('v-fs');
        }, Text);
        Text.pop();
        // A: FolderStack + GridContainer
        FolderStack.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            GridContainer.create();
            GridContainer.id('v-gc-w');
        }, GridContainer);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('gc');
            Text.id('v-gc');
        }, Text);
        Text.pop();
        GridContainer.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // B: PatternLock
            PatternLock.create();
            // B: PatternLock
            PatternLock.id('v-pl');
        }, PatternLock);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // C: 文本系（编译器强制的嵌套约束）
            Text.create();
            // C: 文本系（编译器强制的嵌套约束）
            Text.id('v-cs-text');
        }, Text);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ContainerSpan.create();
        }, ContainerSpan);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ImageSpan.create('/test-assets/test.png');
        }, ImageSpan);
        ContainerSpan.pop();
        // C: 文本系（编译器强制的嵌套约束）
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            RichText.create('<b>rt</b>');
            RichText.id('v-rt');
        }, RichText);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create();
            Text.id('v-ss-text');
        }, Text);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            SymbolSpan.create({ "id": 125830649, "type": 40000, params: [], "bundleName": "com.example.arkuidomprobe", "moduleName": "entry" });
        }, SymbolSpan);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Web.create({ src: 'about:blank', controller: this.webCtrl });
            Web.id('v-web');
        }, Web);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // D: NavRouter + Navigator
            NavRouter.create();
            // D: NavRouter + Navigator
            NavRouter.id('v-nr-w');
        }, NavRouter);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('nr');
            Text.id('v-nr');
        }, Text);
        Text.pop();
        // D: NavRouter + Navigator
        NavRouter.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Navigator.create();
            Navigator.id('v-nav');
        }, Navigator);
        Navigator.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // E: ScrollBar（scroller 必填）
            ScrollBar.create({ scroller: this.scroller });
            // E: ScrollBar（scroller 必填）
            ScrollBar.id('v-sb');
        }, ScrollBar);
        // E: ScrollBar（scroller 必填）
        ScrollBar.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // F: MenuItemGroup（子只能 MenuItem）+ WithTheme（无 universal .id）
            MenuItemGroup.create({ header: 'grp' });
            // F: MenuItemGroup（子只能 MenuItem）+ WithTheme（无 universal .id）
            MenuItemGroup.id('v-mig-w');
        }, MenuItemGroup);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            MenuItem.create({ content: 'mi1' });
            MenuItem.id('v-mig-1');
        }, MenuItem);
        MenuItem.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            MenuItem.create({ content: 'mi2' });
            MenuItem.id('v-mig-2');
        }, MenuItem);
        MenuItem.pop();
        // F: MenuItemGroup（子只能 MenuItem）+ WithTheme（无 universal .id）
        MenuItemGroup.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            WithTheme.create({});
        }, WithTheme);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('wt');
            Text.id('v-wt');
        }, Text);
        Text.pop();
        WithTheme.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "BatchVerifyDemo";
    }
}
registerNamedRoute(() => new BatchVerifyDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/BatchVerifyDemo", pageFullPath: "entry/src/main/ets/pages/BatchVerifyDemo", integratedHsp: "false", moduleType: "followWithHap" });
