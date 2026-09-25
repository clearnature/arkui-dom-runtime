if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface SideBarDemo_Params {
    log?: string;
    show?: boolean;
}
class SideBarDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.__show = new ObservedPropertySimplePU(true, this, "show");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: SideBarDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.show !== undefined) {
            this.show = params.show;
        }
    }
    updateStateVars(params: SideBarDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
        this.__show.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
        this.__show.aboutToBeDeleted();
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
    private __show: ObservedPropertySimplePU<boolean>;
    get show() {
        return this.__show.get();
    }
    set show(newValue: boolean) {
        this.__show.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            SideBarContainer.create(SideBarContainerType.Embed);
            SideBarContainer.id('sbc');
            SideBarContainer.showSideBar(this.show);
            SideBarContainer.sideBarWidth(200);
            SideBarContainer.controlButton({
                left: 8,
                top: 8,
                icons: {
                    shown: '→',
                    hidden: '←',
                }
            });
            SideBarContainer.showControlButton(true);
            SideBarContainer.onChange((value: boolean) => {
                this.log = this.log + 'CHG' + (value ? '1' : '0') + ';';
            });
            SideBarContainer.width('100%');
            SideBarContainer.height(200);
        }, SideBarContainer);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.width(200);
            Column.backgroundColor('#f4f6f8');
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('menu');
            Text.id('sb-menu');
        }, Text);
        Text.pop();
        Column.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.backgroundColor('#e8f0fe');
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('content');
            Text.id('sb-content');
        }, Text);
        Text.pop();
        Column.pop();
        SideBarContainer.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('toggle');
            Button.id('btn-toggle');
            Button.onClick(() => {
                this.show = !this.show;
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('sb-log');
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
        return "SideBarDemo";
    }
}
registerNamedRoute(() => new SideBarDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/SideBarDemo", pageFullPath: "entry/src/main/ets/pages/SideBarDemo", integratedHsp: "false", moduleType: "followWithHap" });
