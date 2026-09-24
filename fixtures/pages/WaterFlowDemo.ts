if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface WaterFlowDemo_Params {
    log?: string;
    scroller?: Scroller;
}
class WaterFlowDemo extends ViewPU {
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
    setInitiallyProvidedValue(params: WaterFlowDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.scroller !== undefined) {
            this.scroller = params.scroller;
        }
    }
    updateStateVars(params: WaterFlowDemo_Params) {
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
            WaterFlow.create({ scroller: this.scroller });
            WaterFlow.id('wf');
            WaterFlow.width(240);
            WaterFlow.height(150);
            WaterFlow.columnsTemplate('1fr 1fr');
            WaterFlow.columnsGap(0);
            WaterFlow.rowsGap(0);
            WaterFlow.edgeEffect(EdgeEffect.None);
            WaterFlow.onScrollIndex((first: number, last: number) => {
                this.log = this.log + 'I' + first + ',' + last + ';';
            });
            WaterFlow.onReachStart(() => {
                this.log = this.log + 'RS;';
            });
            WaterFlow.onReachEnd(() => {
                this.log = this.log + 'RE;';
            });
            WaterFlow.onScroll((offset: number, state: ScrollState) => {
                this.log = this.log + 'D' + Math.round(offset) + ';';
            });
            WaterFlow.onScrollStart(() => {
                this.log = this.log + 'SS;';
            });
            WaterFlow.onScrollStop(() => {
                this.log = this.log + 'SE;';
            });
        }, WaterFlow);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            FlowItem.create();
            FlowItem.height(60);
            FlowItem.width(120);
        }, FlowItem);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('f0');
            Text.id('f0');
        }, Text);
        Text.pop();
        FlowItem.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            FlowItem.create();
            FlowItem.height(90);
            FlowItem.width(120);
        }, FlowItem);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('f1');
        }, Text);
        Text.pop();
        FlowItem.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            FlowItem.create();
            FlowItem.height(60);
            FlowItem.width(120);
        }, FlowItem);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('f2');
        }, Text);
        Text.pop();
        FlowItem.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            FlowItem.create();
            FlowItem.height(40);
            FlowItem.width(120);
        }, FlowItem);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('f3');
        }, Text);
        Text.pop();
        FlowItem.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            FlowItem.create();
            FlowItem.height(80);
            FlowItem.width(120);
        }, FlowItem);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('f4');
            Text.id('f4');
        }, Text);
        Text.pop();
        FlowItem.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            FlowItem.create();
            FlowItem.height(50);
            FlowItem.width(120);
        }, FlowItem);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('f5');
        }, Text);
        Text.pop();
        FlowItem.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            FlowItem.create();
            FlowItem.height(70);
            FlowItem.width(120);
        }, FlowItem);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('f6');
        }, Text);
        Text.pop();
        FlowItem.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            FlowItem.create();
            FlowItem.height(70);
            FlowItem.width(120);
        }, FlowItem);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('f7');
        }, Text);
        Text.pop();
        FlowItem.pop();
        WaterFlow.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('by60');
            Button.id('btn-by');
            Button.onClick(() => {
                this.scroller.scrollBy(0, 60);
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('idx4');
            Button.id('btn-idx');
            Button.onClick(() => {
                this.scroller.scrollToIndex(4);
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('toTop');
            Button.id('btn-top');
            Button.onClick(() => {
                this.scroller.scrollEdge(Edge.Top);
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('toBot');
            Button.id('btn-bot');
            Button.onClick(() => {
                this.scroller.scrollEdge(Edge.Bottom);
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
            Text.id('wf-log');
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
        return "WaterFlowDemo";
    }
}
registerNamedRoute(() => new WaterFlowDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/WaterFlowDemo", pageFullPath: "entry/src/main/ets/pages/WaterFlowDemo", integratedHsp: "false", moduleType: "followWithHap" });
