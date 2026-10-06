if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface WinSem_Params {
    log?: string;
}
import window from "@ohos:window";
class WinSem extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: WinSem_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
    }
    updateStateVars(params: WinSem_Params) {
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
    aboutToAppear() {
        window.getLastWindow(getContext(this)).then((w: window.Window) => {
            w.on('windowEvent', (t: window.WindowEventType) => {
                this.log = this.log + 'E' + Number(t) + ';';
            });
            w.maximize().then(() => {
                this.log = this.log + 'max:F' + (w.isFocused() ? 1 : 0) + ';';
                setTimeout(() => {
                    w.restore().then(() => {
                        this.log = this.log + 'res:F' + (w.isFocused() ? 1 : 0) + ';';
                    }).catch((e: Error) => {
                        this.log = this.log + 'ERRr:' + e.message + ';';
                    });
                }, 500);
            }).catch((e: Error) => {
                this.log = this.log + 'ERRm:' + e.message + ';';
            });
        }).catch((e: Error) => {
            this.log = this.log + 'ERRw:' + e.message + ';';
        });
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('winsem log=' + this.log);
            Text.id('ws-log');
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
        return "WinSem";
    }
}
registerNamedRoute(() => new WinSem(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/WinSem", pageFullPath: "entry/src/main/ets/pages/WinSem", integratedHsp: "false", moduleType: "followWithHap" });
