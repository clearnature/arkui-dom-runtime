if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface AnimatorDemo_Params {
    log?: string;
    st?: AnimationStatus;
}
class AnimatorDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.__st = new ObservedPropertySimplePU(AnimationStatus.Running, this, "st");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: AnimatorDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.st !== undefined) {
            this.st = params.st;
        }
    }
    updateStateVars(params: AnimatorDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
        this.__st.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
        this.__st.aboutToBeDeleted();
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
    private __st: ObservedPropertySimplePU<AnimationStatus>;
    get st() {
        return this.__st.get();
    }
    set st(newValue: AnimationStatus) {
        this.__st.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ImageAnimator.create();
            ImageAnimator.id('an1');
            ImageAnimator.images([
                { src: '/test-assets/known-1x1.png' },
                { src: '/test-assets/known-7x3.png' },
                { src: '/test-assets/known-13x5.png' },
            ]);
            ImageAnimator.duration(200);
            ImageAnimator.iterations(2);
            ImageAnimator.state(this.st);
            ImageAnimator.onStart(() => {
                this.log = this.log + 'START;';
            });
            ImageAnimator.onFinish(() => {
                this.log = this.log + 'FIN;';
            });
        }, ImageAnimator);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('pause');
            Button.id('btn-p');
            Button.onClick(() => {
                this.st = AnimationStatus.Paused;
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('resume');
            Button.id('btn-r');
            Button.onClick(() => {
                this.st = AnimationStatus.Running;
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('an-log');
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
        return "AnimatorDemo";
    }
}
registerNamedRoute(() => new AnimatorDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/AnimatorDemo", pageFullPath: "entry/src/main/ets/pages/AnimatorDemo", integratedHsp: "false", moduleType: "followWithHap" });
