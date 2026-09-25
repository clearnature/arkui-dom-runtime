if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface TextTimeDemo_Params {
    log?: string;
    clockCtrl?: TextClockController;
    timerCtrl?: TextTimerController;
}
class TextTimeDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.clockCtrl = new TextClockController();
        this.timerCtrl = new TextTimerController();
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: TextTimeDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.clockCtrl !== undefined) {
            this.clockCtrl = params.clockCtrl;
        }
        if (params.timerCtrl !== undefined) {
            this.timerCtrl = params.timerCtrl;
        }
    }
    updateStateVars(params: TextTimeDemo_Params) {
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
    private clockCtrl: TextClockController;
    private timerCtrl: TextTimerController;
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TextClock.create({ controller: this.clockCtrl });
            TextClock.id('tck');
            TextClock.format('HH:mm:ss');
        }, TextClock);
        TextClock.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TextTimer.create({ controller: this.timerCtrl, startTime: 5000, isCountDown: true });
            TextTimer.id('ttd');
            TextTimer.format('HH:mm:ss.SS');
            TextTimer.onTimer((utc: number, elapsedTime: number) => {
                this.log = this.log + 'TD' + elapsedTime + ';';
            });
        }, TextTimer);
        TextTimer.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TextTimer.create({ controller: new TextTimerController(), startTime: 0, isCountDown: false });
            TextTimer.id('ttu');
            TextTimer.format('mm:ss.SS');
            TextTimer.onTimer((utc: number, elapsedTime: number) => {
                this.log = this.log + 'TU' + elapsedTime + ';';
            });
        }, TextTimer);
        TextTimer.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('start');
            Button.id('btn-start');
            Button.onClick(() => {
                this.timerCtrl.start();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('pause');
            Button.id('btn-pause');
            Button.onClick(() => {
                this.timerCtrl.pause();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('reset');
            Button.id('btn-reset');
            Button.onClick(() => {
                this.timerCtrl.reset();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('tt-log');
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
        return "TextTimeDemo";
    }
}
registerNamedRoute(() => new TextTimeDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/TextTimeDemo", pageFullPath: "entry/src/main/ets/pages/TextTimeDemo", integratedHsp: "false", moduleType: "followWithHap" });
