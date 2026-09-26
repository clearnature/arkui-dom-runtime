if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface Stress1kDemo_Params {
    items?: string[];
    upper?: boolean;
    hot?: number;
}
class Stress1kDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__items = new ObservedPropertyObjectPU([], this, "items");
        this.__upper = new ObservedPropertySimplePU(false, this, "upper");
        this.__hot = new ObservedPropertySimplePU(0, this, "hot");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: Stress1kDemo_Params) {
        if (params.items !== undefined) {
            this.items = params.items;
        }
        if (params.upper !== undefined) {
            this.upper = params.upper;
        }
        if (params.hot !== undefined) {
            this.hot = params.hot;
        }
    }
    updateStateVars(params: Stress1kDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__items.purgeDependencyOnElmtId(rmElmtId);
        this.__upper.purgeDependencyOnElmtId(rmElmtId);
        this.__hot.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__items.aboutToBeDeleted();
        this.__upper.aboutToBeDeleted();
        this.__hot.aboutToBeDeleted();
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
    private __hot: ObservedPropertySimplePU<number>;
    get hot() {
        return this.__hot.get();
    }
    set hot(newValue: number) {
        this.__hot.set(newValue);
    }
    aboutToAppear() {
        const arr: string[] = [];
        for (let i = 0; i < 350; i++) {
            arr.push('item ' + i);
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
            Button.createWithLabel('flip');
            Button.id('btn-flip');
            Button.onClick(() => {
                this.upper = !this.upper;
                const up = this.upper;
                const arr: string[] = [];
                for (let i = 0; i < 350; i++) {
                    arr.push(up ? ('ITEM ' + i) : ('item ' + i));
                }
                this.items = arr;
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('hot+');
            Button.id('btn-hot');
            Button.onClick(() => {
                this.hot++;
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('hot=' + this.hot);
            Text.id('hot-count');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ForEach.create();
            const forEachItemGenFunction = _item => {
                const it = _item;
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Row.create();
                    Row.width('90%');
                    Row.height(48);
                    Row.padding(6);
                    Row.backgroundColor('#f5f5f5');
                }, Row);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create(it);
                    Text.fontSize(14);
                    Text.fontColor('#333333');
                    Text.maxLines(1);
                }, Text);
                Text.pop();
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('tail');
                    Text.fontSize(12);
                    Text.fontColor('#888888');
                    Text.margin({ left: 8 });
                }, Text);
                Text.pop();
                Row.pop();
            };
            this.forEachUpdateFunction(elmtId, this.items, forEachItemGenFunction, (it: string, idx: number) => 'a' + idx, false, true);
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
        return "Stress1kDemo";
    }
}
registerNamedRoute(() => new Stress1kDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/Stress1kDemo", pageFullPath: "entry/src/main/ets/pages/Stress1kDemo", integratedHsp: "false", moduleType: "followWithHap" });
