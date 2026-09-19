if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface Detail_Params {
    token?: string;
}
import router from "@ohos:router";
import preferences from "@ohos:data.preferences";
class Detail extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__token = new ObservedPropertySimplePU('(none)', this, "token");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: Detail_Params) {
        if (params.token !== undefined) {
            this.token = params.token;
        }
    }
    updateStateVars(params: Detail_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__token.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__token.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __token: ObservedPropertySimplePU<string>;
    get token() {
        return this.__token.get();
    }
    set token(newValue: string) {
        this.__token.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 10 });
            Column.width('100%');
            Column.height('100%');
            Column.justifyContent(FlexAlign.Center);
            Column.alignItems(HorizontalAlign.Center);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('Detail');
            Text.fontSize(18);
            Text.fontWeight(FontWeight.Bold);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('token=' + this.token);
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('back');
            Button.onClick(() => {
                router.back();
            });
        }, Button);
        Button.pop();
        Column.pop();
    }
    aboutToAppear() {
        this.load();
    }
    async load() {
        const store = await preferences.getPreferences(getContext(this), 'demo_store');
        const v = await store.get('token', '(none)');
        this.token = v as string;
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "Detail";
    }
}
registerNamedRoute(() => new Detail(undefined, {}), "", { bundleName: "com.example.hmtest", moduleName: "entry", pagePath: "pages/Detail", pageFullPath: "entry/src/main/ets/pages/Detail", integratedHsp: "false", moduleType: "followWithHap" });
