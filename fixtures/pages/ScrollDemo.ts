if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface ScrollDemo_Params {
    log?: string;
    scroller?: Scroller;
}
class ScrollDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.scroller = new Scroller();
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: ScrollDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.scroller !== undefined) {
            this.scroller = params.scroller;
        }
    }
    updateStateVars(params: ScrollDemo_Params) {
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
    private scroller: Scroller;
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Scroll.create(this.scroller);
            Scroll.id('sc1');
            Scroll.width(240);
            Scroll.height(200);
            Scroll.scrollable(ScrollDirection.Vertical);
            Scroll.scrollBar(BarState.Off);
            Scroll.edgeEffect(EdgeEffect.None);
            Scroll.onScroll((xOffset: number, yOffset: number) => {
                this.log = this.log + 'S' + Math.round(yOffset) + ';';
            });
            Scroll.onScrollEdge((side: Edge) => {
                this.log = this.log + 'E:' + side + ';';
            });
            Scroll.onScrollEnd(() => {
                this.log = this.log + 'END;';
            });
        }, Scroll);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 0 });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('row-0');
            Text.id('r0');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('row-1');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('row-2');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('row-3');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('row-4');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('row-5');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('row-6');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('row-7');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('row-8');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('row-9');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('row-10');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('row-11');
            Text.id('r11');
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
        Column.pop();
        Scroll.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('toBottom');
            Button.id('btn-b');
            Button.onClick(() => {
                this.scroller.scrollTo({ xOffset: 0, yOffset: 9999 });
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('by60');
            Button.id('btn-by');
            Button.onClick(() => {
                this.scroller.scrollBy(0, 60);
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('toTop');
            Button.id('btn-t');
            Button.onClick(() => {
                this.scroller.scrollEdge(Edge.Top);
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('where');
            Button.id('btn-w');
            Button.onClick(() => {
                const o = this.scroller.currentOffset();
                this.log = this.log + '@' + Math.round(o.yOffset) + ';';
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('sc-log');
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
        return "ScrollDemo";
    }
}
registerNamedRoute(() => new ScrollDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/ScrollDemo", pageFullPath: "entry/src/main/ets/pages/ScrollDemo", integratedHsp: "false", moduleType: "followWithHap" });
