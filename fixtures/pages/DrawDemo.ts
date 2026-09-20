if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface DrawDemo_Params {
    rating?: number;
}
class DrawDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__rating = new ObservedPropertySimplePU(3, this, "rating");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: DrawDemo_Params) {
        if (params.rating !== undefined) {
            this.rating = params.rating;
        }
    }
    updateStateVars(params: DrawDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__rating.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__rating.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __rating: ObservedPropertySimplePU<number>;
    get rating() {
        return this.__rating.get();
    }
    set rating(newValue: number) {
        this.__rating.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.width('100%');
            Column.height('100%');
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // Progress：线性 50/100
            Progress.create({ value: 50, total: 100, style: ProgressStyle.Linear });
            // Progress：线性 50/100
            Progress.width(200);
            // Progress：线性 50/100
            Progress.height(10);
            // Progress：线性 50/100
            Progress.id('p1');
        }, Progress);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // Progress：环形 25/100
            Progress.create({ value: 25, total: 100, style: ProgressStyle.Ring });
            // Progress：环形 25/100
            Progress.width(80);
            // Progress：环形 25/100
            Progress.height(80);
            // Progress：环形 25/100
            Progress.id('p2');
        }, Progress);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // Gauge A：180°→360°（从 6 点钟顺时针扫到 12 点钟），min/max 非 0
            Gauge.create({ value: 40, min: 20, max: 60 });
            // Gauge A：180°→360°（从 6 点钟顺时针扫到 12 点钟），min/max 非 0
            Gauge.startAngle(180);
            // Gauge A：180°→360°（从 6 点钟顺时针扫到 12 点钟），min/max 非 0
            Gauge.endAngle(360);
            // Gauge A：180°→360°（从 6 点钟顺时针扫到 12 点钟），min/max 非 0
            Gauge.strokeWidth(10);
            // Gauge A：180°→360°（从 6 点钟顺时针扫到 12 点钟），min/max 非 0
            Gauge.colors([[0xFF0000, 0.5], [0x00FF00, 0.5]]);
            // Gauge A：180°→360°（从 6 点钟顺时针扫到 12 点钟），min/max 非 0
            Gauge.width(120);
            // Gauge A：180°→360°（从 6 点钟顺时针扫到 12 点钟），min/max 非 0
            Gauge.height(120);
            // Gauge A：180°→360°（从 6 点钟顺时针扫到 12 点钟），min/max 非 0
            Gauge.id('g1');
        }, Gauge);
        // Gauge A：180°→360°（从 6 点钟顺时针扫到 12 点钟），min/max 非 0
        Gauge.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // Gauge B：0°→180°（从 12 点钟顺时针扫到 6 点钟）—— 与 A 配对钉住角度约定
            Gauge.create({ value: 50, min: 0, max: 100 });
            // Gauge B：0°→180°（从 12 点钟顺时针扫到 6 点钟）—— 与 A 配对钉住角度约定
            Gauge.startAngle(0);
            // Gauge B：0°→180°（从 12 点钟顺时针扫到 6 点钟）—— 与 A 配对钉住角度约定
            Gauge.endAngle(180);
            // Gauge B：0°→180°（从 12 点钟顺时针扫到 6 点钟）—— 与 A 配对钉住角度约定
            Gauge.strokeWidth(8);
            // Gauge B：0°→180°（从 12 点钟顺时针扫到 6 点钟）—— 与 A 配对钉住角度约定
            Gauge.width(120);
            // Gauge B：0°→180°（从 12 点钟顺时针扫到 6 点钟）—— 与 A 配对钉住角度约定
            Gauge.height(120);
            // Gauge B：0°→180°（从 12 点钟顺时针扫到 6 点钟）—— 与 A 配对钉住角度约定
            Gauge.id('g2');
        }, Gauge);
        // Gauge B：0°→180°（从 12 点钟顺时针扫到 6 点钟）—— 与 A 配对钉住角度约定
        Gauge.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // Gauge C：不设角度 → 默认 startAngle=0 / endAngle=360（.d.ts 的默认值）→ 整圆
            // 整圆不能只画一条 arc（起终点重合会渲染成空），必须拆成两段 —— 这条分支要有断言守着
            Gauge.create({ value: 75, min: 0, max: 100 });
            // Gauge C：不设角度 → 默认 startAngle=0 / endAngle=360（.d.ts 的默认值）→ 整圆
            // 整圆不能只画一条 arc（起终点重合会渲染成空），必须拆成两段 —— 这条分支要有断言守着
            Gauge.strokeWidth(6);
            // Gauge C：不设角度 → 默认 startAngle=0 / endAngle=360（.d.ts 的默认值）→ 整圆
            // 整圆不能只画一条 arc（起终点重合会渲染成空），必须拆成两段 —— 这条分支要有断言守着
            Gauge.width(100);
            // Gauge C：不设角度 → 默认 startAngle=0 / endAngle=360（.d.ts 的默认值）→ 整圆
            // 整圆不能只画一条 arc（起终点重合会渲染成空），必须拆成两段 —— 这条分支要有断言守着
            Gauge.height(100);
            // Gauge C：不设角度 → 默认 startAngle=0 / endAngle=360（.d.ts 的默认值）→ 整圆
            // 整圆不能只画一条 arc（起终点重合会渲染成空），必须拆成两段 —— 这条分支要有断言守着
            Gauge.id('g3');
        }, Gauge);
        // Gauge C：不设角度 → 默认 startAngle=0 / endAngle=360（.d.ts 的默认值）→ 整圆
        // 整圆不能只画一条 arc（起终点重合会渲染成空），必须拆成两段 —— 这条分支要有断言守着
        Gauge.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // DataPanel：环形 [30,20,50]/100
            DataPanel.create({ values: [30, 20, 50], max: 100, type: DataPanelType.Circle });
            // DataPanel：环形 [30,20,50]/100
            DataPanel.width(100);
            // DataPanel：环形 [30,20,50]/100
            DataPanel.height(100);
            // DataPanel：环形 [30,20,50]/100
            DataPanel.id('d1');
        }, DataPanel);
        // DataPanel：环形 [30,20,50]/100
        DataPanel.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // DataPanel：线形 [10,30]/100
            DataPanel.create({ values: [10, 30], max: 100, type: DataPanelType.Line });
            // DataPanel：线形 [10,30]/100
            DataPanel.width(200);
            // DataPanel：线形 [10,30]/100
            DataPanel.height(12);
            // DataPanel：线形 [10,30]/100
            DataPanel.id('d2');
        }, DataPanel);
        // DataPanel：线形 [10,30]/100
        DataPanel.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // Rating：3/5，可点；带 starStyle（图片 URI —— 本运行时加载不了，必须出声）
            Rating.create({ rating: 3, indicator: false });
            // Rating：3/5，可点；带 starStyle（图片 URI —— 本运行时加载不了，必须出声）
            Rating.stars(5);
            // Rating：3/5，可点；带 starStyle（图片 URI —— 本运行时加载不了，必须出声）
            Rating.stepSize(0.5);
            // Rating：3/5，可点；带 starStyle（图片 URI —— 本运行时加载不了，必须出声）
            Rating.starStyle({ backgroundUri: 'bg.png', foregroundUri: 'fg.png' });
            // Rating：3/5，可点；带 starStyle（图片 URI —— 本运行时加载不了，必须出声）
            Rating.onChange((v: number) => {
                this.rating = v;
            });
            // Rating：3/5，可点；带 starStyle（图片 URI —— 本运行时加载不了，必须出声）
            Rating.width(150);
            // Rating：3/5，可点；带 starStyle（图片 URI —— 本运行时加载不了，必须出声）
            Rating.height(30);
            // Rating：3/5，可点；带 starStyle（图片 URI —— 本运行时加载不了，必须出声）
            Rating.id('r1');
        }, Rating);
        // Rating：3/5，可点；带 starStyle（图片 URI —— 本运行时加载不了，必须出声）
        Rating.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // Rating：2.5/4（半星），stepSize 0.5
            Rating.create({ rating: 2.5, indicator: true });
            // Rating：2.5/4（半星），stepSize 0.5
            Rating.stars(4);
            // Rating：2.5/4（半星），stepSize 0.5
            Rating.stepSize(0.5);
            // Rating：2.5/4（半星），stepSize 0.5
            Rating.width(120);
            // Rating：2.5/4（半星），stepSize 0.5
            Rating.height(24);
            // Rating：2.5/4（半星），stepSize 0.5
            Rating.id('r2');
        }, Rating);
        // Rating：2.5/4（半星），stepSize 0.5
        Rating.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('rating=' + this.rating);
            Text.id('rateline');
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
        return "DrawDemo";
    }
}
registerNamedRoute(() => new DrawDemo(undefined, {}), "", { bundleName: "com.example.hmtest", moduleName: "entry", pagePath: "pages/DrawDemo", pageFullPath: "entry/src/main/ets/pages/DrawDemo", integratedHsp: "false", moduleType: "followWithHap" });
