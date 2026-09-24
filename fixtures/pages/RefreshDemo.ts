if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface RefreshDemo_Params {
    log?: string;
    rf1On?: boolean;
}
class RefreshDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.__rf1On = new ObservedPropertySimplePU(false, this, "rf1On");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: RefreshDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.rf1On !== undefined) {
            this.rf1On = params.rf1On;
        }
    }
    updateStateVars(params: RefreshDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
        this.__rf1On.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
        this.__rf1On.aboutToBeDeleted();
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
    private __rf1On: ObservedPropertySimplePU<boolean>;
    get rf1On() {
        return this.__rf1On.get();
    }
    set rf1On(newValue: boolean) {
        this.__rf1On.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Refresh.create({ refreshing: this.rf1On });
            Refresh.id('rf1');
            Refresh.width(300);
            Refresh.height(200);
            Refresh.onStateChange((state) => {
                this.log = this.log + 'A' + state + ';';
            });
            Refresh.onRefreshing(() => {
                this.log = this.log + 'AR;';
                // 真机 app 模式：onRefreshing 里回写 refreshing=true，定时后 false 结束刷新
                this.rf1On = true;
                setTimeout(() => { this.rf1On = false; }, 600);
            });
            Refresh.onOffsetChange((off) => {
                this.log = this.log + 'AO' + Math.round(off) + ';';
            });
        }, Refresh);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 4 });
            Column.width('100%');
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('card-A');
            Text.id('ca');
            Text.height(60);
            Text.width('100%');
        }, Text);
        Text.pop();
        Column.pop();
        Refresh.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('stop');
            Button.id('btn-stop');
            Button.onClick(() => {
                this.rf1On = false;
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Refresh.create({ refreshing: false });
            Refresh.id('rf2');
            Refresh.width(300);
            Refresh.height(120);
            Refresh.refreshOffset(50);
            Refresh.maxPullDownDistance(80);
            Refresh.pullDownRatio(1);
            Refresh.onStateChange((state) => {
                this.log = this.log + 'B' + state + ';';
            });
            Refresh.onRefreshing(() => {
                this.log = this.log + 'BR;';
            });
            Refresh.onOffsetChange((off) => {
                this.log = this.log + 'BO' + Math.round(off) + ';';
            });
        }, Refresh);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('card-B');
            Text.id('cb');
            Text.height(60);
            Text.width('100%');
        }, Text);
        Text.pop();
        Refresh.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Refresh.create({ refreshing: false });
            Refresh.id('rf3');
            Refresh.width(300);
            Refresh.height(120);
            Refresh.pullToRefresh(false);
            Refresh.onStateChange((state) => {
                this.log = this.log + 'C' + state + ';';
            });
        }, Refresh);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('card-C');
            Text.id('cc');
            Text.height(60);
            Text.width('100%');
        }, Text);
        Text.pop();
        Refresh.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('rf-log');
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
        return "RefreshDemo";
    }
}
registerNamedRoute(() => new RefreshDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/RefreshDemo", pageFullPath: "entry/src/main/ets/pages/RefreshDemo", integratedHsp: "false", moduleType: "followWithHap" });
