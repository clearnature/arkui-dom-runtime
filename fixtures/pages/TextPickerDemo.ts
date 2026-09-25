if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface TextPickerDemo_Params {
    log?: string;
}
class TextPickerDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: TextPickerDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
    }
    updateStateVars(params: TextPickerDemo_Params) {
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
            // ① 基础：四季 range，selected 1（'夏'）
            TextPicker.create({ range: ['春', '夏', '秋', '冬'], selected: 1 });
            // ① 基础：四季 range，selected 1（'夏'）
            TextPicker.id('tx1');
            // ① 基础：四季 range，selected 1（'夏'）
            TextPicker.defaultPickerItemHeight(40);
            // ① 基础：四季 range，selected 1（'夏'）
            TextPicker.onChange((value: string | string[], index: number | number[]) => {
                const v = Array.isArray(value) ? value.join('/') : value;
                const i = Array.isArray(index) ? index.join('/') : index;
                this.log = this.log + 'CHG' + v + ':' + i + ';';
            });
        }, TextPicker);
        // ① 基础：四季 range，selected 1（'夏'）
        TextPicker.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ② selectedIndex 属性覆盖：create selected 0 → 属性压成 2
            TextPicker.create({ range: ['甲', '乙', '丙'], selected: 0 });
            // ② selectedIndex 属性覆盖：create selected 0 → 属性压成 2
            TextPicker.id('tx2');
            // ② selectedIndex 属性覆盖：create selected 0 → 属性压成 2
            TextPicker.selectedIndex(2);
        }, TextPicker);
        // ② selectedIndex 属性覆盖：create selected 0 → 属性压成 2
        TextPicker.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ③ 对象形态 range（TextPickerRangeContent[]）：取 .text
            TextPicker.create({ range: [{ text: '红' }, { text: '绿' }], selected: 0 });
            // ③ 对象形态 range（TextPickerRangeContent[]）：取 .text
            TextPicker.id('tx3');
        }, TextPicker);
        // ③ 对象形态 range（TextPickerRangeContent[]）：取 .text
        TextPicker.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('tx-log');
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
        return "TextPickerDemo";
    }
}
registerNamedRoute(() => new TextPickerDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/TextPickerDemo", pageFullPath: "entry/src/main/ets/pages/TextPickerDemo", integratedHsp: "false", moduleType: "followWithHap" });
