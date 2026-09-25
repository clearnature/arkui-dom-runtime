if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface GridDemo_Params {
    log?: string;
    scroller?: Scroller;
}
class GridDemo extends ViewPU {
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
    setInitiallyProvidedValue(params: GridDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.scroller !== undefined) {
            this.scroller = params.scroller;
        }
    }
    updateStateVars(params: GridDemo_Params) {
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
            Grid.create(this.scroller);
            Grid.id('gd');
            Grid.width(240);
            Grid.height(150);
            Grid.columnsTemplate('1fr 1fr');
            Grid.columnsGap(0);
            Grid.rowsGap(0);
            Grid.scrollBar(BarState.Off);
            Grid.edgeEffect(EdgeEffect.None);
            Grid.onScrollIndex((first: number, last: number) => {
                this.log = this.log + 'I' + first + ',' + last + ';';
            });
            Grid.onReachEnd(() => {
                this.log = this.log + 'RE;';
            });
        }, Grid);
        {
            const itemCreation2 = (elmtId, isInitialRender) => {
                GridItem.create(() => { }, false);
                GridItem.height(60);
            };
            const observedDeepRender = () => {
                this.observeComponentCreation2(itemCreation2, GridItem);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('g0');
                    Text.id('g0');
                }, Text);
                Text.pop();
                GridItem.pop();
            };
            observedDeepRender();
        }
        {
            const itemCreation2 = (elmtId, isInitialRender) => {
                GridItem.create(() => { }, false);
                GridItem.height(60);
            };
            const observedDeepRender = () => {
                this.observeComponentCreation2(itemCreation2, GridItem);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('g1');
                }, Text);
                Text.pop();
                GridItem.pop();
            };
            observedDeepRender();
        }
        {
            const itemCreation2 = (elmtId, isInitialRender) => {
                GridItem.create(() => { }, false);
                GridItem.height(60);
            };
            const observedDeepRender = () => {
                this.observeComponentCreation2(itemCreation2, GridItem);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('g2');
                }, Text);
                Text.pop();
                GridItem.pop();
            };
            observedDeepRender();
        }
        {
            const itemCreation2 = (elmtId, isInitialRender) => {
                GridItem.create(() => { }, false);
                GridItem.height(60);
            };
            const observedDeepRender = () => {
                this.observeComponentCreation2(itemCreation2, GridItem);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('g3');
                }, Text);
                Text.pop();
                GridItem.pop();
            };
            observedDeepRender();
        }
        {
            const itemCreation2 = (elmtId, isInitialRender) => {
                GridItem.create(() => { }, false);
                GridItem.height(60);
            };
            const observedDeepRender = () => {
                this.observeComponentCreation2(itemCreation2, GridItem);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('g4');
                }, Text);
                Text.pop();
                GridItem.pop();
            };
            observedDeepRender();
        }
        {
            const itemCreation2 = (elmtId, isInitialRender) => {
                GridItem.create(() => { }, false);
                GridItem.height(60);
                GridItem.columnStart(1);
                GridItem.columnEnd(2);
            };
            const observedDeepRender = () => {
                this.observeComponentCreation2(itemCreation2, GridItem);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('g5');
                    Text.id('g5');
                }, Text);
                Text.pop();
                GridItem.pop();
            };
            observedDeepRender();
        }
        Grid.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('by60');
            Button.id('btn-by');
            Button.onClick(() => {
                this.scroller.scrollBy(0, 60);
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('toEnd');
            Button.id('btn-end');
            Button.onClick(() => {
                this.scroller.scrollEdge(Edge.Bottom);
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('gd-log');
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
        return "GridDemo";
    }
}
registerNamedRoute(() => new GridDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/GridDemo", pageFullPath: "entry/src/main/ets/pages/GridDemo", integratedHsp: "false", moduleType: "followWithHap" });
