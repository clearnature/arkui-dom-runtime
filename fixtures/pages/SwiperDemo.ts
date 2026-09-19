if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface SwiperDemo_Params {
    ctrlA?: SwiperController;
    ctrlB?: SwiperController;
    ctrlC?: SwiperController;
    cur?: number;
    loopCur?: number;
    autoCur?: number;
}
class SwiperDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.ctrlA = new SwiperController();
        this.ctrlB = new SwiperController();
        this.ctrlC = new SwiperController();
        this.__cur = new ObservedPropertySimplePU(0, this, "cur");
        this.__loopCur = new ObservedPropertySimplePU(0, this, "loopCur");
        this.__autoCur = new ObservedPropertySimplePU(0, this, "autoCur");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: SwiperDemo_Params) {
        if (params.ctrlA !== undefined) {
            this.ctrlA = params.ctrlA;
        }
        if (params.ctrlB !== undefined) {
            this.ctrlB = params.ctrlB;
        }
        if (params.ctrlC !== undefined) {
            this.ctrlC = params.ctrlC;
        }
        if (params.cur !== undefined) {
            this.cur = params.cur;
        }
        if (params.loopCur !== undefined) {
            this.loopCur = params.loopCur;
        }
        if (params.autoCur !== undefined) {
            this.autoCur = params.autoCur;
        }
    }
    updateStateVars(params: SwiperDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__cur.purgeDependencyOnElmtId(rmElmtId);
        this.__loopCur.purgeDependencyOnElmtId(rmElmtId);
        this.__autoCur.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__cur.aboutToBeDeleted();
        this.__loopCur.aboutToBeDeleted();
        this.__autoCur.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private ctrlA: SwiperController;
    private ctrlB: SwiperController;
    private ctrlC: SwiperController;
    private __cur: ObservedPropertySimplePU<number>;
    get cur() {
        return this.__cur.get();
    }
    set cur(newValue: number) {
        this.__cur.set(newValue);
    }
    private __loopCur: ObservedPropertySimplePU<number>;
    get loopCur() {
        return this.__loopCur.get();
    }
    set loopCur(newValue: number) {
        this.__loopCur.set(newValue);
    }
    private __autoCur: ObservedPropertySimplePU<number>;
    get autoCur() {
        return this.__autoCur.get();
    }
    set autoCur(newValue: number) {
        this.__autoCur.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 4 });
            Column.width('100%');
            Column.height('100%');
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('SwiperDemo');
            Text.fontSize(16);
            Text.fontWeight(FontWeight.Bold);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Swiper.create(this.ctrlA);
            Swiper.index(0);
            Swiper.loop(false);
            Swiper.autoPlay(false);
            Swiper.indicator(true);
            Swiper.onChange((i: number) => {
                this.cur = i;
            });
            Swiper.width('100%');
            Swiper.height(60);
            Swiper.id('swiperA');
        }, Swiper);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('s0');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('s1');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('s2');
        }, Text);
        Text.pop();
        Swiper.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('cur=' + this.cur);
            Text.id('curline');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Swiper.create(this.ctrlB);
            Swiper.index(0);
            Swiper.loop(true);
            Swiper.autoPlay(false);
            Swiper.indicator(true);
            Swiper.onChange((i: number) => {
                this.loopCur = i;
            });
            Swiper.width('100%');
            Swiper.height(40);
            Swiper.id('swiperB');
        }, Swiper);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('b0');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('b1');
        }, Text);
        Text.pop();
        Swiper.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('loop=' + this.loopCur);
            Text.id('loopline');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Swiper.create(this.ctrlC);
            Swiper.index(0);
            Swiper.loop(true);
            Swiper.autoPlay(true);
            Swiper.interval(50);
            Swiper.indicator(true);
            Swiper.onChange((i: number) => {
                this.autoCur = i;
            });
            Swiper.width('100%');
            Swiper.height(40);
            Swiper.id('swiperC');
        }, Swiper);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('c0');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('c1');
        }, Text);
        Text.pop();
        Swiper.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('auto=' + this.autoCur);
            Text.id('autoline');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('next');
            Button.onClick(() => {
                this.ctrlA.showNext();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('prev');
            Button.onClick(() => {
                this.ctrlA.showPrevious();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('go2');
            Button.onClick(() => {
                this.ctrlA.changeIndex(2);
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('loopnext');
            Button.onClick(() => {
                this.ctrlB.showNext();
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
        return "SwiperDemo";
    }
}
registerNamedRoute(() => new SwiperDemo(undefined, {}), "", { bundleName: "com.example.hmtest", moduleName: "entry", pagePath: "pages/SwiperDemo", pageFullPath: "entry/src/main/ets/pages/SwiperDemo", integratedHsp: "false", moduleType: "followWithHap" });
