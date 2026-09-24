if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface ListGroupDemo_Params {
    log?: string;
}
class ListGroupDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: ListGroupDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
    }
    updateStateVars(params: ListGroupDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
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
    gah(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('GA头');
            Text.id('gah');
            Text.height(40);
            Text.width('100%');
        }, Text);
        Text.pop();
    }
    gaf(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('GA尾');
            Text.id('gaf');
            Text.height(40);
            Text.width('100%');
        }, Text);
        Text.pop();
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(0);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            List.create();
            List.id('ls1');
            List.width(360);
            List.height(300);
            List.sticky(StickyStyle.Header);
        }, List);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ListItemGroup.create({ header: () => this.gah(), footer: () => this.gaf(), space: 10, style: ListItemGroupStyle.CARD });
            ListItemGroup.id('ga');
            ListItemGroup.divider({ strokeWidth: 1, color: '#FF0000', startMargin: 4, endMargin: 4 });
        }, ListItemGroup);
        {
            const itemCreation = (elmtId, isInitialRender) => {
                ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                ListItem.create(deepRenderFunction, true);
                if (!isInitialRender) {
                    ListItem.pop();
                }
                ViewStackProcessor.StopGetAccessRecording();
            };
            const itemCreation2 = (elmtId, isInitialRender) => {
                ListItem.create(deepRenderFunction, true);
                ListItem.id('ga0');
            };
            const deepRenderFunction = (elmtId, isInitialRender) => {
                itemCreation(elmtId, isInitialRender);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('ga0');
                    Text.height(80);
                    Text.width('100%');
                }, Text);
                Text.pop();
                ListItem.pop();
            };
            this.observeComponentCreation2(itemCreation2, ListItem);
            ListItem.pop();
        }
        {
            const itemCreation = (elmtId, isInitialRender) => {
                ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                ListItem.create(deepRenderFunction, true);
                if (!isInitialRender) {
                    ListItem.pop();
                }
                ViewStackProcessor.StopGetAccessRecording();
            };
            const itemCreation2 = (elmtId, isInitialRender) => {
                ListItem.create(deepRenderFunction, true);
                ListItem.id('ga1');
            };
            const deepRenderFunction = (elmtId, isInitialRender) => {
                itemCreation(elmtId, isInitialRender);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('ga1');
                    Text.height(80);
                    Text.width('100%');
                }, Text);
                Text.pop();
                ListItem.pop();
            };
            this.observeComponentCreation2(itemCreation2, ListItem);
            ListItem.pop();
        }
        {
            const itemCreation = (elmtId, isInitialRender) => {
                ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                ListItem.create(deepRenderFunction, true);
                if (!isInitialRender) {
                    ListItem.pop();
                }
                ViewStackProcessor.StopGetAccessRecording();
            };
            const itemCreation2 = (elmtId, isInitialRender) => {
                ListItem.create(deepRenderFunction, true);
                ListItem.id('ga2');
            };
            const deepRenderFunction = (elmtId, isInitialRender) => {
                itemCreation(elmtId, isInitialRender);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('ga2');
                    Text.height(80);
                    Text.width('100%');
                }, Text);
                Text.pop();
                ListItem.pop();
            };
            this.observeComponentCreation2(itemCreation2, ListItem);
            ListItem.pop();
        }
        ListItemGroup.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ListItemGroup.create({ spaceWidth: 4, space: 99 });
            ListItemGroup.id('gb');
        }, ListItemGroup);
        {
            const itemCreation = (elmtId, isInitialRender) => {
                ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                ListItem.create(deepRenderFunction, true);
                if (!isInitialRender) {
                    ListItem.pop();
                }
                ViewStackProcessor.StopGetAccessRecording();
            };
            const itemCreation2 = (elmtId, isInitialRender) => {
                ListItem.create(deepRenderFunction, true);
                ListItem.id('gb0');
            };
            const deepRenderFunction = (elmtId, isInitialRender) => {
                itemCreation(elmtId, isInitialRender);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('gb0');
                    Text.height(30);
                    Text.width('100%');
                }, Text);
                Text.pop();
                ListItem.pop();
            };
            this.observeComponentCreation2(itemCreation2, ListItem);
            ListItem.pop();
        }
        {
            const itemCreation = (elmtId, isInitialRender) => {
                ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                ListItem.create(deepRenderFunction, true);
                if (!isInitialRender) {
                    ListItem.pop();
                }
                ViewStackProcessor.StopGetAccessRecording();
            };
            const itemCreation2 = (elmtId, isInitialRender) => {
                ListItem.create(deepRenderFunction, true);
                ListItem.id('gb1');
            };
            const deepRenderFunction = (elmtId, isInitialRender) => {
                itemCreation(elmtId, isInitialRender);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('gb1');
                    Text.height(30);
                    Text.width('100%');
                }, Text);
                Text.pop();
                ListItem.pop();
            };
            this.observeComponentCreation2(itemCreation2, ListItem);
            ListItem.pop();
        }
        {
            const itemCreation = (elmtId, isInitialRender) => {
                ViewStackProcessor.StartGetAccessRecordingFor(elmtId);
                ListItem.create(deepRenderFunction, true);
                if (!isInitialRender) {
                    ListItem.pop();
                }
                ViewStackProcessor.StopGetAccessRecording();
            };
            const itemCreation2 = (elmtId, isInitialRender) => {
                ListItem.create(deepRenderFunction, true);
                ListItem.id('gb2');
            };
            const deepRenderFunction = (elmtId, isInitialRender) => {
                itemCreation(elmtId, isInitialRender);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('gb2');
                    Text.height(30);
                    Text.width('100%');
                }, Text);
                Text.pop();
                ListItem.pop();
            };
            this.observeComponentCreation2(itemCreation2, ListItem);
            ListItem.pop();
        }
        ListItemGroup.pop();
        List.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('lg-log');
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
        return "ListGroupDemo";
    }
}
registerNamedRoute(() => new ListGroupDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/ListGroupDemo", pageFullPath: "entry/src/main/ets/pages/ListGroupDemo", integratedHsp: "false", moduleType: "followWithHap" });
