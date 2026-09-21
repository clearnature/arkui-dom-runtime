if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface InputDemo_Params {
    log?: string;
}
class InputDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: InputDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
    }
    updateStateVars(params: InputDemo_Params) {
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
            // ① Checkbox：select(true) 编程选中 + selectedColor + onChange(bool)
            Checkbox.create({ name: 'cb1' });
            // ① Checkbox：select(true) 编程选中 + selectedColor + onChange(bool)
            Checkbox.id('ck1');
            // ① Checkbox：select(true) 编程选中 + selectedColor + onChange(bool)
            Checkbox.select(true);
            // ① Checkbox：select(true) 编程选中 + selectedColor + onChange(bool)
            Checkbox.selectedColor(Color.Red);
            // ① Checkbox：select(true) 编程选中 + selectedColor + onChange(bool)
            Checkbox.onChange((on: boolean) => { this.log = this.log + 'CK' + on + ';'; });
        }, Checkbox);
        // ① Checkbox：select(true) 编程选中 + selectedColor + onChange(bool)
        Checkbox.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ② Checkbox 编程切换（测试点 change(false)）
            Checkbox.create({ name: 'ck2' });
            // ② Checkbox 编程切换（测试点 change(false)）
            Checkbox.id('ck2');
            // ② Checkbox 编程切换（测试点 change(false)）
            Checkbox.onChange((b: boolean) => { this.log = this.log + 'CK' + b + ';'; });
        }, Checkbox);
        // ② Checkbox 编程切换（测试点 change(false)）
        Checkbox.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ③ Radio：组内互斥（两个同 group）。⚠️ RadioOptions = {value, group}，没有 name（编译期实测）
            Radio.create({ value: 'a', group: 'g1' });
            // ③ Radio：组内互斥（两个同 group）。⚠️ RadioOptions = {value, group}，没有 name（编译期实测）
            Radio.id('rd1');
            // ③ Radio：组内互斥（两个同 group）。⚠️ RadioOptions = {value, group}，没有 name（编译期实测）
            Radio.checked(true);
            // ③ Radio：组内互斥（两个同 group）。⚠️ RadioOptions = {value, group}，没有 name（编译期实测）
            Radio.onChange((b: boolean) => { this.log = this.log + 'RD' + b + ';'; });
        }, Radio);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Radio.create({ value: 'b', group: 'g1' });
            Radio.id('rd2');
            Radio.onChange((b: boolean) => { this.log = this.log + 'RD' + b + ';'; });
        }, Radio);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ④ Toggle：Switch 形态。⚠️ ToggleAttribute 没有 .select() —— 初始选中在 create 的 isOn
            Toggle.create({ type: ToggleType.Switch, isOn: true });
            // ④ Toggle：Switch 形态。⚠️ ToggleAttribute 没有 .select() —— 初始选中在 create 的 isOn
            Toggle.id('tg1');
            // ④ Toggle：Switch 形态。⚠️ ToggleAttribute 没有 .select() —— 初始选中在 create 的 isOn
            Toggle.selectedColor(Color.Green);
            // ④ Toggle：Switch 形态。⚠️ ToggleAttribute 没有 .select() —— 初始选中在 create 的 isOn
            Toggle.onChange((b: boolean) => { this.log = this.log + 'TG' + b + ';'; });
        }, Toggle);
        // ④ Toggle：Switch 形态。⚠️ ToggleAttribute 没有 .select() —— 初始选中在 create 的 isOn
        Toggle.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ⑤ Slider：value/min/max/step + 颜色 + showTips + onChange(value, mode)
            Slider.create({ value: 40, min: 0, max: 100, step: 10 });
            // ⑤ Slider：value/min/max/step + 颜色 + showTips + onChange(value, mode)
            Slider.id('sl1');
            // ⑤ Slider：value/min/max/step + 颜色 + showTips + onChange(value, mode)
            Slider.blockColor(Color.Blue);
            // ⑤ Slider：value/min/max/step + 颜色 + showTips + onChange(value, mode)
            Slider.trackColor('#dddddd');
            // ⑤ Slider：value/min/max/step + 颜色 + showTips + onChange(value, mode)
            Slider.selectedColor(Color.Orange);
            // ⑤ Slider：value/min/max/step + 颜色 + showTips + onChange(value, mode)
            Slider.showTips(true);
            // ⑤ Slider：value/min/max/step + 颜色 + showTips + onChange(value, mode)
            Slider.onChange((v: number, mode: SliderChangeMode) => { this.log = this.log + 'SL' + v + '/' + mode + ';'; });
            // ⑤ Slider：value/min/max/step + 颜色 + showTips + onChange(value, mode)
            Slider.width(200);
        }, Slider);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('in-log');
            Text.fontSize(12);
            Text.height(24);
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
        return "InputDemo";
    }
}
registerNamedRoute(() => new InputDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/InputDemo", pageFullPath: "entry/src/main/ets/pages/InputDemo", integratedHsp: "false", moduleType: "followWithHap" });
