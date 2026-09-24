if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface CalendarPickerDemo_Params {
    log?: string;
}
class CalendarPickerDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: CalendarPickerDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
    }
    updateStateVars(params: CalendarPickerDemo_Params) {
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
            // ① 基础：固定 selected 2024-10-08；markToday 只记 dataset（本月不含系统今天）
            CalendarPicker.create({ selected: new Date(2024, 9, 8), disabledDateRange: [{ start: new Date(2024, 9, 10), end: new Date(2024, 9, 12) }] });
            // ① 基础：固定 selected 2024-10-08；markToday 只记 dataset（本月不含系统今天）
            CalendarPicker.id('cp1');
            // ① 基础：固定 selected 2024-10-08；markToday 只记 dataset（本月不含系统今天）
            CalendarPicker.edgeAlign(CalendarAlign.START);
            // ① 基础：固定 selected 2024-10-08；markToday 只记 dataset（本月不含系统今天）
            CalendarPicker.markToday(true);
            // ① 基础：固定 selected 2024-10-08；markToday 只记 dataset（本月不含系统今天）
            CalendarPicker.onChange((d: Date) => {
                this.log = this.log + 'CHG' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ';';
            });
        }, CalendarPicker);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ② start/end 钳制：selected 2024-9-25 < start → 夹到 2024-10-05（真机 AdjustDateToRange）
            CalendarPicker.create({ selected: new Date(2024, 8, 25), start: new Date(2024, 9, 5), end: new Date(2024, 9, 20) });
            // ② start/end 钳制：selected 2024-9-25 < start → 夹到 2024-10-05（真机 AdjustDateToRange）
            CalendarPicker.id('cp2');
        }, CalendarPicker);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ③ 静态弹层 CalendarPickerDialog.show：onAccept/onCancel
            Button.createWithLabel('dlg');
            // ③ 静态弹层 CalendarPickerDialog.show：onAccept/onCancel
            Button.id('btn-dlg');
            // ③ 静态弹层 CalendarPickerDialog.show：onAccept/onCancel
            Button.onClick(() => {
                CalendarPickerDialog.show({
                    selected: new Date(2024, 9, 15),
                    onAccept: (d: Date) => {
                        this.log = this.log + 'ACC' + d.getDate() + ';';
                    },
                    onCancel: () => {
                        this.log = this.log + 'CAN;';
                    }
                });
            });
        }, Button);
        // ③ 静态弹层 CalendarPickerDialog.show：onAccept/onCancel
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('cp-log');
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
        return "CalendarPickerDemo";
    }
}
registerNamedRoute(() => new CalendarPickerDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/CalendarPickerDemo", pageFullPath: "entry/src/main/ets/pages/CalendarPickerDemo", integratedHsp: "false", moduleType: "followWithHap" });
