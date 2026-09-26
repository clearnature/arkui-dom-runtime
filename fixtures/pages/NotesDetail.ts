if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface NotesDetail_Params {
    idx?: number;
    title?: string;
}
import router from "@ohos:router";
class NotesDetail extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__idx = new ObservedPropertySimplePU(-1, this, "idx");
        this.__title = new ObservedPropertySimplePU('', this, "title");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: NotesDetail_Params) {
        if (params.idx !== undefined) {
            this.idx = params.idx;
        }
        if (params.title !== undefined) {
            this.title = params.title;
        }
    }
    updateStateVars(params: NotesDetail_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__idx.purgeDependencyOnElmtId(rmElmtId);
        this.__title.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__idx.aboutToBeDeleted();
        this.__title.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __idx: ObservedPropertySimplePU<number>;
    get idx() {
        return this.__idx.get();
    }
    set idx(newValue: number) {
        this.__idx.set(newValue);
    }
    private __title: ObservedPropertySimplePU<string>;
    get title() {
        return this.__title.get();
    }
    set title(newValue: string) {
        this.__title.set(newValue);
    }
    onPageShow() {
        const p = router.getParams() as Record<string, string>;
        if (p) {
            this.idx = Number(p.idx);
            this.title = String(p.title);
        }
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('detail idx=' + this.idx);
            Text.id('detail-idx');
            Text.fontSize(15);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('title=' + this.title);
            Text.id('detail-title');
            Text.fontSize(13);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('back');
            Button.id('btn-back');
            Button.onClick(() => {
                router.back();
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
        return "NotesDetail";
    }
}
registerNamedRoute(() => new NotesDetail(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/NotesDetail", pageFullPath: "entry/src/main/ets/pages/NotesDetail", integratedHsp: "false", moduleType: "followWithHap" });
