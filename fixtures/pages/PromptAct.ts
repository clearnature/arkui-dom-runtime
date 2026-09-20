if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface PromptAct_Params {
    toastState?: string;
    toastErr?: string;
    dialogState?: string;
    dialogErr?: string;
}
import promptAction from "@ohos:promptAction";
class PromptAct extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__toastState = new ObservedPropertySimplePU('', this, "toastState");
        this.__toastErr = new ObservedPropertySimplePU('', this, "toastErr");
        this.__dialogState = new ObservedPropertySimplePU('', this, "dialogState");
        this.__dialogErr = new ObservedPropertySimplePU('', this, "dialogErr");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: PromptAct_Params) {
        if (params.toastState !== undefined) {
            this.toastState = params.toastState;
        }
        if (params.toastErr !== undefined) {
            this.toastErr = params.toastErr;
        }
        if (params.dialogState !== undefined) {
            this.dialogState = params.dialogState;
        }
        if (params.dialogErr !== undefined) {
            this.dialogErr = params.dialogErr;
        }
    }
    updateStateVars(params: PromptAct_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__toastState.purgeDependencyOnElmtId(rmElmtId);
        this.__toastErr.purgeDependencyOnElmtId(rmElmtId);
        this.__dialogState.purgeDependencyOnElmtId(rmElmtId);
        this.__dialogErr.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__toastState.aboutToBeDeleted();
        this.__toastErr.aboutToBeDeleted();
        this.__dialogState.aboutToBeDeleted();
        this.__dialogErr.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __toastState: ObservedPropertySimplePU<string>;
    get toastState() {
        return this.__toastState.get();
    }
    set toastState(newValue: string) {
        this.__toastState.set(newValue);
    }
    private __toastErr: ObservedPropertySimplePU<string>;
    get toastErr() {
        return this.__toastErr.get();
    }
    set toastErr(newValue: string) {
        this.__toastErr.set(newValue);
    }
    private __dialogState: ObservedPropertySimplePU<string>;
    get dialogState() {
        return this.__dialogState.get();
    }
    set dialogState(newValue: string) {
        this.__dialogState.set(newValue);
    }
    private __dialogErr: ObservedPropertySimplePU<string>;
    get dialogErr() {
        return this.__dialogErr.get();
    }
    set dialogErr(newValue: string) {
        this.__dialogErr.set(newValue);
    }
    aboutToAppear(): void {
        // ① showToast 返回 void（.d.ts 原文：function showToast(options: ShowToastOptions): void）
        //    且 @throws 401 —— 编译器对 void 版会警告 "Function may throw exceptions. Special handling
        //    is required."（promise 版不警告）→ 即 void API 是【同步抛】，必须 try/catch
        try {
            promptAction.showToast({ message: '提示甲', duration: 1500 });
            // ② duration 越界行为（.d.ts 原文：Default value 1500；range [1500, 10000]；
            //    <1500 用默认值，>10000 取上限）—— 两条都越界，看实现是否照做
            promptAction.showToast({ message: '提示乙', duration: 100 });
            promptAction.showToast({ message: '提示丙', duration: 999999 });
            this.toastState = 'toast3;';
            // ③ 负向：缺 message → 同步抛 401
            promptAction.showToast({} as promptAction.ShowToastOptions);
            this.toastErr = 'unexpected-ok;';
        }
        catch (e) {
            this.toastErr = (this.toastState === '' ? 'first-throw:' : 'throw:') + (e as Error).message;
        }
        // ④ showDialog（Promise 形态）：点按钮后 resolve 出被点按钮的 index（从 0 起）。
        //    编译器【没有】对它警告 "may throw" → promise 版的 401 走 reject（调用方用 .catch）
        promptAction.showDialog({
            title: '对话框标题',
            message: '对话框正文',
            buttons: [{ text: '取消', color: '#666666' }, { text: '确定', color: '#007DFF' }]
        }).then((r: promptAction.ShowDialogSuccessResponse) => {
            this.dialogState = 'idx=' + r.index + ';';
        }).catch((e: Error) => {
            this.dialogErr = 'dialog-rej:' + e.message;
        });
        // ⑤ 负向：buttons 为空 —— 本实现要求非空（没有按钮的对话框无法用点击结束，
        //    与其造一个"永远点不掉"的假对话框，不如响亮失败；见 docs 已知限制）
        promptAction.showDialog({ title: '无按钮标题', message: '无按钮正文' })
            .then(() => {
            this.dialogErr = 'nobtn-unexpected-ok;';
        })
            .catch((e: Error) => {
            this.dialogErr = 'nobtn:' + e.message;
        });
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 2 });
            Column.width('100%');
            Column.height('100%');
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('toastState=' + this.toastState);
            Text.id('toast');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('toastErr=' + this.toastErr);
            Text.id('toasterr');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('dialogState=' + this.dialogState);
            Text.id('dlg');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('dialogErr=' + this.dialogErr);
            Text.id('dlgerr');
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
        return "PromptAct";
    }
}
registerNamedRoute(() => new PromptAct(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/PromptAct", pageFullPath: "entry/src/main/ets/pages/PromptAct", integratedHsp: "false", moduleType: "followWithHap" });
