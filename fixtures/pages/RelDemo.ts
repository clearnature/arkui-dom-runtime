if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface RelDemo_Params {
}
class RelDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: RelDemo_Params) {
    }
    updateStateVars(params: RelDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
    }
    aboutToBeDeleted() {
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 4 });
            Column.width('100%');
            Column.height('100%');
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ① 多层锚链：c→b→a→容器。【故意逆序声明】，逼出"单趟解析不够"的问题
            RelativeContainer.create();
            // ① 多层锚链：c→b→a→容器。【故意逆序声明】，逼出"单趟解析不够"的问题
            RelativeContainer.width(300);
            // ① 多层锚链：c→b→a→容器。【故意逆序声明】，逼出"单趟解析不够"的问题
            RelativeContainer.height(200);
            // ① 多层锚链：c→b→a→容器。【故意逆序声明】，逼出"单趟解析不够"的问题
            RelativeContainer.id('rc1');
        }, RelativeContainer);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('c');
            Text.id('c');
            Text.width(40);
            Text.height(20);
            Text.alignRules({
                top: { anchor: 'b', align: VerticalAlign.Bottom },
                left: { anchor: 'b', align: HorizontalAlign.End }
            });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('b');
            Text.id('b');
            Text.width(40);
            Text.height(20);
            Text.alignRules({
                top: { anchor: 'a', align: VerticalAlign.Bottom },
                left: { anchor: 'a', align: HorizontalAlign.End }
            });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('a');
            Text.id('a');
            Text.width(40);
            Text.height(20);
            Text.alignRules({
                top: { anchor: '__container__', align: VerticalAlign.Top },
                left: { anchor: '__container__', align: HorizontalAlign.Start }
            });
        }, Text);
        Text.pop();
        // ① 多层锚链：c→b→a→容器。【故意逆序声明】，逼出"单趟解析不够"的问题
        RelativeContainer.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ② Guideline：竖线锚水平、横线锚垂直；再拿横线当水平锚（错轴 → 值 0）；再验 end 定位
            //    与"经 guideline 的链式锚"（gv2 锚 gv，gv 锚 vline）
            RelativeContainer.create();
            // ② Guideline：竖线锚水平、横线锚垂直；再拿横线当水平锚（错轴 → 值 0）；再验 end 定位
            //    与"经 guideline 的链式锚"（gv2 锚 gv，gv 锚 vline）
            RelativeContainer.guideLine([
                { id: 'vline', direction: Axis.Vertical, position: { start: '30%' } },
                { id: 'hline', direction: Axis.Horizontal, position: { start: 50 } },
                { id: 'vline2', direction: Axis.Vertical, position: { end: 30 } }
            ]);
            // ② Guideline：竖线锚水平、横线锚垂直；再拿横线当水平锚（错轴 → 值 0）；再验 end 定位
            //    与"经 guideline 的链式锚"（gv2 锚 gv，gv 锚 vline）
            RelativeContainer.width(300);
            // ② Guideline：竖线锚水平、横线锚垂直；再拿横线当水平锚（错轴 → 值 0）；再验 end 定位
            //    与"经 guideline 的链式锚"（gv2 锚 gv，gv 锚 vline）
            RelativeContainer.height(200);
            // ② Guideline：竖线锚水平、横线锚垂直；再拿横线当水平锚（错轴 → 值 0）；再验 end 定位
            //    与"经 guideline 的链式锚"（gv2 锚 gv，gv 锚 vline）
            RelativeContainer.id('rc2');
        }, RelativeContainer);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('gv');
            Text.id('gv');
            Text.width(20);
            Text.height(10);
            Text.alignRules({
                left: { anchor: 'vline', align: HorizontalAlign.Start },
                top: { anchor: '__container__', align: VerticalAlign.Top }
            });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('gh');
            Text.id('gh');
            Text.width(20);
            Text.height(10);
            Text.alignRules({
                top: { anchor: 'hline', align: VerticalAlign.Top },
                left: { anchor: '__container__', align: HorizontalAlign.Start }
            });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('gx');
            Text.id('gx');
            Text.width(20);
            Text.height(10);
            Text.alignRules({
                left: { anchor: 'hline', align: HorizontalAlign.Center }
            });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('gv2');
            Text.id('gv2');
            Text.width(20);
            Text.height(10);
            Text.alignRules({
                left: { anchor: 'gv', align: HorizontalAlign.End },
                top: { anchor: '__container__', align: VerticalAlign.Top }
            });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('gv3');
            Text.id('gv3');
            Text.width(20);
            Text.height(10);
            Text.alignRules({
                left: { anchor: 'vline2', align: HorizontalAlign.Start },
                top: { anchor: '__container__', align: VerticalAlign.Top }
            });
        }, Text);
        Text.pop();
        // ② Guideline：竖线锚水平、横线锚垂直；再拿横线当水平锚（错轴 → 值 0）；再验 end 定位
        //    与"经 guideline 的链式锚"（gv2 锚 gv，gv 锚 vline）
        RelativeContainer.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ③ bias：左右同时锚定时决定位置；0.5 居中（默认）
            RelativeContainer.create();
            // ③ bias：左右同时锚定时决定位置；0.5 居中（默认）
            RelativeContainer.width(300);
            // ③ bias：左右同时锚定时决定位置；0.5 居中（默认）
            RelativeContainer.height(100);
            // ③ bias：左右同时锚定时决定位置；0.5 居中（默认）
            RelativeContainer.id('rc3');
        }, RelativeContainer);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('b2');
            Text.id('b2');
            Text.width(20);
            Text.height(10);
            Text.alignRules({
                left: { anchor: '__container__', align: HorizontalAlign.Start },
                right: { anchor: '__container__', align: HorizontalAlign.End },
                bias: { horizontal: 0.2 }
            });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('b8');
            Text.id('b8');
            Text.width(20);
            Text.height(10);
            Text.alignRules({
                left: { anchor: '__container__', align: HorizontalAlign.Start },
                right: { anchor: '__container__', align: HorizontalAlign.End },
                bias: { horizontal: 0.8 }
            });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('bd');
            Text.id('bd');
            Text.width(20);
            Text.height(10);
            Text.alignRules({
                left: { anchor: '__container__', align: HorizontalAlign.Start },
                right: { anchor: '__container__', align: HorizontalAlign.End }
            });
        }, Text);
        Text.pop();
        // ③ bias：左右同时锚定时决定位置；0.5 居中（默认）
        RelativeContainer.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "RelDemo";
    }
}
registerNamedRoute(() => new RelDemo(undefined, {}), "", { bundleName: "com.example.hmtest", moduleName: "entry", pagePath: "pages/RelDemo", pageFullPath: "entry/src/main/ets/pages/RelDemo", integratedHsp: "false", moduleType: "followWithHap" });
