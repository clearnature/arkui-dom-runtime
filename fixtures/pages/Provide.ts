if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface ProvideDemo_Params {
    theme?: string;
    watched?: number;
    log?: string;
}
interface ChildC_Params {
    theme?: string;
}
class ChildC extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__theme = this.initializeConsume('theme', "theme");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: ChildC_Params) {
    }
    updateStateVars(params: ChildC_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__theme.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__theme.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __theme: ObservedPropertyAbstractPU<string>;
    get theme() {
        return this.__theme.get();
    }
    set theme(newValue: string) {
        this.__theme.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('child:' + this.theme);
            Text.fontSize(12);
        }, Text);
        Text.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
        this.__reInitializeConsume__Internal('theme', "theme");
    }
}
class ProvideDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__theme = new ObservedPropertySimplePU('dark', this, "theme");
        this.addProvidedVar("theme", this.__theme, false);
        this.__watched = new ObservedPropertySimplePU(0, this, "watched");
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.setInitiallyProvidedValue(params);
        this.declareWatch("watched", this.onWatchedChange);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: ProvideDemo_Params) {
        if (params.theme !== undefined) {
            this.theme = params.theme;
        }
        if (params.watched !== undefined) {
            this.watched = params.watched;
        }
        if (params.log !== undefined) {
            this.log = params.log;
        }
    }
    updateStateVars(params: ProvideDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__theme.purgeDependencyOnElmtId(rmElmtId);
        this.__watched.purgeDependencyOnElmtId(rmElmtId);
        this.__log.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__theme.aboutToBeDeleted();
        this.__watched.aboutToBeDeleted();
        this.__log.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __theme: ObservedPropertySimplePU<string>;
    get theme() {
        return this.__theme.get();
    }
    set theme(newValue: string) {
        this.__theme.set(newValue);
    }
    private __watched: ObservedPropertySimplePU<number>;
    get watched() {
        return this.__watched.get();
    }
    set watched(newValue: number) {
        this.__watched.set(newValue);
    }
    private __log: ObservedPropertySimplePU<string>;
    get log() {
        return this.__log.get();
    }
    set log(newValue: string) {
        this.__log.set(newValue);
    }
    onWatchedChange(propName: string): void {
        this.log = this.log + 'w';
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.width('100%');
            Column.height('100%');
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('Provide');
            Text.fontSize(16);
            Text.fontWeight(FontWeight.Bold);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('theme=' + this.theme);
            Text.fontSize(12);
        }, Text);
        Text.pop();
        {
            this.observeComponentCreation2((elmtId, isInitialRender) => {
                if (isInitialRender) {
                    let componentCall = new ChildC(this, {}, undefined, elmtId, () => { }, { page: "entry/src/main/ets/pages/Provide.ets", line: 28, col: 7 });
                    ViewPU.create(componentCall);
                    let paramsLambda = () => {
                        return {};
                    };
                    componentCall.paramsGenerator_ = paramsLambda;
                }
                else {
                    this.updateStateVarsOfChildByElmtId(elmtId, {});
                }
            }, { name: "ChildC" });
        }
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('watched=' + this.watched);
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('log=' + this.log);
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('flip');
            Button.onClick(() => {
                this.theme = this.theme === 'dark' ? 'light' : 'dark';
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('bump');
            Button.onClick(() => {
                this.watched = this.watched + 1;
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
        return "ProvideDemo";
    }
}
registerNamedRoute(() => new ProvideDemo(undefined, {}), "", { bundleName: "com.example.hmtest", moduleName: "entry", pagePath: "pages/Provide", pageFullPath: "entry/src/main/ets/pages/Provide", integratedHsp: "false", moduleType: "followWithHap" });
