if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface Layout_Params {
    on?: boolean;
}
class Layout extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__on = new ObservedPropertySimplePU(false, this, "on");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: Layout_Params) {
        if (params.on !== undefined) {
            this.on = params.on;
        }
    }
    updateStateVars(params: Layout_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__on.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__on.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __on: ObservedPropertySimplePU<boolean>;
    get on() {
        return this.__on.get();
    }
    set on(newValue: boolean) {
        this.__on.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(12);
            Column.justifyContent(FlexAlign.Center);
            Column.alignItems(HorizontalAlign.Center);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('top');
            Text.fontSize(14);
            Text.width('100%');
            Text.textAlign(TextAlign.Center);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create({ space: 6 });
            Row.width('100%');
            Row.justifyContent(FlexAlign.SpaceBetween);
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('L');
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('R');
            Text.fontSize(12);
        }, Text);
        Text.pop();
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('box');
            Text.fontSize(12);
            Text.padding(6);
            Text.backgroundColor(Color.Yellow);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel(this.on ? 'on' : 'off');
            Button.onClick(() => {
                this.on = !this.on;
            });
        }, Button);
        Button.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "Layout";
    }
}
registerNamedRoute(() => new Layout(undefined, {}), "", { bundleName: "com.example.hmtest", moduleName: "entry", pagePath: "pages/Layout", pageFullPath: "entry/src/main/ets/pages/Layout", integratedHsp: "false", moduleType: "followWithHap" });
