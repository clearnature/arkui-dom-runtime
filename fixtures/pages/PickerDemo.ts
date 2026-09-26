if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface PickerDemo_Params {
    log?: string;
    picked?: string;
}
import picker from "@ohos:file.picker";
class PickerDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.__picked = new ObservedPropertySimplePU('', this, "picked");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: PickerDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.picked !== undefined) {
            this.picked = params.picked;
        }
    }
    updateStateVars(params: PickerDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
        this.__picked.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
        this.__picked.aboutToBeDeleted();
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
    private __picked: ObservedPropertySimplePU<string>;
    get picked() {
        return this.__picked.get();
    }
    set picked(newValue: string) {
        this.__picked.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('doc-select');
            Button.id('btn-doc');
            Button.onClick(() => {
                const doc = new picker.DocumentViewPicker(getContext(this));
                doc.select({ maxSelectNumber: 2, fileSuffixFilters: ['.txt'] }).then((uris: Array<string>) => {
                    this.picked = uris.join('|');
                    this.log = this.log + 'doc;';
                });
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('doc-save');
            Button.id('btn-save');
            Button.onClick(() => {
                const doc = new picker.DocumentViewPicker(getContext(this));
                doc.save({ newFileNames: ['saved.txt'] }).then((uris: Array<string>) => {
                    this.picked = uris.length ? uris[0] : 'null';
                    this.log = this.log + 'save;';
                });
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('photo-select');
            Button.id('btn-photo');
            Button.onClick(() => {
                const ph = new picker.PhotoViewPicker(getContext(this));
                ph.select().then((r: picker.PhotoSelectResult) => {
                    this.picked = r.photoUris.join('|');
                    this.log = this.log + 'photo;';
                });
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('log=' + this.log);
            Text.id('pk-log');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('picked=' + this.picked);
            Text.id('pk-picked');
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
        return "PickerDemo";
    }
}
registerNamedRoute(() => new PickerDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/PickerDemo", pageFullPath: "entry/src/main/ets/pages/PickerDemo", integratedHsp: "false", moduleType: "followWithHap" });
