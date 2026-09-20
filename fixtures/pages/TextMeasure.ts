if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface TextMeasurePage_Params {
    singleW?: number;
    ignoredW?: number;
    conW?: number;
    conH?: number;
    oneLineH?: number;
    wideH?: number;
    letterW?: number;
    bigLineH?: number;
    clampedH?: number;
}
import MeasureText from "@ohos:measure";
const SAMPLE: string = '这是一段用于测量换行的中文文本一共二十四个汉字';
const BOX_W: number = 100;
const FONT: number = 16;
function numOf(v: Length | undefined): number {
    return typeof v === 'number' ? v : parseFloat(String(v));
}
class TextMeasurePage extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__singleW = new ObservedPropertySimplePU(0, this, "singleW");
        this.__ignoredW = new ObservedPropertySimplePU(0, this, "ignoredW");
        this.__conW = new ObservedPropertySimplePU(0, this, "conW");
        this.__conH = new ObservedPropertySimplePU(0, this, "conH");
        this.__oneLineH = new ObservedPropertySimplePU(0, this, "oneLineH");
        this.__wideH = new ObservedPropertySimplePU(0, this, "wideH");
        this.__letterW = new ObservedPropertySimplePU(0, this, "letterW");
        this.__bigLineH = new ObservedPropertySimplePU(0, this, "bigLineH");
        this.__clampedH = new ObservedPropertySimplePU(0, this, "clampedH");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: TextMeasurePage_Params) {
        if (params.singleW !== undefined) {
            this.singleW = params.singleW;
        }
        if (params.ignoredW !== undefined) {
            this.ignoredW = params.ignoredW;
        }
        if (params.conW !== undefined) {
            this.conW = params.conW;
        }
        if (params.conH !== undefined) {
            this.conH = params.conH;
        }
        if (params.oneLineH !== undefined) {
            this.oneLineH = params.oneLineH;
        }
        if (params.wideH !== undefined) {
            this.wideH = params.wideH;
        }
        if (params.letterW !== undefined) {
            this.letterW = params.letterW;
        }
        if (params.bigLineH !== undefined) {
            this.bigLineH = params.bigLineH;
        }
        if (params.clampedH !== undefined) {
            this.clampedH = params.clampedH;
        }
    }
    updateStateVars(params: TextMeasurePage_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__singleW.purgeDependencyOnElmtId(rmElmtId);
        this.__ignoredW.purgeDependencyOnElmtId(rmElmtId);
        this.__conW.purgeDependencyOnElmtId(rmElmtId);
        this.__conH.purgeDependencyOnElmtId(rmElmtId);
        this.__oneLineH.purgeDependencyOnElmtId(rmElmtId);
        this.__wideH.purgeDependencyOnElmtId(rmElmtId);
        this.__letterW.purgeDependencyOnElmtId(rmElmtId);
        this.__bigLineH.purgeDependencyOnElmtId(rmElmtId);
        this.__clampedH.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__singleW.aboutToBeDeleted();
        this.__ignoredW.aboutToBeDeleted();
        this.__conW.aboutToBeDeleted();
        this.__conH.aboutToBeDeleted();
        this.__oneLineH.aboutToBeDeleted();
        this.__wideH.aboutToBeDeleted();
        this.__letterW.aboutToBeDeleted();
        this.__bigLineH.aboutToBeDeleted();
        this.__clampedH.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __singleW: ObservedPropertySimplePU<number>;
    get singleW() {
        return this.__singleW.get();
    }
    set singleW(newValue: number) {
        this.__singleW.set(newValue);
    }
    private __ignoredW: ObservedPropertySimplePU<number>;
    get ignoredW() {
        return this.__ignoredW.get();
    }
    set ignoredW(newValue: number) {
        this.__ignoredW.set(newValue);
    }
    private __conW: ObservedPropertySimplePU<number>;
    get conW() {
        return this.__conW.get();
    }
    set conW(newValue: number) {
        this.__conW.set(newValue);
    }
    private __conH: ObservedPropertySimplePU<number>;
    get conH() {
        return this.__conH.get();
    }
    set conH(newValue: number) {
        this.__conH.set(newValue);
    }
    private __oneLineH: ObservedPropertySimplePU<number>;
    get oneLineH() {
        return this.__oneLineH.get();
    }
    set oneLineH(newValue: number) {
        this.__oneLineH.set(newValue);
    }
    private __wideH: ObservedPropertySimplePU<number>;
    get wideH() {
        return this.__wideH.get();
    }
    set wideH(newValue: number) {
        this.__wideH.set(newValue);
    }
    private __letterW: ObservedPropertySimplePU<number>;
    get letterW() {
        return this.__letterW.get();
    }
    set letterW(newValue: number) {
        this.__letterW.set(newValue);
    }
    private __bigLineH: ObservedPropertySimplePU<number>;
    get bigLineH() {
        return this.__bigLineH.get();
    }
    set bigLineH(newValue: number) {
        this.__bigLineH.set(newValue);
    }
    private __clampedH: ObservedPropertySimplePU<number>;
    get clampedH() {
        return this.__clampedH.get();
    }
    set clampedH(newValue: number) {
        this.__clampedH.set(newValue);
    }
    aboutToAppear() {
        // 单行宽度（JSDoc：measureText 总是量单行，constraintWidth/maxLines 不影响结果）
        this.singleW = MeasureText.measureText({ textContent: SAMPLE, fontSize: FONT });
        this.ignoredW = MeasureText.measureText({
            textContent: SAMPLE, fontSize: FONT, constraintWidth: BOX_W, maxLines: 1
        });
        this.letterW = MeasureText.measureText({ textContent: SAMPLE, fontSize: FONT, letterSpacing: 4 });
        // 受约束的宽高（px）
        const sz: SizeOptions = MeasureText.measureTextSize({
            textContent: SAMPLE, fontSize: FONT, constraintWidth: BOX_W
        });
        this.conW = numOf(sz.width);
        this.conH = numOf(sz.height);
        const one: SizeOptions = MeasureText.measureTextSize({
            textContent: SAMPLE, fontSize: FONT, constraintWidth: BOX_W, maxLines: 1
        });
        this.oneLineH = numOf(one.height);
        const wide: SizeOptions = MeasureText.measureTextSize({
            textContent: SAMPLE, fontSize: FONT, constraintWidth: 1000
        });
        this.wideH = numOf(wide.height);
        const big: SizeOptions = MeasureText.measureTextSize({
            textContent: SAMPLE, fontSize: FONT, constraintWidth: BOX_W, lineHeight: 40
        });
        this.bigLineH = numOf(big.height);
        const clamped: SizeOptions = MeasureText.measureTextSize({
            textContent: SAMPLE, fontSize: FONT, constraintWidth: BOX_W, maxLines: 2
        });
        this.clampedH = numOf(clamped.height);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 2 });
            Column.width('100%');
            Column.height('100%');
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('singleW=' + this.singleW);
            Text.id('singleW');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('ignoredW=' + this.ignoredW);
            Text.id('ignoredW');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('letterW=' + this.letterW);
            Text.id('letterW');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('conW=' + this.conW);
            Text.id('conW');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('conH=' + this.conH);
            Text.id('conH');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('oneLineH=' + this.oneLineH);
            Text.id('oneLineH');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('wideH=' + this.wideH);
            Text.id('wideH');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('bigLineH=' + this.bigLineH);
            Text.id('bigLineH');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('clampedH=' + this.clampedH);
            Text.id('clampedH');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('n=' + SAMPLE.length);
            Text.id('n');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 真实渲染的对照：同一段文本、同一字号、同一宽度
            Text.create(SAMPLE);
            // 真实渲染的对照：同一段文本、同一字号、同一宽度
            Text.fontSize(FONT);
            // 真实渲染的对照：同一段文本、同一字号、同一宽度
            Text.width(BOX_W);
            // 真实渲染的对照：同一段文本、同一字号、同一宽度
            Text.id('ref');
        }, Text);
        // 真实渲染的对照：同一段文本、同一字号、同一宽度
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 显式给足宽度 → 单行
            Text.create(SAMPLE);
            // 显式给足宽度 → 单行
            Text.fontSize(FONT);
            // 显式给足宽度 → 单行
            Text.width(400);
            // 显式给足宽度 → 单行
            Text.id('refWide');
        }, Text);
        // 显式给足宽度 → 单行
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 不设宽度 → 由容器决定可用宽度（本测试页 #root 是 320px，23×16=368 > 320 所以会换行）
            Text.create(SAMPLE);
            // 不设宽度 → 由容器决定可用宽度（本测试页 #root 是 320px，23×16=368 > 320 所以会换行）
            Text.fontSize(FONT);
            // 不设宽度 → 由容器决定可用宽度（本测试页 #root 是 320px，23×16=368 > 320 所以会换行）
            Text.id('refFlow');
        }, Text);
        // 不设宽度 → 由容器决定可用宽度（本测试页 #root 是 320px，23×16=368 > 320 所以会换行）
        Text.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "TextMeasurePage";
    }
}
registerNamedRoute(() => new TextMeasurePage(undefined, {}), "", { bundleName: "com.example.hmtest", moduleName: "entry", pagePath: "pages/TextMeasure", pageFullPath: "entry/src/main/ets/pages/TextMeasure", integratedHsp: "false", moduleType: "followWithHap" });
