if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface SmallDemo_Params {
}
class SmallDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: SmallDemo_Params) {
    }
    updateStateVars(params: SmallDemo_Params) {
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
            Flex.create({ direction: FlexDirection.Row, justifyContent: FlexAlign.SpaceBetween, alignItems: ItemAlign.Center });
            Flex.id('fx1');
            Flex.width(200);
            Flex.backgroundColor('#f0f0f0');
        }, Flex);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('L');
            Text.id('fx-l');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Blank.create();
            Blank.id('fx-blank');
        }, Blank);
        Blank.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('R');
            Text.id('fx-r');
        }, Text);
        Text.pop();
        Flex.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create();
            Text.id('tx1');
        }, Text);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Span.create('normal');
        }, Span);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Span.create(' red');
            Span.id('sp1');
            Span.fontColor(Color.Red);
            Span.fontSize(18);
        }, Span);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Span.create(' under');
            Span.id('sp2');
            Span.decoration({ type: TextDecorationType.Underline, color: Color.Blue });
        }, Span);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            LoadingProgress.create();
            LoadingProgress.id('lp1');
            LoadingProgress.width(48);
            LoadingProgress.height(48);
            LoadingProgress.color(Color.Blue);
        }, LoadingProgress);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Blank.create();
            Blank.id('bk1');
            Blank.color('#00ff00');
        }, Blank);
        Blank.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "SmallDemo";
    }
}
registerNamedRoute(() => new SmallDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/SmallDemo", pageFullPath: "entry/src/main/ets/pages/SmallDemo", integratedHsp: "false", moduleType: "followWithHap" });
