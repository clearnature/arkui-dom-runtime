if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface PerfBigDemo_Params {
    items?: string[];
    upper?: boolean;
}
class PerfBigDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__items = new ObservedPropertyObjectPU([], this, "items");
        this.__upper = new ObservedPropertySimplePU(false, this, "upper");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: PerfBigDemo_Params) {
        if (params.items !== undefined) {
            this.items = params.items;
        }
        if (params.upper !== undefined) {
            this.upper = params.upper;
        }
    }
    updateStateVars(params: PerfBigDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__items.purgeDependencyOnElmtId(rmElmtId);
        this.__upper.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__items.aboutToBeDeleted();
        this.__upper.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __items: ObservedPropertyObjectPU<string[]>;
    get items() {
        return this.__items.get();
    }
    set items(newValue: string[]) {
        this.__items.set(newValue);
    }
    private __upper: ObservedPropertySimplePU<boolean>;
    get upper() {
        return this.__upper.get();
    }
    set upper(newValue: boolean) {
        this.__upper.set(newValue);
    }
    aboutToAppear() {
        const arr: string[] = [];
        for (let i = 0; i < 200; i++) {
            arr.push('row ' + i);
        }
        this.items = arr;
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 2 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('toggle');
            Button.id('btn-toggle');
            Button.onClick(() => {
                this.upper = !this.upper;
                const up = this.upper;
                const arr: string[] = [];
                for (let i = 0; i < 200; i++) {
                    arr.push(up ? ('ROW ' + i) : ('row ' + i));
                }
                this.items = arr;
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('n=' + this.items.length);
            Text.id('big-count');
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
            this.forEachUpdateFunction(elmtId, this.items, forEachItemGenFunction, (it: string, idx: number) => 'k' + idx, false, true);
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
        return "PerfBigDemo";
    }
}
registerNamedRoute(() => new PerfBigDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/PerfBigDemo", pageFullPath: "entry/src/main/ets/pages/PerfBigDemo", integratedHsp: "false", moduleType: "followWithHap" });
