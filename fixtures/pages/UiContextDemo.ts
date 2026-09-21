if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface UiContextDemo_Params {
    log?: string;
    msg?: string;
}
class UiContextDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.__msg = new ObservedPropertySimplePU('A', this, "msg");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: UiContextDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.msg !== undefined) {
            this.msg = params.msg;
        }
    }
    updateStateVars(params: UiContextDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
        this.__msg.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
        this.__msg.aboutToBeDeleted();
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
    private __msg: ObservedPropertySimplePU<string>;
    get msg() {
        return this.__msg.get();
    }
    set msg(newValue: string) {
        this.__msg.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('go');
            Button.id('go-btn');
            Button.onClick(() => {
                const ui = this.getUIContext();
                // ① 拿到的是对象面（typeof object = 1）
                this.log = this.log + 'UI' + (typeof ui === 'object' ? 1 : 0) + ';';
                // ② animateTo 走显式动画管道
                ui.animateTo({ duration: 200 }, () => { this.msg = 'B'; });
                // ③ getRouter 返回路由面（Router.pushUrl 可用性即真值）
                const router = ui.getRouter();
                this.log = this.log + 'RT' + (typeof router.pushUrl === 'function' ? 1 : 0) + ';';
                // ④ runScopedTask 立即执行
                ui.runScopedTask(() => { this.log = this.log + 'SC;'; });
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.msg);
            Text.id('uc-msg');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('uc-log');
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
        return "UiContextDemo";
    }
}
registerNamedRoute(() => new UiContextDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/UiContextDemo", pageFullPath: "entry/src/main/ets/pages/UiContextDemo", integratedHsp: "false", moduleType: "followWithHap" });
