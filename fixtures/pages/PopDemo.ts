if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface PopDemo_Params {
    log?: string;
    mlog?: string;
}
class PopDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.__mlog = new ObservedPropertySimplePU('', this, "mlog");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: PopDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.mlog !== undefined) {
            this.mlog = params.mlog;
        }
    }
    updateStateVars(params: PopDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
        this.__mlog.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
        this.__mlog.aboutToBeDeleted();
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
    private __mlog: ObservedPropertySimplePU<string>;
    get mlog() {
        return this.__mlog.get();
    }
    set mlog(newValue: string) {
        this.__mlog.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ① Select：三选项，初始选中第 1 项
            Select.create([
                { value: 'A' },
                { value: 'B' },
                { value: 'C' }
            ]);
            // ① Select：三选项，初始选中第 1 项
            Select.id('sel1');
            // ① Select：三选项，初始选中第 1 项
            Select.selected(1);
            // ① Select：三选项，初始选中第 1 项
            Select.fontColor('#0066cc');
            // ① Select：三选项，初始选中第 1 项
            Select.onSelect((i: number, v: string) => { this.log = this.log + 'SEL' + i + '/' + v + ';'; });
        }, Select);
        // ① Select：三选项，初始选中第 1 项
        Select.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ② Select：selected(2) + value('B→X') 覆盖显示
            Select.create([
                { value: 'X' },
                { value: 'Y' }
            ]);
            // ② Select：selected(2) + value('B→X') 覆盖显示
            Select.id('sel2');
            // ② Select：selected(2) + value('B→X') 覆盖显示
            Select.selected(0);
            // ② Select：selected(2) + value('B→X') 覆盖显示
            Select.value('Choosed');
        }, Select);
        // ② Select：selected(2) + value('B→X') 覆盖显示
        Select.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ③ Menu 容器 + MenuItem：多选菜单（selected + onChange）
            Menu.create();
            // ③ Menu 容器 + MenuItem：多选菜单（selected + onChange）
            Menu.id('mn1');
        }, Menu);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            MenuItem.create({ content: 'item1' });
            MenuItem.id('mi1');
            MenuItem.selected(false);
            MenuItem.onChange((on: boolean) => { this.mlog = this.mlog + 'I1' + on + ';'; });
        }, MenuItem);
        MenuItem.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            MenuItem.create({ content: 'item2' });
            MenuItem.id('mi2');
            MenuItem.selected(true);
            MenuItem.onChange((on: boolean) => { this.mlog = this.mlog + 'I2' + on + ';'; });
        }, MenuItem);
        MenuItem.pop();
        // ③ Menu 容器 + MenuItem：多选菜单（selected + onChange）
        Menu.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('pop-log');
            Text.fontSize(12);
            Text.height(24);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.mlog);
            Text.id('menu-log');
            Text.fontSize(12);
            Text.height(24);
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
        return "PopDemo";
    }
}
registerNamedRoute(() => new PopDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/PopDemo", pageFullPath: "entry/src/main/ets/pages/PopDemo", integratedHsp: "false", moduleType: "followWithHap" });
