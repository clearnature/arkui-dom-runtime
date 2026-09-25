if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface BatchFuncDemo_Params {
    log?: string;
    month?: string;
    sel?: string;
    idx?: number;
    items?: string[];
}
class BatchFuncDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.__month = new ObservedPropertySimplePU('', this, "month");
        this.__sel = new ObservedPropertySimplePU('', this, "sel");
        this.__idx = new ObservedPropertySimplePU(-1, this, "idx");
        this.__items = new ObservedPropertyObjectPU(['a', 'b', 'c', 'd', 'e', 'f'], this, "items");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: BatchFuncDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.month !== undefined) {
            this.month = params.month;
        }
        if (params.sel !== undefined) {
            this.sel = params.sel;
        }
        if (params.idx !== undefined) {
            this.idx = params.idx;
        }
        if (params.items !== undefined) {
            this.items = params.items;
        }
    }
    updateStateVars(params: BatchFuncDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
        this.__month.purgeDependencyOnElmtId(rmElmtId);
        this.__sel.purgeDependencyOnElmtId(rmElmtId);
        this.__idx.purgeDependencyOnElmtId(rmElmtId);
        this.__items.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
        this.__month.aboutToBeDeleted();
        this.__sel.aboutToBeDeleted();
        this.__idx.aboutToBeDeleted();
        this.__items.aboutToBeDeleted();
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
    private __month: ObservedPropertySimplePU<string>;
    get month() {
        return this.__month.get();
    }
    set month(newValue: string) {
        this.__month.set(newValue);
    }
    private __sel: ObservedPropertySimplePU<string>;
    get sel() {
        return this.__sel.get();
    }
    set sel(newValue: string) {
        this.__sel.set(newValue);
    }
    private __idx: ObservedPropertySimplePU<number>;
    get idx() {
        return this.__idx.get();
    }
    set idx(newValue: number) {
        this.__idx.set(newValue);
    }
    private __items: ObservedPropertyObjectPU<string[]>;
    get items() {
        return this.__items.get();
    }
    set items(newValue: string[]) {
        this.__items.set(newValue);
    }
    private indicCtrl: IndicatorComponentController = new IndicatorComponentController();
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.padding(8);
        }, Column);
        // ── ① Repeat：6 项数据源 + virtualScroll totalCount=4 → 只渲染前 4 项 ──
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Repeat.create(this.items, this);
            Repeat.each((ri: RepeatItem<string>) => {
                Text.create('R' + ri.item);
                Text.id('rep-' + ri.index);
                Text.fontSize(12);
                Text.pop();
            });
            Repeat.key((item: string, i: number) => item + i);
            Repeat.virtualScroll({ totalCount: 4 });
        }, Repeat);
        Repeat.pop();
        // ── ② WithTheme：LIGHT 色彩模式作用域 ──
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            WithTheme.create({ colorMode: 1 });
            WithTheme.id('wt');
        }, WithTheme);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('themed');
            Text.id('wt-text');
        }, Text);
        Text.pop();
        WithTheme.pop();
        // ── ③ Menu + MenuItemGroup：分组（header/footer）+ 组外散项 ──
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Menu.create();
            Menu.id('mn');
        }, Menu);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            MenuItemGroup.create({ header: '分组A', footer: 'A组尾' });
            MenuItemGroup.id('mig');
        }, MenuItemGroup);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            MenuItem.create({ content: 'mA1' });
            MenuItem.id('mi-a1');
        }, MenuItem);
        MenuItem.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            MenuItem.create({ content: 'mA2' });
            MenuItem.id('mi-a2');
        }, MenuItem);
        MenuItem.pop();
        MenuItemGroup.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            MenuItem.create({ content: 'solo' });
            MenuItem.id('mi-solo');
        }, MenuItem);
        MenuItem.pop();
        Menu.pop();
        // ── ④ IndicatorComponent：3 个指示点 + 控制器 ──
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            IndicatorComponent.create(this.indicCtrl);
            IndicatorComponent.count(3);
            IndicatorComponent.initialIndex(1);
            IndicatorComponent.onChange((i: number) => { this.idx = i; });
            IndicatorComponent.id('ind');
        }, IndicatorComponent);
        IndicatorComponent.pop();
        // ── ⑤ ContainerReader：容器尺寸断点读取 ──
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ContainerReader.create({ size: { width: 700, height: 500 }, widthBreakpoint: 2 });
            ContainerReader.breakpointConfig({ width: [320, 600, 840] });
            ContainerReader.id('cr');
        }, ContainerReader);
        ContainerReader.pop();
        // ── ⑥ Calendar（systemApi 老组件）：2026-09 锚月 + 周一头 + 周末休息 + 样式对象 ──
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Calendar.create({ selected: new Date(2026, 8, 15) });
            Calendar.startOfWeek(1);
            Calendar.offDays([0, 6]);
            Calendar.onSelectChange((d: Date) => { this.sel = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); });
            Calendar.onRequestData((ym: string) => { this.month = ym; });
            Calendar.currentData([{ year: 2026, month: 9, day: 10, mark: '会' }]);
            Calendar.todayStyle({ dayColor: '#B3261E' });
            Calendar.workStateStyle({ dayColor: '#C62828' });
            Calendar.needSlide(false);
            Calendar.id('cal');
        }, Calendar);
        Calendar.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('month=' + this.month);
            Text.id('cal-month-log');
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('sel=' + this.sel);
            Text.id('cal-sel-log');
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('idx=' + this.idx);
            Text.id('ind-log');
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
        return "BatchFuncDemo";
    }
}
registerNamedRoute(() => new BatchFuncDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/BatchFuncDemo", pageFullPath: "entry/src/main/ets/pages/BatchFuncDemo", integratedHsp: "false", moduleType: "followWithHap" });
