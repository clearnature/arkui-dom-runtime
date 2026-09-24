if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface TimePickerDemo_Params {
    log?: string;
}
class TimePickerDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: TimePickerDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
    }
    updateStateVars(params: TimePickerDemo_Params) {
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
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TimePicker.create({ selected: new Date(2026, 8, 15, 14, 5, 3), format: TimePickerFormat.HOUR_MINUTE_SECOND });
            TimePicker.id('tp1');
            TimePicker.useMilitaryTime(true);
            TimePicker.width(300);
            TimePicker.onChange((v: TimePickerResult) => {
                this.log = this.log + 'C' + v.hour + ':' + v.minute + ';';
            });
        }, TimePicker);
        TimePicker.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TimePicker.create({ selected: new Date(2026, 8, 15, 0, 30, 0) });
            TimePicker.id('tp2');
            TimePicker.useMilitaryTime(false);
            TimePicker.width(300);
        }, TimePicker);
        TimePicker.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TimePicker.create({ selected: new Date(2026, 8, 15, 5, 7, 0) });
            TimePicker.id('tp3');
            TimePicker.useMilitaryTime(true);
            TimePicker.width(300);
        }, TimePicker);
        TimePicker.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('tp-log');
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
        return "TimePickerDemo";
    }
}
registerNamedRoute(() => new TimePickerDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/TimePickerDemo", pageFullPath: "entry/src/main/ets/pages/TimePickerDemo", integratedHsp: "false", moduleType: "followWithHap" });
