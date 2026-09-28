if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface BuiltinDemo_Params {
    slog?: string;
    tlog?: string;
    // 控制器不能 @State（ArkTS 硬规则——编译器当场抓的，别凭直觉加）
    ctrl?: SwiperController;
}
class BuiltinDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__slog = new ObservedPropertySimplePU('', this, "slog");
        this.__tlog = new ObservedPropertySimplePU('', this, "tlog");
        this.ctrl = new SwiperController();
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: BuiltinDemo_Params) {
        if (params.slog !== undefined) {
            this.slog = params.slog;
        }
        if (params.tlog !== undefined) {
            this.tlog = params.tlog;
        }
        if (params.ctrl !== undefined) {
            this.ctrl = params.ctrl;
        }
    }
    updateStateVars(params: BuiltinDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__slog.purgeDependencyOnElmtId(rmElmtId);
        this.__tlog.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__slog.aboutToBeDeleted();
        this.__tlog.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __slog: ObservedPropertySimplePU<string>;
    get slog() {
        return this.__slog.get();
    }
    set slog(newValue: string) {
        this.__slog.set(newValue);
    }
    private __tlog: ObservedPropertySimplePU<string>;
    get tlog() {
        return this.__tlog.get();
    }
    set tlog(newValue: string) {
        this.__tlog.set(newValue);
    }
    // 控制器不能 @State（ArkTS 硬规则——编译器当场抓的，别凭直觉加）
    private ctrl: SwiperController;
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 6 });
            Column.width('100%');
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Swiper.create(this.ctrl);
            Swiper.id('sw');
            Swiper.loop(false);
            Swiper.indicator(true);
            Swiper.duration(120);
            Swiper.onChange((i: number) => {
                this.slog = this.slog + 'C' + i + ';';
            });
            Swiper.onAnimationStart((i: number, target: number, e: SwiperAnimationEvent) => {
                this.slog = this.slog + 'A' + target + ';';
            });
            Swiper.onAnimationEnd((i: number, e: SwiperAnimationEvent) => {
                this.slog = this.slog + 'E' + i + ';';
            });
            Swiper.onGestureSwipe((i: number, e: SwiperAnimationEvent) => {
                this.slog = this.slog + 'G';
            });
        }, Swiper);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('P0');
            Text.width(160);
            Text.height(80);
            Text.backgroundColor('#ddeeff');
            Text.id('sp0');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('P1');
            Text.width(160);
            Text.height(80);
            Text.backgroundColor('#ffddaa');
            Text.id('sp1');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('P2');
            Text.width(160);
            Text.height(80);
            Text.backgroundColor('#aaffcc');
            Text.id('sp2');
        }, Text);
        Text.pop();
        Swiper.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Tabs.create();
            Tabs.id('tb');
            Tabs.onChange((i: number) => {
                this.tlog = this.tlog + 'C' + i + ';';
            });
        }, Tabs);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TabContent.create(() => {
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('T0');
                    Text.width(120);
                    Text.height(60);
                    Text.id('tc0');
                }, Text);
                Text.pop();
            });
            TabContent.tabBar('tab0');
        }, TabContent);
        TabContent.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TabContent.create(() => {
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('T1');
                    Text.width(120);
                    Text.height(60);
                    Text.id('tc1');
                }, Text);
                Text.pop();
            });
            TabContent.tabBar('tab1');
        }, TabContent);
        TabContent.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TabContent.create(() => {
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('T2');
                    Text.width(120);
                    Text.height(60);
                    Text.id('tc2');
                }, Text);
                Text.pop();
            });
            TabContent.tabBar('tab2');
        }, TabContent);
        TabContent.pop();
        Tabs.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Scroll.create();
            Scroll.width(160);
            Scroll.height(90);
            Scroll.id('scr');
        }, Scroll);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('S0');
            Text.height(40);
            Text.id('sc0');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('S1');
            Text.height(40);
            Text.id('sc1');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('S2');
            Text.height(40);
            Text.id('sc2');
        }, Text);
        Text.pop();
        Column.pop();
        Scroll.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            List.create({ space: 4 });
            List.width(160);
            List.height(90);
            List.id('lst');
        }, List);
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
            };
            const deepRenderFunction = (elmtId, isInitialRender) => {
                itemCreation(elmtId, isInitialRender);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('L0');
                    Text.height(36);
                    Text.id('li0');
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
            };
            const deepRenderFunction = (elmtId, isInitialRender) => {
                itemCreation(elmtId, isInitialRender);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('L1');
                    Text.height(36);
                    Text.id('li1');
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
            };
            const deepRenderFunction = (elmtId, isInitialRender) => {
                itemCreation(elmtId, isInitialRender);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('L2');
                    Text.height(36);
                    Text.id('li2');
                }, Text);
                Text.pop();
                ListItem.pop();
            };
            this.observeComponentCreation2(itemCreation2, ListItem);
            ListItem.pop();
        }
        List.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "BuiltinDemo";
    }
}
registerNamedRoute(() => new BuiltinDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/BuiltinDemo", pageFullPath: "entry/src/main/ets/pages/BuiltinDemo", integratedHsp: "false", moduleType: "followWithHap" });
