if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface LazyVar_Params {
    small?: VarSource;
    big?: VarSource;
    scA?: Scroller;
    scB?: Scroller;
}
// R16 测量/验证用页面：LazyForEach 变高列表项
class VarSource implements IDataSource {
    private data: string[] = [];
    private listeners: DataChangeListener[] = [];
    constructor(n: number, prefix: string) {
        for (let i = 0; i < n; i++) {
            this.data.push(prefix + i);
        }
    }
    totalCount(): number {
        return this.data.length;
    }
    getData(index: number): string {
        return this.data[index];
    }
    registerDataChangeListener(listener: DataChangeListener): void {
        this.listeners.push(listener);
    }
    unregisterDataChangeListener(listener: DataChangeListener): void {
    }
}
class LazyVar extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.small = new VarSource(8, 's-');
        this.big = new VarSource(400, 'b-');
        this.scA = new Scroller();
        this.scB = new Scroller();
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: LazyVar_Params) {
        if (params.small !== undefined) {
            this.small = params.small;
        }
        if (params.big !== undefined) {
            this.big = params.big;
        }
        if (params.scA !== undefined) {
            this.scA = params.scA;
        }
        if (params.scB !== undefined) {
            this.scB = params.scB;
        }
    }
    updateStateVars(params: LazyVar_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
    }
    aboutToBeDeleted() {
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private small: VarSource;
    private big: VarSource;
    private scA: Scroller;
    private scB: Scroller;
    // 高度 50/120 交替：任何"统一估计行高"的做法都会错一半
    hOf(index: number): number {
        return index % 2 === 0 ? 50 : 120;
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.width('100%');
            Column.height('100%');
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('LazyVar');
            Text.fontSize(16);
            Text.fontWeight(FontWeight.Bold);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // A：8 项，视口 800 足够高 → 窗口覆盖全部 → 每一项都能被实测（总高才有"实测之和"可言）
            List.create({ space: 2, scroller: this.scA });
            // A：8 项，视口 800 足够高 → 窗口覆盖全部 → 每一项都能被实测（总高才有"实测之和"可言）
            List.height(800);
            // A：8 项，视口 800 足够高 → 窗口覆盖全部 → 每一项都能被实测（总高才有"实测之和"可言）
            List.width('100%');
            // A：8 项，视口 800 足够高 → 窗口覆盖全部 → 每一项都能被实测（总高才有"实测之和"可言）
            List.id('listA');
        }, List);
        {
            const __lazyForEachItemGenFunction = (_item, index: number) => {
                const item = _item;
                {
                    const itemCreation2 = (elmtId, isInitialRender) => {
                        ListItem.create(() => { }, false);
                    };
                    const observedDeepRender = () => {
                        this.observeComponentCreation2(itemCreation2, ListItem);
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Text.create(item);
                            Text.fontSize(12);
                            Text.height(this.hOf(index));
                        }, Text);
                        Text.pop();
                        ListItem.pop();
                    };
                    observedDeepRender();
                }
            };
            const __lazyForEachItemIdFunc = (item: string) => item;
            LazyForEach.create("1", this, this.small, __lazyForEachItemGenFunction, __lazyForEachItemIdFunc);
            LazyForEach.pop();
        }
        // A：8 项，视口 800 足够高 → 窗口覆盖全部 → 每一项都能被实测（总高才有"实测之和"可言）
        List.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // B：400 项，视口只有 120 → 必须靠估计 + 实测回填；滚动到深处验锚定
            List.create({ space: 2, scroller: this.scB });
            // B：400 项，视口只有 120 → 必须靠估计 + 实测回填；滚动到深处验锚定
            List.height(120);
            // B：400 项，视口只有 120 → 必须靠估计 + 实测回填；滚动到深处验锚定
            List.width('100%');
            // B：400 项，视口只有 120 → 必须靠估计 + 实测回填；滚动到深处验锚定
            List.id('listB');
        }, List);
        {
            const __lazyForEachItemGenFunction = (_item, index: number) => {
                const item = _item;
                {
                    const itemCreation2 = (elmtId, isInitialRender) => {
                        ListItem.create(() => { }, false);
                    };
                    const observedDeepRender = () => {
                        this.observeComponentCreation2(itemCreation2, ListItem);
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Text.create(item);
                            Text.fontSize(12);
                            Text.height(this.hOf(index));
                        }, Text);
                        Text.pop();
                        ListItem.pop();
                    };
                    observedDeepRender();
                }
            };
            const __lazyForEachItemIdFunc = (item: string) => item;
            LazyForEach.create("1", this, this.big, __lazyForEachItemGenFunction, __lazyForEachItemIdFunc);
            LazyForEach.pop();
        }
        // B：400 项，视口只有 120 → 必须靠估计 + 实测回填；滚动到深处验锚定
        List.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('toB100');
            Button.onClick(() => {
                this.scB.scrollToIndex(100);
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('toB0');
            Button.onClick(() => {
                this.scB.scrollToIndex(0);
            });
        }, Button);
        Button.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "LazyVar";
    }
}
registerNamedRoute(() => new LazyVar(undefined, {}), "", { bundleName: "com.example.hmtest", moduleName: "entry", pagePath: "pages/LazyVar", pageFullPath: "entry/src/main/ets/pages/LazyVar", integratedHsp: "false", moduleType: "followWithHap" });
