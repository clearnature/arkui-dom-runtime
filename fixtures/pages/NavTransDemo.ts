if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface NavTransDemo_Params {
    log?: string;
    s1?: NavPathStack;
    s2?: NavPathStack;
    s3?: NavPathStack;
    s4?: NavPathStack;
    items1?: number[];
    items2?: number[];
    items3?: number[];
    items4?: number[];
}
class NavTransDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.s1 = new NavPathStack();
        this.s2 = new NavPathStack();
        this.s3 = new NavPathStack();
        this.s4 = new NavPathStack();
        this.items1 = [];
        this.items2 = [];
        this.items3 = [];
        this.items4 = [];
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: NavTransDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.s1 !== undefined) {
            this.s1 = params.s1;
        }
        if (params.s2 !== undefined) {
            this.s2 = params.s2;
        }
        if (params.s3 !== undefined) {
            this.s3 = params.s3;
        }
        if (params.s4 !== undefined) {
            this.s4 = params.s4;
        }
        if (params.items1 !== undefined) {
            this.items1 = params.items1;
        }
        if (params.items2 !== undefined) {
            this.items2 = params.items2;
        }
        if (params.items3 !== undefined) {
            this.items3 = params.items3;
        }
        if (params.items4 !== undefined) {
            this.items4 = params.items4;
        }
    }
    updateStateVars(params: NavTransDemo_Params) {
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
    private s1: NavPathStack;
    private s2: NavPathStack;
    private s3: NavPathStack;
    private s4: NavPathStack;
    private items1: number[];
    private items2: number[];
    private items3: number[];
    private items4: number[];
    aboutToAppear(): void {
        for (let i = 0; i < 50; i++) {
            this.items1.push(i);
        }
        for (let i = 0; i < 10; i++) {
            this.items2.push(i);
        }
        for (let i = 0; i < 30; i++) {
            this.items3.push(i);
        }
        for (let i = 0; i < 15; i++) {
            this.items4.push(i);
        }
    }
    // n4 的自定义标题（builder 形态）
    SynthTitle(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('BUILT4');
            Text.id('synth4');
        }, Text);
        Text.pop();
    }
    // 栈里目的地：返回键用运行时画的标题栏返回键（回所属栈），页面内只放内容
    PageMap(name: string, param: object, parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (name === 'd1') {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        NavDestination.create(() => {
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Text.create('detail-body');
                                Text.id('detail-body');
                            }, Text);
                            Text.pop();
                        }, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavTransDemo" });
                        NavDestination.title('DT1');
                    }, NavDestination);
                    NavDestination.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (name === 'd2') {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        NavDestination.create(() => {
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Text.create('detail2-body');
                                Text.id('detail2-body');
                            }, Text);
                            Text.pop();
                        }, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavTransDemo" });
                        NavDestination.title('DT2');
                    }, NavDestination);
                    NavDestination.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // n1：Free + List 滚动联动 + push（默认动画）
            Navigation.create(this.s1, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavTransDemo", isUserCreateStack: true });
            // n1：Free + List 滚动联动 + push（默认动画）
            Navigation.id('nt-n1');
            // n1：Free + List 滚动联动 + push（默认动画）
            Navigation.width(320);
            // n1：Free + List 滚动联动 + push（默认动画）
            Navigation.height(240);
            // n1：Free + List 滚动联动 + push（默认动画）
            Navigation.title('ScrollTitle');
            // n1：Free + List 滚动联动 + push（默认动画）
            Navigation.titleMode(NavigationTitleMode.Free);
            // n1：Free + List 滚动联动 + push（默认动画）
            Navigation.onTitleModeChange((m: NavigationTitleMode) => { this.log = this.log + 'TMC' + m + ';'; });
            // n1：Free + List 滚动联动 + push（默认动画）
            Navigation.navDestination({ builder: this.PageMap.bind(this) });
        }, Navigation);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.width('100%');
            Column.height('100%');
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('push1');
            Button.id('push1');
            Button.onClick(() => { this.s1.pushPathByName('d1', undefined); });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            List.create({ space: 4 });
            List.id('list1');
            List.width('100%');
            List.height(150);
        }, List);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ForEach.create();
            const forEachItemGenFunction = _item => {
                const it = _item;
                {
                    const itemCreation = (elmtId, isInitialRender) => {
                        ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                        ListItem.create(deepRenderFunction, true);
                        if (!isInitialRender) {
                            ListItem.pop();
                        }
                        ViewStackProcessor.StopGetAccessRecording();
                    };
                    const itemCreation2 = (elmtId, isInitialRender) => {
                        ListItem.create(deepRenderFunction, true);
                        ListItem.id('li1-' + it);
                        ListItem.height(40);
                    };
                    const deepRenderFunction = (elmtId, isInitialRender) => {
                        itemCreation(elmtId, isInitialRender);
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Text.create('item' + it);
                            Text.fontSize(16);
                        }, Text);
                        Text.pop();
                        ListItem.pop();
                    };
                    this.observeComponentCreation2(itemCreation2, ListItem);
                    ListItem.pop();
                }
            };
            this.forEachUpdateFunction(elmtId, this.items1, forEachItemGenFunction, (it: number) => 'i' + it, false, false);
        }, ForEach);
        ForEach.pop();
        List.pop();
        Column.pop();
        // n1：Free + List 滚动联动 + push（默认动画）
        Navigation.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // n2：Full 对照（联动不许触发）+ animated=false 的四参 push
            Navigation.create(this.s2, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavTransDemo", isUserCreateStack: true });
            // n2：Full 对照（联动不许触发）+ animated=false 的四参 push
            Navigation.id('nt-n2');
            // n2：Full 对照（联动不许触发）+ animated=false 的四参 push
            Navigation.width(320);
            // n2：Full 对照（联动不许触发）+ animated=false 的四参 push
            Navigation.height(240);
            // n2：Full 对照（联动不许触发）+ animated=false 的四参 push
            Navigation.title('FullTitle');
            // n2：Full 对照（联动不许触发）+ animated=false 的四参 push
            Navigation.titleMode(NavigationTitleMode.Full);
            // n2：Full 对照（联动不许触发）+ animated=false 的四参 push
            Navigation.onTitleModeChange((m: NavigationTitleMode) => { this.log = this.log + 'FULL' + m + ';'; });
            // n2：Full 对照（联动不许触发）+ animated=false 的四参 push
            Navigation.navDestination({ builder: this.PageMap.bind(this) });
        }, Navigation);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.width('100%');
            Column.height('100%');
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('push2');
            Button.id('push2');
            Button.onClick(() => { this.s2.pushPathByName('d2', undefined, undefined, false); });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            List.create({ space: 4 });
            List.id('list2');
            List.width('100%');
            List.height(150);
        }, List);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ForEach.create();
            const forEachItemGenFunction = _item => {
                const it = _item;
                {
                    const itemCreation = (elmtId, isInitialRender) => {
                        ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                        ListItem.create(deepRenderFunction, true);
                        if (!isInitialRender) {
                            ListItem.pop();
                        }
                        ViewStackProcessor.StopGetAccessRecording();
                    };
                    const itemCreation2 = (elmtId, isInitialRender) => {
                        ListItem.create(deepRenderFunction, true);
                        ListItem.id('li2-' + it);
                        ListItem.height(40);
                    };
                    const deepRenderFunction = (elmtId, isInitialRender) => {
                        itemCreation(elmtId, isInitialRender);
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Text.create('f' + it);
                            Text.fontSize(16);
                        }, Text);
                        Text.pop();
                        ListItem.pop();
                    };
                    this.observeComponentCreation2(itemCreation2, ListItem);
                    ListItem.pop();
                }
            };
            this.forEachUpdateFunction(elmtId, this.items2, forEachItemGenFunction, (it: number) => 'f' + it, false, false);
        }, ForEach);
        ForEach.pop();
        List.pop();
        Column.pop();
        // n2：Full 对照（联动不许触发）+ animated=false 的四参 push
        Navigation.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // n3：CommonTitle{main,sub} + Free（副标题淡出/主标题缩小载体）+ disableAnimation 后 push
            Navigation.create(this.s3, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavTransDemo", isUserCreateStack: true });
            // n3：CommonTitle{main,sub} + Free（副标题淡出/主标题缩小载体）+ disableAnimation 后 push
            Navigation.id('nt-n3');
            // n3：CommonTitle{main,sub} + Free（副标题淡出/主标题缩小载体）+ disableAnimation 后 push
            Navigation.width(320);
            // n3：CommonTitle{main,sub} + Free（副标题淡出/主标题缩小载体）+ disableAnimation 后 push
            Navigation.height(240);
            // n3：CommonTitle{main,sub} + Free（副标题淡出/主标题缩小载体）+ disableAnimation 后 push
            Navigation.title({ main: 'M3', sub: 'S3' });
            // n3：CommonTitle{main,sub} + Free（副标题淡出/主标题缩小载体）+ disableAnimation 后 push
            Navigation.titleMode(NavigationTitleMode.Free);
            // n3：CommonTitle{main,sub} + Free（副标题淡出/主标题缩小载体）+ disableAnimation 后 push
            Navigation.navDestination({ builder: this.PageMap.bind(this) });
        }, Navigation);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.width('100%');
            Column.height('100%');
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('dis');
            Button.id('dis-btn');
            Button.onClick(() => {
                this.s3.disableAnimation(true);
                this.s3.pushPathByName('d1', undefined);
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            List.create({ space: 4 });
            List.id('list3');
            List.width('100%');
            List.height(150);
        }, List);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ForEach.create();
            const forEachItemGenFunction = _item => {
                const it = _item;
                {
                    const itemCreation = (elmtId, isInitialRender) => {
                        ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                        ListItem.create(deepRenderFunction, true);
                        if (!isInitialRender) {
                            ListItem.pop();
                        }
                        ViewStackProcessor.StopGetAccessRecording();
                    };
                    const itemCreation2 = (elmtId, isInitialRender) => {
                        ListItem.create(deepRenderFunction, true);
                        ListItem.id('li3-' + it);
                        ListItem.height(40);
                    };
                    const deepRenderFunction = (elmtId, isInitialRender) => {
                        itemCreation(elmtId, isInitialRender);
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Text.create('c' + it);
                            Text.fontSize(16);
                        }, Text);
                        Text.pop();
                        ListItem.pop();
                    };
                    this.observeComponentCreation2(itemCreation2, ListItem);
                    ListItem.pop();
                }
            };
            this.forEachUpdateFunction(elmtId, this.items3, forEachItemGenFunction, (it: number) => 'c' + it, false, false);
        }, ForEach);
        ForEach.pop();
        List.pop();
        Column.pop();
        // n3：CommonTitle{main,sub} + Free（副标题淡出/主标题缩小载体）+ disableAnimation 后 push
        Navigation.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // n4：builder 标题 + Free（内容不缩、只有高度收的对照）
            Navigation.create(this.s4, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavTransDemo", isUserCreateStack: true });
            // n4：builder 标题 + Free（内容不缩、只有高度收的对照）
            Navigation.id('nt-n4');
            // n4：builder 标题 + Free（内容不缩、只有高度收的对照）
            Navigation.width(320);
            // n4：builder 标题 + Free（内容不缩、只有高度收的对照）
            Navigation.height(240);
            // n4：builder 标题 + Free（内容不缩、只有高度收的对照）
            Navigation.title({ builder: this.SynthTitle.bind(this) });
            // n4：builder 标题 + Free（内容不缩、只有高度收的对照）
            Navigation.titleMode(NavigationTitleMode.Free);
            // n4：builder 标题 + Free（内容不缩、只有高度收的对照）
            Navigation.navDestination({ builder: this.PageMap.bind(this) });
        }, Navigation);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.width('100%');
            Column.height('100%');
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            List.create({ space: 4 });
            List.id('list4');
            List.width('100%');
            List.height(150);
        }, List);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ForEach.create();
            const forEachItemGenFunction = _item => {
                const it = _item;
                {
                    const itemCreation = (elmtId, isInitialRender) => {
                        ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                        ListItem.create(deepRenderFunction, true);
                        if (!isInitialRender) {
                            ListItem.pop();
                        }
                        ViewStackProcessor.StopGetAccessRecording();
                    };
                    const itemCreation2 = (elmtId, isInitialRender) => {
                        ListItem.create(deepRenderFunction, true);
                        ListItem.id('li4-' + it);
                        ListItem.height(40);
                    };
                    const deepRenderFunction = (elmtId, isInitialRender) => {
                        itemCreation(elmtId, isInitialRender);
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Text.create('b' + it);
                            Text.fontSize(16);
                        }, Text);
                        Text.pop();
                        ListItem.pop();
                    };
                    this.observeComponentCreation2(itemCreation2, ListItem);
                    ListItem.pop();
                }
            };
            this.forEachUpdateFunction(elmtId, this.items4, forEachItemGenFunction, (it: number) => 'b' + it, false, false);
        }, ForEach);
        ForEach.pop();
        List.pop();
        Column.pop();
        // n4：builder 标题 + Free（内容不缩、只有高度收的对照）
        Navigation.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('tmc-log');
            Text.fontSize(12);
            Text.height(30);
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
        return "NavTransDemo";
    }
}
registerNamedRoute(() => new NavTransDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/NavTransDemo", pageFullPath: "entry/src/main/ets/pages/NavTransDemo", integratedHsp: "false", moduleType: "followWithHap" });
