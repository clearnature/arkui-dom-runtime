if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface AlphabetIndexerDemo_Params {
    log?: string;
    idx?: number;
    arr?: string[];
}
class AlphabetIndexerDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.__idx = new ObservedPropertySimplePU(0, this, "idx");
        this.arr = ['A', 'B', 'C', 'D', 'E'];
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: AlphabetIndexerDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.idx !== undefined) {
            this.idx = params.idx;
        }
        if (params.arr !== undefined) {
            this.arr = params.arr;
        }
    }
    updateStateVars(params: AlphabetIndexerDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
        this.__idx.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
        this.__idx.aboutToBeDeleted();
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
    private __idx: ObservedPropertySimplePU<number>;
    get idx() {
        return this.__idx.get();
    }
    set idx(newValue: number) {
        this.__idx.set(newValue);
    }
    private arr: string[];
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            AlphabetIndexer.create({ arrayValue: this.arr, selected: 0 });
            AlphabetIndexer.id('aix');
            AlphabetIndexer.itemSize(24);
            AlphabetIndexer.selectedBackgroundColor('#0a59f7');
            AlphabetIndexer.selected(this.idx);
            AlphabetIndexer.onSelect((index: number) => {
                this.idx = index;
                this.log = this.log + 'SEL' + index + ';';
            });
        }, AlphabetIndexer);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('toC');
            Button.id('btn-toc');
            Button.onClick(() => {
                this.idx = 2;
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.idx + '');
            Text.id('aix-idx');
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('aix-log');
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
        return "AlphabetIndexerDemo";
    }
}
registerNamedRoute(() => new AlphabetIndexerDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/AlphabetIndexerDemo", pageFullPath: "entry/src/main/ets/pages/AlphabetIndexerDemo", integratedHsp: "false", moduleType: "followWithHap" });
