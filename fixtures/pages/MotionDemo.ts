if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface MotionDemo_Params {
    log?: string;
    scrollerA?: Scroller;
    scrollerB?: Scroller;
    scrollerC?: Scroller;
}
class MotionDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.scrollerA = new Scroller();
        this.scrollerB = new Scroller();
        this.scrollerC = new Scroller();
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: MotionDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.scrollerA !== undefined) {
            this.scrollerA = params.scrollerA;
        }
        if (params.scrollerB !== undefined) {
            this.scrollerB = params.scrollerB;
        }
        if (params.scrollerC !== undefined) {
            this.scrollerC = params.scrollerC;
        }
    }
    updateStateVars(params: MotionDemo_Params) {
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
    private scrollerA: Scroller;
    private scrollerB: Scroller;
    private scrollerC: Scroller;
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 12 });
            Column.width('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Stack.create();
        }, Stack);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Scroll.create(this.scrollerA);
            Scroll.id('sc-a');
            Scroll.width(200);
            Scroll.height(160);
            Scroll.scrollBar(BarState.Off);
        }, Scroll);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('A-0');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('A-1');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('A-2');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('A-3');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('A-4');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('A-5');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('A-6');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('A-7');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        Column.pop();
        Scroll.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ScrollBar.create({ scroller: this.scrollerA, direction: ScrollBarDirection.Vertical, state: BarState.On });
            ScrollBar.id('sb-a');
            ScrollBar.width(20);
            ScrollBar.height(160);
            ScrollBar.backgroundColor('#ededed');
            ScrollBar.enableNestedScroll(true);
        }, ScrollBar);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create();
            Text.width(16);
            Text.height(48);
            Text.borderRadius(8);
            Text.backgroundColor('#C0C0C0');
        }, Text);
        Text.pop();
        ScrollBar.pop();
        Stack.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Stack.create();
        }, Stack);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Scroll.create(this.scrollerB);
            Scroll.id('sc-b');
            Scroll.width(200);
            Scroll.height(120);
            Scroll.scrollBar(BarState.Off);
        }, Scroll);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('B-0');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('B-1');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('B-2');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('B-3');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('B-4');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        Column.pop();
        Scroll.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ScrollBar.create({ scroller: this.scrollerB, direction: ScrollBarDirection.Vertical, state: BarState.On });
            ScrollBar.id('sb-b');
            ScrollBar.width(12);
            ScrollBar.height(120);
            ScrollBar.enableNestedScroll(true);
        }, ScrollBar);
        ScrollBar.pop();
        Stack.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Stack.create();
        }, Stack);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Scroll.create(this.scrollerC);
            Scroll.id('sc-c');
            Scroll.width(200);
            Scroll.height(100);
            Scroll.scrollBar(BarState.Off);
        }, Scroll);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('C-0');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('C-1');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('C-2');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        Column.pop();
        Scroll.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ScrollBar.create({ scroller: this.scrollerC, direction: ScrollBarDirection.Vertical, state: BarState.Off });
            ScrollBar.id('sb-c');
            ScrollBar.width(12);
            ScrollBar.height(100);
        }, ScrollBar);
        ScrollBar.pop();
        Stack.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('md-log');
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
        return "MotionDemo";
    }
}
registerNamedRoute(() => new MotionDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/MotionDemo", pageFullPath: "entry/src/main/ets/pages/MotionDemo", integratedHsp: "false", moduleType: "followWithHap" });
