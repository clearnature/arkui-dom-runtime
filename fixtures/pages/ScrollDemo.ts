if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface ScrollDemo_Params {
    log?: string;
    big?: string[];
    big3?: string[];
    scroller?: Scroller;
    scroller2?: Scroller;
    scroller3?: Scroller;
}
interface ItemRow_Params {
    text?: string;
}
class ItemRow extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__text = new SynchedPropertySimpleOneWayPU(params.text, this, "text");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: ItemRow_Params) {
        if (params.text === undefined) {
            this.__text.set('');
        }
    }
    updateStateVars(params: ItemRow_Params) {
        this.__text.reset(params.text);
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__text.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__text.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __text: SynchedPropertySimpleOneWayPU<string>;
    get text() {
        return this.__text.get();
    }
    set text(newValue: string) {
        this.__text.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.text);
            Text.id(this.text);
            Text.height(40);
            Text.width(200);
        }, Text);
        Text.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
}
class ScrollDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.__big = new ObservedPropertyObjectPU([], this, "big");
        this.__big3 = new ObservedPropertyObjectPU([], this, "big3");
        this.scroller = new Scroller();
        this.scroller2 = new Scroller();
        this.scroller3 = new Scroller();
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: ScrollDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.big !== undefined) {
            this.big = params.big;
        }
        if (params.big3 !== undefined) {
            this.big3 = params.big3;
        }
        if (params.scroller !== undefined) {
            this.scroller = params.scroller;
        }
        if (params.scroller2 !== undefined) {
            this.scroller2 = params.scroller2;
        }
        if (params.scroller3 !== undefined) {
            this.scroller3 = params.scroller3;
        }
    }
    updateStateVars(params: ScrollDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
        this.__big.purgeDependencyOnElmtId(rmElmtId);
        this.__big3.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
        this.__big.aboutToBeDeleted();
        this.__big3.aboutToBeDeleted();
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
    private __big: ObservedPropertyObjectPU<string[]>;
    get big() {
        return this.__big.get();
    }
    set big(newValue: string[]) {
        this.__big.set(newValue);
    }
    private __big3: ObservedPropertyObjectPU<string[]>;
    get big3() {
        return this.__big3.get();
    }
    set big3(newValue: string[]) {
        this.__big3.set(newValue);
    }
    private scroller: Scroller;
    private scroller2: Scroller;
    private scroller3: Scroller;
    aboutToAppear() {
        const arr: string[] = [];
        for (let i = 0; i < 600; i++) {
            arr.push('fs' + i);
        }
        this.big = arr;
        const arr3: string[] = [];
        for (let i = 0; i < 600; i++) {
            arr3.push('ir' + i);
        }
        this.big3 = arr3;
    }
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
            Scroll.create(this.scroller2);
            Scroll.id('sc2');
            Scroll.width(240);
            Scroll.height(200);
            Scroll.scrollable(ScrollDirection.Vertical);
            Scroll.scrollBar(BarState.Off);
        }, Scroll);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 0 });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ForEach.create();
            const forEachItemGenFunction = _item => {
                const it = _item;
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create(it);
                    Text.id(it);
                    Text.height(40);
                    Text.width(200);
                }, Text);
                Text.pop();
            };
            this.forEachUpdateFunction(elmtId, this.big, forEachItemGenFunction, (it: string) => it, false, false);
        }, ForEach);
        ForEach.pop();
        Column.pop();
        Scroll.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('si500');
            Button.id('btn-si');
            Button.onClick(() => {
                this.scroller2.scrollToIndex(500);
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Scroll.create(this.scroller3);
            Scroll.id('sc3');
            Scroll.width(240);
            Scroll.height(200);
            Scroll.scrollable(ScrollDirection.Vertical);
            Scroll.scrollBar(BarState.Off);
        }, Scroll);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 0 });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ForEach.create();
            const forEachItemGenFunction = _item => {
                const it = _item;
                {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        if (isInitialRender) {
                            let componentCall = new ItemRow(this, { text: it }, undefined, elmtId, () => { }, { page: "entry/src/main/ets/pages/ScrollDemo.ets", line: 113, col: 13 });
                            ViewPU.create(componentCall);
                            let paramsLambda = () => {
                                return {
                                    text: it
                                };
                            };
                            componentCall.paramsGenerator_ = paramsLambda;
                        }
                        else {
                            this.updateStateVarsOfChildByElmtId(elmtId, {
                                text: it
                            });
                        }
                    }, { name: "ItemRow" });
                }
            };
            this.forEachUpdateFunction(elmtId, this.big3, forEachItemGenFunction, (it: string) => it, false, false);
        }, ForEach);
        ForEach.pop();
        Column.pop();
        Scroll.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('si500-3');
            Button.id('btn-si3');
            Button.onClick(() => {
                this.scroller3.scrollToIndex(500);
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
