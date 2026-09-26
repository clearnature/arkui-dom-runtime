if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface PerfDemo_Params {
    count?: number;
    items?: string[];
}
class PerfDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__count = new ObservedPropertySimplePU(0, this, "count");
        this.__items = new ObservedPropertyObjectPU([], this, "items");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: PerfDemo_Params) {
        if (params.count !== undefined) {
            this.count = params.count;
        }
        if (params.items !== undefined) {
            this.items = params.items;
        }
    }
    updateStateVars(params: PerfDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__count.purgeDependencyOnElmtId(rmElmtId);
        this.__items.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__count.aboutToBeDeleted();
        this.__items.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __count: ObservedPropertySimplePU<number>;
    get count() {
        return this.__count.get();
    }
    set count(newValue: number) {
        this.__count.set(newValue);
    }
    private __items: ObservedPropertyObjectPU<string[]>;
    get items() {
        return this.__items.get();
    }
    set items(newValue: string[]) {
        this.__items.set(newValue);
    }
    aboutToAppear() {
        for (let i = 0; i < 30; i++) {
            this.items.push('row ' + i);
        }
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 4 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('inc');
            Button.id('btn-inc');
            Button.onClick(() => {
                this.count++;
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('count=' + this.count);
            Text.id('perf-count');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ForEach.create();
            const forEachItemGenFunction = _item => {
                const it = _item;
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create(it);
                }, Text);
                Text.pop();
            };
            this.forEachUpdateFunction(elmtId, this.items, forEachItemGenFunction, (it: string) => it, false, false);
        }, ForEach);
        ForEach.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "PerfDemo";
    }
}
registerNamedRoute(() => new PerfDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/PerfDemo", pageFullPath: "entry/src/main/ets/pages/PerfDemo", integratedHsp: "false", moduleType: "followWithHap" });
