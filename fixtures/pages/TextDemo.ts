if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface TextDemo_Params {
    log?: string;
    inputVal?: string;
    submitCtrl?: TextInputController;
}
class TextDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.__inputVal = new ObservedPropertySimplePU('seed', this, "inputVal");
        this.submitCtrl = new TextInputController();
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: TextDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.inputVal !== undefined) {
            this.inputVal = params.inputVal;
        }
        if (params.submitCtrl !== undefined) {
            this.submitCtrl = params.submitCtrl;
        }
    }
    updateStateVars(params: TextDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
        this.__inputVal.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
        this.__inputVal.aboutToBeDeleted();
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
    private __inputVal: ObservedPropertySimplePU<string>;
    get inputVal() {
        return this.__inputVal.get();
    }
    set inputVal(newValue: string) {
        this.__inputVal.set(newValue);
    }
    private submitCtrl: TextInputController;
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ① TextInput：placeholder + 初始 text + maxLength(4) 截断 + onChange/onSubmit
            TextInput.create({ placeholder: 'please type', text: this.inputVal });
            // ① TextInput：placeholder + 初始 text + maxLength(4) 截断 + onChange/onSubmit
            TextInput.id('ti1');
            // ① TextInput：placeholder + 初始 text + maxLength(4) 截断 + onChange/onSubmit
            TextInput.maxLength(4);
            // ① TextInput：placeholder + 初始 text + maxLength(4) 截断 + onChange/onSubmit
            TextInput.caretColor(Color.Red);
            // ① TextInput：placeholder + 初始 text + maxLength(4) 截断 + onChange/onSubmit
            TextInput.onChange((v: string) => { this.log = this.log + 'TI' + v + ';'; });
            // ① TextInput：placeholder + 初始 text + maxLength(4) 截断 + onChange/onSubmit
            TextInput.onSubmit((k: EnterKeyType, ev: SubmitEvent) => { this.log = this.log + 'SUB' + k + ';'; });
            // ① TextInput：placeholder + 初始 text + maxLength(4) 截断 + onChange/onSubmit
            TextInput.onEditChanged((editing: boolean) => { this.log = this.log + 'EDIT' + editing + ';'; });
        }, TextInput);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ② TextArea：placeholder + onChange
            TextArea.create({ placeholder: 'long text here' });
            // ② TextArea：placeholder + onChange
            TextArea.id('ta1');
            // ② TextArea：placeholder + onChange
            TextArea.onChange((v: string) => { this.log = this.log + 'TA' + v + ';'; });
            // ② TextArea：placeholder + onChange
            TextArea.width('100%');
        }, TextArea);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ③ Search：value + onChange
            Search.create({ value: 'hello' });
            // ③ Search：value + onChange
            Search.id('se1');
            // ③ Search：value + onChange
            Search.onChange((v: string) => { this.log = this.log + 'SE' + v + ';'; });
        }, Search);
        // ③ Search：value + onChange
        Search.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ④ Hyperlink：address + content
            Hyperlink.create('https://example.com/doc', 'open doc');
            // ④ Hyperlink：address + content
            Hyperlink.id('hl1');
            // ④ Hyperlink：address + content
            Hyperlink.color('#0066cc');
        }, Hyperlink);
        // ④ Hyperlink：address + content
        Hyperlink.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('txt-log');
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
        return "TextDemo";
    }
}
registerNamedRoute(() => new TextDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/TextDemo", pageFullPath: "entry/src/main/ets/pages/TextDemo", integratedHsp: "false", moduleType: "followWithHap" });
