if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
// R66：导航垫片批次（NavRouter / Navigator / PageTransitionEnter·Exit / ToolBarItem /
// UIPickerComponent）。与 harmony-proj/.../pages/NavShimDemo.ets 同源，此为【编译产物形态】。
// 两处运行时差异（已与垫片实现约定，见 .ets 头注）：
//   1) PageTransitionEnter/Exit 用 .create 形态（真机产物是裸调用；本运行时组件对象只有
//      .create 工厂）。
//   2) pageTransition() 由 aboutToAppear 显式调一次（运行时没有框架级 pageTransition 钩子）。
interface NavShimDemo_Params {
    log?: string;
    stack?: NavPathStack;
}
class NavShimDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.stack = new NavPathStack();
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: NavShimDemo_Params) {
        if (params.stack !== undefined) {
            this.stack = params.stack;
        }
        if (params.log !== undefined) {
            this.log = params.log;
        }
    }
    updateStateVars(params: NavShimDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private stack: NavPathStack;
    private __log: ObservedPropertySimplePU<string>;
    get log() {
        return this.__log.get();
    }
    set log(newValue: string) {
        this.__log.set(newValue);
    }
    aboutToAppear() {
        // 真机由框架在页面构造时调 pageTransition()；本运行时没有该钩子，显式调一次注册规格
        this.pageTransition();
    }
    pageTransition() {
        PageTransitionEnter.create({ type: RouteType.Push, duration: 300 });
        PageTransitionEnter.slide(SlideEffect.Left);
        PageTransitionEnter.onEnter((t: RouteType, p: number) => {
            this.log = this.log + 'PT' + Math.round(p * 10) + ';';
        });
        PageTransitionEnter.pop();
        PageTransitionExit.create({ type: RouteType.Push, duration: 300 });
        PageTransitionExit.slide(SlideEffect.Left);
        PageTransitionExit.pop();
    }
    PageMap(name: string, param: string, parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            NavDestination.create(() => {
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Column.create({ space: 4 });
                    Column.alignItems(HorizontalAlign.Start);
                }, Column);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('dest:' + name);
                    Text.id('dest-' + name);
                }, Text);
                Text.pop();
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('param:' + param);
                    Text.fontSize(12);
                }, Text);
                Text.pop();
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Button.createWithLabel('dpop');
                    Button.onClick(() => {
                        this.stack.pop();
                        this.log = this.log + 'POP;';
                    });
                }, Button);
                Button.pop();
                Column.pop();
            }, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavShimDemo" });
            NavDestination.title(name);
        }, NavDestination);
        NavDestination.pop();
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Navigation.create(this.stack, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavShimDemo", isUserCreateStack: true });
            Navigation.title('NavShim');
            Navigation.navDestination({ builder: this.PageMap.bind(this) });
            Navigation.mode(NavigationMode.Stack);
            Navigation.id('nav');
            Navigation.width('100%');
            Navigation.height('100%');
        }, Navigation);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            NavRouter.create({ name: 'detail', param: 'p1' });
            NavRouter.id('nr');
            NavRouter.mode(NavRouteMode.PUSH);
            NavRouter.onStateChange((on: boolean) => {
                this.log = this.log + 'NS' + (on ? 1 : 0) + ';';
            });
        }, NavRouter);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('entry');
            Text.id('nr-entry');
        }, Text);
        Text.pop();
        // d.ts 要求第二个子组件必须是 NavDestination；本运行时的目的地只能由 PageMap 建出，
        // 内联这份会挂成 display:none 并记一条 layoutWarning（结构性差异，非缺陷）
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            NavDestination.create(() => {
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('inline dest');
                }, Text);
                Text.pop();
            });
        }, NavDestination);
        NavDestination.pop();
        NavRouter.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Navigator.create({ target: 'pages/NavTarget', type: NavigationType.Push });
            Navigator.id('nv');
            Navigator.params({ from: 'shim' });
        }, Navigator);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('go target');
        }, Text);
        Text.pop();
        Navigator.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create({ space: 8 });
            Row.id('tb');
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ToolBarItem.create();
            ToolBarItem.id('tb0');
        }, ToolBarItem);
        ToolBarItem.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ToolBarItem.create({ placement: ToolBarItemPlacement.TOP_BAR_TRAILING });
            ToolBarItem.id('tb1');
        }, ToolBarItem);
        ToolBarItem.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            UIPickerComponent.create({ selectedIndex: 1 });
            UIPickerComponent.id('pk');
            UIPickerComponent.displayedItemCount(5);
            UIPickerComponent.selectionIndicator({ type: PickerIndicatorType.DIVIDER, strokeWidth: 2 });
            UIPickerComponent.onChange((i: number) => {
                this.log = this.log + 'P' + i + ';';
            });
            UIPickerComponent.onScrollStop((i: number) => {
                this.log = this.log + 'S' + i + ';';
            });
        }, UIPickerComponent);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('Alpha');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('Bravo');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('Charlie');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('Delta');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('Echo');
        }, Text);
        Text.pop();
        UIPickerComponent.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('log');
            Text.fontSize(12);
        }, Text);
        Text.pop();
        Navigation.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "NavShimDemo";
    }
}
registerNamedRoute(() => new NavShimDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/NavShimDemo", pageFullPath: "entry/src/main/ets/pages/NavShimDemo", integratedHsp: "false", moduleType: "followWithHap" });
