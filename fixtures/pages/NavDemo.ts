if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface NavDemo_Params {
    stack?: NavPathStack;
    stackB?: NavPathStack;
    pathNames?: string;
    stackSize?: number;
    life?: string;
    rootCount?: number;
    popGot?: string;
}
class NavDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.stack = new NavPathStack();
        this.stackB = new NavPathStack();
        this.__pathNames = new ObservedPropertySimplePU('(empty)', this, "pathNames");
        this.__stackSize = new ObservedPropertySimplePU(0, this, "stackSize");
        this.__life = new ObservedPropertySimplePU('', this, "life");
        this.__rootCount = new ObservedPropertySimplePU(0, this, "rootCount");
        this.__popGot = new ObservedPropertySimplePU('', this, "popGot");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: NavDemo_Params) {
        if (params.stack !== undefined) {
            this.stack = params.stack;
        }
        if (params.stackB !== undefined) {
            this.stackB = params.stackB;
        }
        if (params.pathNames !== undefined) {
            this.pathNames = params.pathNames;
        }
        if (params.stackSize !== undefined) {
            this.stackSize = params.stackSize;
        }
        if (params.life !== undefined) {
            this.life = params.life;
        }
        if (params.rootCount !== undefined) {
            this.rootCount = params.rootCount;
        }
        if (params.popGot !== undefined) {
            this.popGot = params.popGot;
        }
    }
    updateStateVars(params: NavDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__pathNames.purgeDependencyOnElmtId(rmElmtId);
        this.__stackSize.purgeDependencyOnElmtId(rmElmtId);
        this.__life.purgeDependencyOnElmtId(rmElmtId);
        this.__rootCount.purgeDependencyOnElmtId(rmElmtId);
        this.__popGot.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__pathNames.aboutToBeDeleted();
        this.__stackSize.aboutToBeDeleted();
        this.__life.aboutToBeDeleted();
        this.__rootCount.aboutToBeDeleted();
        this.__popGot.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private stack: NavPathStack;
    private stackB: NavPathStack;
    private __pathNames: ObservedPropertySimplePU<string>;
    get pathNames() {
        return this.__pathNames.get();
    }
    set pathNames(newValue: string) {
        this.__pathNames.set(newValue);
    }
    private __stackSize: ObservedPropertySimplePU<number>;
    get stackSize() {
        return this.__stackSize.get();
    }
    set stackSize(newValue: number) {
        this.__stackSize.set(newValue);
    }
    private __life: ObservedPropertySimplePU<string>;
    get life() {
        return this.__life.get();
    }
    set life(newValue: string) {
        this.__life.set(newValue);
    }
    private __rootCount: ObservedPropertySimplePU<number>;
    get rootCount() {
        return this.__rootCount.get();
    }
    set rootCount(newValue: number) {
        this.__rootCount.set(newValue);
    }
    private __popGot: ObservedPropertySimplePU<string>;
    get popGot() {
        return this.__popGot.get();
    }
    set popGot(newValue: string) {
        this.__popGot.set(newValue);
    }
    syncState() {
        this.pathNames = this.stack.getAllPathName().join('>');
        this.stackSize = this.stack.size();
    }
    note(s: string) {
        this.life = this.life + s + ' ';
    }
    PageMap(name: string, param: string, parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            NavDestination.create(() => {
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Column.create({ space: 2 });
                    Column.alignItems(HorizontalAlign.Start);
                }, Column);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('dest:' + name);
                    Text.id('dest-' + name);
                }, Text);
                Text.pop();
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('param:' + param);
                }, Text);
                Text.pop();
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Button.createWithLabel('dpop');
                    Button.onClick(() => {
                        this.stack.pop();
                        this.syncState();
                    });
                }, Button);
                Button.pop();
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Button.createWithLabel('dpushB');
                    Button.onClick(() => {
                        this.stack.pushPathByName('B', 'pb2');
                        this.syncState();
                    });
                }, Button);
                Button.pop();
                Column.pop();
            }, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavDemo" });
            NavDestination.title(name);
            NavDestination.onWillAppear(() => {
                this.note(name + ':willAppear');
            });
            NavDestination.onWillShow(() => {
                this.note(name + ':willShow');
            });
            NavDestination.onShown(() => {
                this.note(name + ':shown');
            });
            NavDestination.onReady(() => {
                this.note(name + ':ready');
            });
            NavDestination.onWillHide(() => {
                this.note(name + ':willHide');
            });
            NavDestination.onHidden(() => {
                this.note(name + ':hidden');
            });
            NavDestination.onWillDisappear(() => {
                this.note(name + ':willDisappear');
            });
        }, NavDestination);
        NavDestination.pop();
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 4 });
            Column.width('100%');
            Column.height('100%');
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Navigation.create(this.stack, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavDemo", isUserCreateStack: true });
            Navigation.title('Home');
            Navigation.navDestination({ builder: this.PageMap.bind(this) });
            Navigation.mode(NavigationMode.Stack);
            Navigation.width('100%');
            Navigation.height('100%');
            Navigation.id('navA');
        }, Navigation);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 2 });
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('root');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('root=' + this.rootCount);
            Text.id('rootline');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('paths=' + this.pathNames);
            Text.id('pathline');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('size=' + this.stackSize);
            Text.id('sizeline');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('life=' + this.life);
            Text.id('lifeline');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('popGot=' + this.popGot);
            Text.id('popline');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('rootInc');
            Button.onClick(() => {
                this.rootCount = this.rootCount + 1;
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('pushA');
            Button.onClick(() => {
                this.stack.pushPathByName('A', 'pa');
                this.syncState();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('pushB');
            Button.onClick(() => {
                this.stack.pushPathByName('B', 'pb');
                this.syncState();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('pushC');
            Button.onClick(() => {
                this.stack.pushPathByName('C', 'pc');
                this.syncState();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('pushDwithPop');
            Button.onClick(() => {
                this.stack.pushPathByName('D', 'pd', (info: PopInfo) => {
                    this.popGot = info.info.name + '/' + info.result;
                    this.syncState();
                });
                this.syncState();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('pop');
            Button.onClick(() => {
                this.stack.pop();
                this.syncState();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('popToA');
            Button.onClick(() => {
                this.stack.popToName('A');
                this.syncState();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('popTo0');
            Button.onClick(() => {
                this.stack.popToIndex(0);
                this.syncState();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('clear');
            Button.onClick(() => {
                this.stack.clear();
                this.syncState();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('replaceC');
            Button.onClick(() => {
                this.stack.replacePath({ name: 'C', param: 'pc-replaced' });
                this.syncState();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('removeB');
            Button.onClick(() => {
                this.stack.removeByName('B');
                this.syncState();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('moveTopA');
            Button.onClick(() => {
                this.stack.moveToTop('A');
                this.syncState();
            });
        }, Button);
        Button.pop();
        Column.pop();
        Navigation.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 第二个 Navigation：故意不提供 navDestination builder —— 验证"缺 builder"是响亮的
            Navigation.create(this.stackB, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavDemo", isUserCreateStack: true });
            // 第二个 Navigation：故意不提供 navDestination builder —— 验证"缺 builder"是响亮的
            Navigation.width(120);
            // 第二个 Navigation：故意不提供 navDestination builder —— 验证"缺 builder"是响亮的
            Navigation.height(60);
            // 第二个 Navigation：故意不提供 navDestination builder —— 验证"缺 builder"是响亮的
            Navigation.id('navB');
        }, Navigation);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('nobuilder');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('pushNB');
            Button.onClick(() => {
                this.stackB.pushPathByName('Z', 'pz');
            });
        }, Button);
        Button.pop();
        Column.pop();
        // 第二个 Navigation：故意不提供 navDestination builder —— 验证"缺 builder"是响亮的
        Navigation.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "NavDemo";
    }
}
registerNamedRoute(() => new NavDemo(undefined, {}), "", { bundleName: "com.example.hmtest", moduleName: "entry", pagePath: "pages/NavDemo", pageFullPath: "entry/src/main/ets/pages/NavDemo", integratedHsp: "false", moduleType: "followWithHap" });
