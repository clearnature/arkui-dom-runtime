if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface DatePickerDemo_Params {
    log?: string;
}
class DatePickerDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: DatePickerDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
    }
    updateStateVars(params: DatePickerDemo_Params) {
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
            DatePicker.create({ start: new Date(2020, 0, 1), end: new Date(2024, 11, 31), selected: new Date(2024, 0, 15) });
            DatePicker.id('dp1');
            DatePicker.onChange((v: DatePickerResult) => {
                this.log = this.log + 'CHG' + v.year + '-' + v.month + '-' + v.day + ';';
            });
            DatePicker.onDateChange((d: Date) => {
                this.log = this.log + 'DCHG' + d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate() + ';';
            });
        }, DatePicker);
        DatePicker.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            DatePicker.create({ start: new Date(2023, 1, 1), end: new Date(2023, 1, 28), selected: new Date(2023, 1, 10) });
            DatePicker.id('dp2');
        }, DatePicker);
        DatePicker.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            DatePicker.create({ start: new Date(2024, 1, 1), end: new Date(2024, 1, 29), selected: new Date(2024, 1, 28) });
            DatePicker.id('dp3');
        }, DatePicker);
        DatePicker.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            DatePicker.create({ start: new Date(2024, 0, 31), end: new Date(2024, 11, 31), selected: new Date(2024, 0, 31) });
            DatePicker.id('dp4');
            DatePicker.onChange((v: DatePickerResult) => {
                this.log = this.log + 'CHG' + v.year + '-' + v.month + '-' + v.day + ';';
            });
        }, DatePicker);
        DatePicker.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            DatePicker.create({ start: new Date(2020, 0, 1), end: new Date(2024, 11, 31), selected: new Date(2024, 0, 15), mode: DatePickerMode.YEAR_AND_MONTH });
            DatePicker.id('dp5');
        }, DatePicker);
        DatePicker.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            DatePicker.create({ selected: new Date(2024, 0, 15) });
            DatePicker.id('dp6');
            DatePicker.lunar(true);
        }, DatePicker);
        DatePicker.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('bump');
            Button.id('btn-b');
            Button.onClick(() => { this.log = this.log + 'B;'; });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('dp-log');
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
        return "DatePickerDemo";
    }
}
registerNamedRoute(() => new DatePickerDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/DatePickerDemo", pageFullPath: "entry/src/main/ets/pages/DatePickerDemo", integratedHsp: "false", moduleType: "followWithHap" });
