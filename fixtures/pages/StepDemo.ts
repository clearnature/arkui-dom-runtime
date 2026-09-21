if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface StepDemo_Params {
    log?: string;
    idx?: number;
}
class StepDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.__idx = new ObservedPropertySimplePU(0, this, "idx");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: StepDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.idx !== undefined) {
            this.idx = params.idx;
        }
    }
    updateStateVars(params: StepDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
        this.__idx.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
        this.__idx.aboutToBeDeleted();
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
    private __idx: ObservedPropertySimplePU<number>;
    get idx() {
        return this.__idx.get();
    }
    set idx(newValue: number) {
        this.__idx.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Stepper.create({ index: 0 });
            Stepper.id('sp1');
            Stepper.width(300);
            Stepper.height(200);
            Stepper.onChange((p: number, i: number) => { this.log = this.log + 'CHG' + p + '>' + i + ';'; this.idx = i; });
            Stepper.onNext((i: number, p: number) => { this.log = this.log + 'NEXT' + i + ',' + p + ';'; });
            Stepper.onPrevious((i: number, p: number) => { this.log = this.log + 'PREV' + i + ',' + p + ';'; });
            Stepper.onSkip(() => { this.log = this.log + 'SKIP;'; });
            Stepper.onFinish(() => { this.log = this.log + 'FIN;'; });
        }, Stepper);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            StepperItem.create();
            StepperItem.prevLabel('back0');
            StepperItem.nextLabel('next0');
        }, StepperItem);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('step0');
            Text.id('st0');
        }, Text);
        Text.pop();
        StepperItem.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            StepperItem.create();
            StepperItem.nextLabel('next1');
            StepperItem.status(ItemState.Skip);
        }, StepperItem);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('step1');
            Text.id('st1');
        }, Text);
        Text.pop();
        StepperItem.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            StepperItem.create();
        }, StepperItem);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('step2');
            Text.id('st2');
        }, Text);
        Text.pop();
        StepperItem.pop();
        Stepper.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('toLast');
            Button.id('to-btn');
            Button.onClick(() => {
                //Stepper 不暴露 controller；切换走内置导航
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('st-log');
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
        return "StepDemo";
    }
}
registerNamedRoute(() => new StepDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/StepDemo", pageFullPath: "entry/src/main/ets/pages/StepDemo", integratedHsp: "false", moduleType: "followWithHap" });
