if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface NavBarDemo_Params {
    log?: string;
    s1?: NavPathStack;
    s2?: NavPathStack;
    s3?: NavPathStack;
    s4?: NavPathStack;
    s5?: NavPathStack;
    s6?: NavPathStack;
    s7?: NavPathStack;
    s8?: NavPathStack;
    s9?: NavPathStack;
    s10?: NavPathStack;
}
class NavBarDemo extends ViewPU {
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
        this.s5 = new NavPathStack();
        this.s6 = new NavPathStack();
        this.s7 = new NavPathStack();
        this.s8 = new NavPathStack();
        this.s9 = new NavPathStack();
        this.s10 = new NavPathStack();
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: NavBarDemo_Params) {
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
        if (params.s5 !== undefined) {
            this.s5 = params.s5;
        }
        if (params.s6 !== undefined) {
            this.s6 = params.s6;
        }
        if (params.s7 !== undefined) {
            this.s7 = params.s7;
        }
        if (params.s8 !== undefined) {
            this.s8 = params.s8;
        }
        if (params.s9 !== undefined) {
            this.s9 = params.s9;
        }
        if (params.s10 !== undefined) {
            this.s10 = params.s10;
        }
    }
    updateStateVars(params: NavBarDemo_Params) {
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
    private s5: NavPathStack;
    private s6: NavPathStack;
    private s7: NavPathStack;
    private s8: NavPathStack;
    private s9: NavPathStack;
    private s10: NavPathStack;
    // CustomBuilder 形态的标题
    SynthTitle(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('BUILT');
            Text.id('synth-title-text');
        }, Text);
        Text.pop();
    }
    // 栈里目的地：d1 带工具栏 + 菜单；d2 关掉返回键；d3 带自定义 backButtonIcon
    PageMap(name: string, param: object, parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (name === 'd1') {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        NavDestination.create(() => {
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Text.create('body1');
                                Text.id('body1');
                            }, Text);
                            Text.pop();
                        }, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavBarDemo" });
                        NavDestination.title('DT1');
                        NavDestination.menus([{ value: 'M1', action: (): void => { this.log = this.log + 'M1;'; } }]);
                        NavDestination.toolbarConfiguration([
                            { value: 'T1', action: (): void => { this.log = this.log + 'T1;'; } },
                            { value: 'T2', action: (): void => { this.log = this.log + 'T2;'; } }
                        ]);
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
                                Text.create('body2');
                                Text.id('body2');
                            }, Text);
                            Text.pop();
                        }, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavBarDemo" });
                        NavDestination.title('DT2');
                        NavDestination.hideBackButton(true);
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
            if (name === 'd3') {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        NavDestination.create(() => {
                            this.observeComponentCreation2((elmtId, isInitialRender) => {
                                Text.create('body3');
                                Text.id('body3');
                            }, Text);
                            Text.pop();
                        }, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavBarDemo" });
                        NavDestination.title('DT3');
                        NavDestination.backButtonIcon('/img/back.png');
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
            Column.create({ space: 4 });
            Column.width('100%');
            Column.height('100%');
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ① title: string + titleMode(Full)
            Navigation.create(this.s1, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavBarDemo", isUserCreateStack: true });
            // ① title: string + titleMode(Full)
            Navigation.id('nb-t1');
            // ① title: string + titleMode(Full)
            Navigation.width(300);
            // ① title: string + titleMode(Full)
            Navigation.height(170);
            // ① title: string + titleMode(Full)
            Navigation.title('T1');
            // ① title: string + titleMode(Full)
            Navigation.titleMode(NavigationTitleMode.Full);
            // ① title: string + titleMode(Full)
            Navigation.navDestination({ builder: this.PageMap.bind(this) });
        }, Navigation);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('push1');
            Button.id('push1');
            Button.onClick(() => { this.s1.pushPathByName('d1', undefined); });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('root1');
            Text.id('root1');
        }, Text);
        Text.pop();
        // ① title: string + titleMode(Full)
        Navigation.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ② title: {main, sub} + titleMode(Free)
            Navigation.create(this.s2, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavBarDemo", isUserCreateStack: true });
            // ② title: {main, sub} + titleMode(Free)
            Navigation.id('nb-t2');
            // ② title: {main, sub} + titleMode(Free)
            Navigation.width(300);
            // ② title: {main, sub} + titleMode(Free)
            Navigation.height(170);
            // ② title: {main, sub} + titleMode(Free)
            Navigation.title({ main: 'M2', sub: 'S2' });
            // ② title: {main, sub} + titleMode(Free)
            Navigation.titleMode(NavigationTitleMode.Free);
            // ② title: {main, sub} + titleMode(Free)
            Navigation.navDestination({ builder: this.PageMap.bind(this) });
        }, Navigation);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('root2');
            Text.id('root2');
        }, Text);
        Text.pop();
        // ② title: {main, sub} + titleMode(Free)
        Navigation.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ③ title: CustomBuilder + options（backgroundColor）
            Navigation.create(this.s3, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavBarDemo", isUserCreateStack: true });
            // ③ title: CustomBuilder + options（backgroundColor）
            Navigation.id('nb-t3');
            // ③ title: CustomBuilder + options（backgroundColor）
            Navigation.width(300);
            // ③ title: CustomBuilder + options（backgroundColor）
            Navigation.height(120);
            // ③ title: CustomBuilder + options（backgroundColor）
            Navigation.title({ builder: this.SynthTitle.bind(this) }, { backgroundColor: '#eeeeee' });
            // ③ title: CustomBuilder + options（backgroundColor）
            Navigation.titleMode(NavigationTitleMode.Mini);
            // ③ title: CustomBuilder + options（backgroundColor）
            Navigation.navDestination({ builder: this.PageMap.bind(this) });
        }, Navigation);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('root3');
            Text.id('root3');
        }, Text);
        Text.pop();
        // ③ title: CustomBuilder + options（backgroundColor）
        Navigation.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ④ title: NavigationCustomTitle{builder, height: TitleHeight.MainOnly} —— 文档说此时 titleMode 不生效
            Navigation.create(this.s4, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavBarDemo", isUserCreateStack: true });
            // ④ title: NavigationCustomTitle{builder, height: TitleHeight.MainOnly} —— 文档说此时 titleMode 不生效
            Navigation.id('nb-t4');
            // ④ title: NavigationCustomTitle{builder, height: TitleHeight.MainOnly} —— 文档说此时 titleMode 不生效
            Navigation.width(300);
            // ④ title: NavigationCustomTitle{builder, height: TitleHeight.MainOnly} —— 文档说此时 titleMode 不生效
            Navigation.height(120);
            // ④ title: NavigationCustomTitle{builder, height: TitleHeight.MainOnly} —— 文档说此时 titleMode 不生效
            Navigation.title({ builder: this.SynthTitle.bind(this), height: TitleHeight.MainWithSub });
            // ④ title: NavigationCustomTitle{builder, height: TitleHeight.MainOnly} —— 文档说此时 titleMode 不生效
            Navigation.titleMode(NavigationTitleMode.Mini);
            // ④ title: NavigationCustomTitle{builder, height: TitleHeight.MainOnly} —— 文档说此时 titleMode 不生效
            Navigation.navDestination({ builder: this.PageMap.bind(this) });
        }, Navigation);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('root4');
            Text.id('root4');
        }, Text);
        Text.pop();
        // ④ title: NavigationCustomTitle{builder, height: TitleHeight.MainOnly} —— 文档说此时 titleMode 不生效
        Navigation.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ⑤ hideTitleBar(true)（两参形式也走一次，确认 animated 被接受）
            Navigation.create(this.s5, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavBarDemo", isUserCreateStack: true });
            // ⑤ hideTitleBar(true)（两参形式也走一次，确认 animated 被接受）
            Navigation.id('nb-t5');
            // ⑤ hideTitleBar(true)（两参形式也走一次，确认 animated 被接受）
            Navigation.width(300);
            // ⑤ hideTitleBar(true)（两参形式也走一次，确认 animated 被接受）
            Navigation.height(80);
            // ⑤ hideTitleBar(true)（两参形式也走一次，确认 animated 被接受）
            Navigation.title('T5');
            // ⑤ hideTitleBar(true)（两参形式也走一次，确认 animated 被接受）
            Navigation.hideTitleBar(true);
            // ⑤ hideTitleBar(true)（两参形式也走一次，确认 animated 被接受）
            Navigation.navDestination({ builder: this.PageMap.bind(this) });
        }, Navigation);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('root5');
            Text.id('root5');
        }, Text);
        Text.pop();
        // ⑤ hideTitleBar(true)（两参形式也走一次，确认 animated 被接受）
        Navigation.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ⑥ Split + navBarWidth(200) + navBarPosition(Start)
            Navigation.create(this.s6, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavBarDemo", isUserCreateStack: true });
            // ⑥ Split + navBarWidth(200) + navBarPosition(Start)
            Navigation.id('nb-t6');
            // ⑥ Split + navBarWidth(200) + navBarPosition(Start)
            Navigation.width(700);
            // ⑥ Split + navBarWidth(200) + navBarPosition(Start)
            Navigation.height(140);
            // ⑥ Split + navBarWidth(200) + navBarPosition(Start)
            Navigation.title('T6');
            // ⑥ Split + navBarWidth(200) + navBarPosition(Start)
            Navigation.mode(NavigationMode.Split);
            // ⑥ Split + navBarWidth(200) + navBarPosition(Start)
            Navigation.navBarWidth(200);
            // ⑥ Split + navBarWidth(200) + navBarPosition(Start)
            Navigation.navBarPosition(NavBarPosition.Start);
            // ⑥ Split + navBarWidth(200) + navBarPosition(Start)
            Navigation.navDestination({ builder: this.PageMap.bind(this) });
        }, Navigation);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('push6');
            Button.id('push6');
            Button.onClick(() => { this.s6.pushPathByName('d1', undefined); });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('root6');
            Text.id('root6');
        }, Text);
        Text.pop();
        // ⑥ Split + navBarWidth(200) + navBarPosition(Start)
        Navigation.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ⑦ Split + navBarPosition(End)
            Navigation.create(this.s7, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavBarDemo", isUserCreateStack: true });
            // ⑦ Split + navBarPosition(End)
            Navigation.id('nb-t7');
            // ⑦ Split + navBarPosition(End)
            Navigation.width(700);
            // ⑦ Split + navBarPosition(End)
            Navigation.height(120);
            // ⑦ Split + navBarPosition(End)
            Navigation.title('T7');
            // ⑦ Split + navBarPosition(End)
            Navigation.mode(NavigationMode.Split);
            // ⑦ Split + navBarPosition(End)
            Navigation.navBarWidth(180);
            // ⑦ Split + navBarPosition(End)
            Navigation.navBarPosition(NavBarPosition.End);
            // ⑦ Split + navBarPosition(End)
            Navigation.navDestination({ builder: this.PageMap.bind(this) });
        }, Navigation);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('root7');
            Text.id('root7');
        }, Text);
        Text.pop();
        // ⑦ Split + navBarPosition(End)
        Navigation.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ⑧ mode(Auto) + 宽 700 → 按文档应走 Split
            Navigation.create(this.s8, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavBarDemo", isUserCreateStack: true });
            // ⑧ mode(Auto) + 宽 700 → 按文档应走 Split
            Navigation.id('nb-t8');
            // ⑧ mode(Auto) + 宽 700 → 按文档应走 Split
            Navigation.width(700);
            // ⑧ mode(Auto) + 宽 700 → 按文档应走 Split
            Navigation.height(120);
            // ⑧ mode(Auto) + 宽 700 → 按文档应走 Split
            Navigation.title('T8');
            // ⑧ mode(Auto) + 宽 700 → 按文档应走 Split
            Navigation.mode(NavigationMode.Auto);
            // ⑧ mode(Auto) + 宽 700 → 按文档应走 Split
            Navigation.navDestination({ builder: this.PageMap.bind(this) });
        }, Navigation);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('root8');
            Text.id('root8');
        }, Text);
        Text.pop();
        // ⑧ mode(Auto) + 宽 700 → 按文档应走 Split
        Navigation.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ⑨ mode(Auto) + 宽 400 → 按文档应走 Stack
            Navigation.create(this.s9, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavBarDemo", isUserCreateStack: true });
            // ⑨ mode(Auto) + 宽 400 → 按文档应走 Stack
            Navigation.id('nb-t9');
            // ⑨ mode(Auto) + 宽 400 → 按文档应走 Stack
            Navigation.width(400);
            // ⑨ mode(Auto) + 宽 400 → 按文档应走 Stack
            Navigation.height(120);
            // ⑨ mode(Auto) + 宽 400 → 按文档应走 Stack
            Navigation.title('T9');
            // ⑨ mode(Auto) + 宽 400 → 按文档应走 Stack
            Navigation.mode(NavigationMode.Auto);
            // ⑨ mode(Auto) + 宽 400 → 按文档应走 Stack
            Navigation.navDestination({ builder: this.PageMap.bind(this) });
        }, Navigation);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('root9');
            Text.id('root9');
        }, Text);
        Text.pop();
        // ⑨ mode(Auto) + 宽 400 → 按文档应走 Stack
        Navigation.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ⑩ hideBackButton 在【目的地】上：push d2 后不该有返回键
            Navigation.create(this.s10, { moduleName: "entry", pagePath: "entry/src/main/ets/pages/NavBarDemo", isUserCreateStack: true });
            // ⑩ hideBackButton 在【目的地】上：push d2 后不该有返回键
            Navigation.id('nb-t10');
            // ⑩ hideBackButton 在【目的地】上：push d2 后不该有返回键
            Navigation.width(300);
            // ⑩ hideBackButton 在【目的地】上：push d2 后不该有返回键
            Navigation.height(120);
            // ⑩ hideBackButton 在【目的地】上：push d2 后不该有返回键
            Navigation.title('T10');
            // ⑩ hideBackButton 在【目的地】上：push d2 后不该有返回键
            Navigation.navDestination({ builder: this.PageMap.bind(this) });
        }, Navigation);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('push10');
            Button.id('push10');
            Button.onClick(() => { this.s10.pushPathByName('d3', undefined); });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('push10d2');
            Button.id('push10d2');
            Button.onClick(() => { this.s10.pushPathByName('d2', undefined); });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('root10');
            Text.id('root10');
        }, Text);
        Text.pop();
        // ⑩ hideBackButton 在【目的地】上：push d2 后不该有返回键
        Navigation.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('log=' + this.log);
            Text.id('nblog');
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
        return "NavBarDemo";
    }
}
registerNamedRoute(() => new NavBarDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/NavBarDemo", pageFullPath: "entry/src/main/ets/pages/NavBarDemo", integratedHsp: "false", moduleType: "followWithHap" });
