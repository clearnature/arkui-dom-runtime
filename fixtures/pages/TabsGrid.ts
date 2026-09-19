if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface TabsGrid_Params {
    tabCtrl?: TabsController;
    activeIdx?: number;
}
class TabsGrid extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.tabCtrl = new TabsController();
        this.__activeIdx = new ObservedPropertySimplePU(0, this, "activeIdx");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: TabsGrid_Params) {
        if (params.tabCtrl !== undefined) {
            this.tabCtrl = params.tabCtrl;
        }
        if (params.activeIdx !== undefined) {
            this.activeIdx = params.activeIdx;
        }
    }
    updateStateVars(params: TabsGrid_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__activeIdx.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__activeIdx.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private tabCtrl: TabsController;
    private __activeIdx: ObservedPropertySimplePU<number>;
    get activeIdx() {
        return this.__activeIdx.get();
    }
    set activeIdx(newValue: number) {
        this.__activeIdx.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.width('100%');
            Column.height('100%');
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('TabsGrid');
            Text.fontSize(16);
            Text.fontWeight(FontWeight.Bold);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ① 三列轨道 + 双向 gap + 换行（5 项 → 2 行）
            Grid.create();
            // ① 三列轨道 + 双向 gap + 换行（5 项 → 2 行）
            Grid.columnsTemplate('1fr 1fr 1fr');
            // ① 三列轨道 + 双向 gap + 换行（5 项 → 2 行）
            Grid.rowsGap(4);
            // ① 三列轨道 + 双向 gap + 换行（5 项 → 2 行）
            Grid.columnsGap(6);
            // ① 三列轨道 + 双向 gap + 换行（5 项 → 2 行）
            Grid.width('100%');
            // ① 三列轨道 + 双向 gap + 换行（5 项 → 2 行）
            Grid.height(120);
            // ① 三列轨道 + 双向 gap + 换行（5 项 → 2 行）
            Grid.id('gridA');
        }, Grid);
        {
            const itemCreation2 = (elmtId, isInitialRender) => {
                GridItem.create(() => { }, false);
            };
            const observedDeepRender = () => {
                this.observeComponentCreation2(itemCreation2, GridItem);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('a');
                }, Text);
                Text.pop();
                GridItem.pop();
            };
            observedDeepRender();
        }
        {
            const itemCreation2 = (elmtId, isInitialRender) => {
                GridItem.create(() => { }, false);
            };
            const observedDeepRender = () => {
                this.observeComponentCreation2(itemCreation2, GridItem);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('b');
                }, Text);
                Text.pop();
                GridItem.pop();
            };
            observedDeepRender();
        }
        {
            const itemCreation2 = (elmtId, isInitialRender) => {
                GridItem.create(() => { }, false);
            };
            const observedDeepRender = () => {
                this.observeComponentCreation2(itemCreation2, GridItem);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('c');
                }, Text);
                Text.pop();
                GridItem.pop();
            };
            observedDeepRender();
        }
        {
            const itemCreation2 = (elmtId, isInitialRender) => {
                GridItem.create(() => { }, false);
            };
            const observedDeepRender = () => {
                this.observeComponentCreation2(itemCreation2, GridItem);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('d');
                }, Text);
                Text.pop();
                GridItem.pop();
            };
            observedDeepRender();
        }
        {
            const itemCreation2 = (elmtId, isInitialRender) => {
                GridItem.create(() => { }, false);
            };
            const observedDeepRender = () => {
                this.observeComponentCreation2(itemCreation2, GridItem);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('e');
                }, Text);
                Text.pop();
                GridItem.pop();
            };
            observedDeepRender();
        }
        // ① 三列轨道 + 双向 gap + 换行（5 项 → 2 行）
        Grid.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ② 轨道尺寸单位：ArkUI 的裸数字 = vp，CSS 需要 px —— 归一化是否真生效要看几何
            Grid.create();
            // ② 轨道尺寸单位：ArkUI 的裸数字 = vp，CSS 需要 px —— 归一化是否真生效要看几何
            Grid.columnsTemplate('100 1fr');
            // ② 轨道尺寸单位：ArkUI 的裸数字 = vp，CSS 需要 px —— 归一化是否真生效要看几何
            Grid.rowsTemplate('40 1fr');
            // ② 轨道尺寸单位：ArkUI 的裸数字 = vp，CSS 需要 px —— 归一化是否真生效要看几何
            Grid.width(300);
            // ② 轨道尺寸单位：ArkUI 的裸数字 = vp，CSS 需要 px —— 归一化是否真生效要看几何
            Grid.height(80);
            // ② 轨道尺寸单位：ArkUI 的裸数字 = vp，CSS 需要 px —— 归一化是否真生效要看几何
            Grid.id('gridB');
        }, Grid);
        {
            const itemCreation2 = (elmtId, isInitialRender) => {
                GridItem.create(() => { }, false);
            };
            const observedDeepRender = () => {
                this.observeComponentCreation2(itemCreation2, GridItem);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('u1');
                }, Text);
                Text.pop();
                GridItem.pop();
            };
            observedDeepRender();
        }
        {
            const itemCreation2 = (elmtId, isInitialRender) => {
                GridItem.create(() => { }, false);
            };
            const observedDeepRender = () => {
                this.observeComponentCreation2(itemCreation2, GridItem);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('u2');
                }, Text);
                Text.pop();
                GridItem.pop();
            };
            observedDeepRender();
        }
        // ② 轨道尺寸单位：ArkUI 的裸数字 = vp，CSS 需要 px —— 归一化是否真生效要看几何
        Grid.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ③ 多面板切换
            Tabs.create({ barPosition: BarPosition.Start, index: 0, controller: this.tabCtrl });
            // ③ 多面板切换
            Tabs.onChange((i: number) => {
                this.activeIdx = i;
            });
            // ③ 多面板切换
            Tabs.width('100%');
            // ③ 多面板切换
            Tabs.height(100);
            // ③ 多面板切换
            Tabs.id('tabsA');
        }, Tabs);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TabContent.create(() => {
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('page-0');
                }, Text);
                Text.pop();
            });
            TabContent.tabBar('T0');
        }, TabContent);
        TabContent.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TabContent.create(() => {
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('page-1');
                }, Text);
                Text.pop();
            });
            TabContent.tabBar('T1');
        }, TabContent);
        TabContent.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TabContent.create(() => {
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('page-2');
                }, Text);
                Text.pop();
            });
            TabContent.tabBar('T2');
        }, TabContent);
        TabContent.pop();
        // ③ 多面板切换
        Tabs.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('idx=' + this.activeIdx);
            Text.id('idxline');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('go1');
            Button.onClick(() => {
                this.tabCtrl.changeIndex(1);
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
        return "TabsGrid";
    }
}
registerNamedRoute(() => new TabsGrid(undefined, {}), "", { bundleName: "com.example.hmtest", moduleName: "entry", pagePath: "pages/TabsGrid", pageFullPath: "entry/src/main/ets/pages/TabsGrid", integratedHsp: "false", moduleType: "followWithHap" });
