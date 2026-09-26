if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface WindowDemo_Params {
    log?: string;
    lastSize?: string;
}
import window from "@ohos:window";
class WindowDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.__lastSize = new ObservedPropertySimplePU('', this, "lastSize");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: WindowDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.lastSize !== undefined) {
            this.lastSize = params.lastSize;
        }
    }
    updateStateVars(params: WindowDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
        this.__lastSize.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
        this.__lastSize.aboutToBeDeleted();
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
    private __lastSize: ObservedPropertySimplePU<string>;
    get lastSize() {
        return this.__lastSize.get();
    }
    set lastSize(newValue: string) {
        this.__lastSize.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('bg');
            Button.id('btn-bg');
            Button.onClick(() => {
                window.getLastWindow(getContext(this)).then((w: window.Window) => {
                    return w.setWindowBackgroundColor('#223344');
                }).then(() => {
                    this.log = this.log + 'bg;';
                });
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('resize');
            Button.id('btn-resize');
            Button.onClick(() => {
                window.getLastWindow(getContext(this)).then((w: window.Window) => {
                    return w.resize(600, 500);
                }).then(() => {
                    this.log = this.log + 'resize;';
                });
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('move');
            Button.id('btn-move');
            Button.onClick(() => {
                window.getLastWindow(getContext(this)).then((w: window.Window) => {
                    return w.moveTo(40, 40);
                }).then(() => {
                    this.log = this.log + 'move;';
                });
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('listen');
            Button.id('btn-listen');
            Button.onClick(() => {
                window.getLastWindow(getContext(this)).then((w: window.Window) => {
                    w.on('windowSizeChange', (sz: window.Size) => {
                        this.lastSize = sz.width + 'x' + sz.height;
                    });
                    this.log = this.log + 'listen;';
                });
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('fullscreen');
            Button.id('btn-fs');
            Button.onClick(() => {
                window.getLastWindow(getContext(this)).then((w: window.Window) => {
                    return w.setFullScreen(true).then((): window.Window => w);
                }).then((w: window.Window) => {
                    return w.getWindowProperties();
                }).then((p: window.WindowProperties) => {
                    this.lastSize = 'fs=' + (p.isFullScreen ? '1' : '0');
                    this.log = this.log + 'fs;';
                });
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('log=' + this.log);
            Text.id('win-log');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('size=' + this.lastSize);
            Text.id('win-size');
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
        return "WindowDemo";
    }
}
registerNamedRoute(() => new WindowDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/WindowDemo", pageFullPath: "entry/src/main/ets/pages/WindowDemo", integratedHsp: "false", moduleType: "followWithHap" });
