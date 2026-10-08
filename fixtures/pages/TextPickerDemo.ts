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
            // ④ 多列：2 列独立滚轮，selected [1,0]
            TextPicker.create({ range: [['春', '秋'], ['早', '晚']], selected: [1, 0] });
            // ④ 多列：2 列独立滚轮，selected [1,0]
            TextPicker.id('tx4');
            // ④ 多列：2 列独立滚轮，selected [1,0]
            TextPicker.onChange((value: string | string[], index: number | number[]) => {
                const v = Array.isArray(value) ? value.join('/') : String(value);
                const i = Array.isArray(index) ? index.join('/') : String(index);
                this.log = this.log + 'M' + v + ':' + i + ';';
            });
        }, TextPicker);
        // ④ 多列：2 列独立滚轮，selected [1,0]
        TextPicker.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ⑤ 级联：父变 → 子列选项联动重置
            TextPicker.create({
                range: [
                    { text: '菜', children: [{ text: '鱼' }, { text: '肉' }] },
                    { text: '果', children: [{ text: '桃' }] }
                ]
            });
            // ⑤ 级联：父变 → 子列选项联动重置
            TextPicker.id('tx5');
            // ⑤ 级联：父变 → 子列选项联动重置
            TextPicker.onChange((value: string | string[], index: number | number[]) => {
                const v = Array.isArray(value) ? value.join('/') : String(value);
                const i = Array.isArray(index) ? index.join('/') : String(index);
                this.log = this.log + 'C' + v + ':' + i + ';';
            });
        }, TextPicker);
        // ⑤ 级联：父变 → 子列选项联动重置
        TextPicker.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ⑦ R168：canLoop(false)——循环滚轮关闭对照组（缺省 true，text_picker.d.ts:487
            //   "Default value: **true**"；真机截图裁定=全高展开循环滚轮）
            TextPicker.create({ range: ['甲', '乙', '丙'], selected: 0 });
            // ⑦ R168：canLoop(false)——循环滚轮关闭对照组（缺省 true，text_picker.d.ts:487
            //   "Default value: **true**"；真机截图裁定=全高展开循环滚轮）
            TextPicker.id('tx6');
            // ⑦ R168：canLoop(false)——循环滚轮关闭对照组（缺省 true，text_picker.d.ts:487
            //   "Default value: **true**"；真机截图裁定=全高展开循环滚轮）
            TextPicker.canLoop(false);
            // ⑦ R168：canLoop(false)——循环滚轮关闭对照组（缺省 true，text_picker.d.ts:487
            //   "Default value: **true**"；真机截图裁定=全高展开循环滚轮）
            TextPicker.onChange((value: string | string[], index: number | number[]) => {
                const v = Array.isArray(value) ? value.join('/') : String(value);
                const i = Array.isArray(index) ? index.join('/') : String(index);
                this.log = this.log + 'L' + v + ':' + i + ';';
            });
        }, TextPicker);
        // ⑦ R168：canLoop(false)——循环滚轮关闭对照组（缺省 true，text_picker.d.ts:487
        //   "Default value: **true**"；真机截图裁定=全高展开循环滚轮）
        TextPicker.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ⑥ 静态弹层
            Button.createWithLabel('dlg');
            // ⑥ 静态弹层
            Button.id('btn-dlg');
            // ⑥ 静态弹层
            Button.onClick(() => {
                TextPickerDialog.show({
                    range: ['甲', '乙', '丙'],
                    selected: 1,
                    onAccept: (result: TextPickerResult) => {
                        this.log = this.log + 'ACC' + result.value + ':' + result.index + ';';
                    },
                    onCancel: () => {
                        this.log = this.log + 'CAN;';
                    }
                });
            });
        }, Button);
        // ⑥ 静态弹层
        Button.pop();
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
