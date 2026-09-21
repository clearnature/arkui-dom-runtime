if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface MediaDemo_Params {
    log?: string;
}
import media from "@ohos:multimedia.media";
class MediaDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: MediaDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
    }
    updateStateVars(params: MediaDemo_Params) {
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
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('run');
            Button.id('run-btn');
            Button.onClick(() => {
                media.createAVPlayer().then((player) => {
                    const av = player as media.AVPlayer;
                    // ⚠️ 订阅先行：stateChange 的监听必须在 url 赋值【之前】（真机语义），
                    // 否则 'initialized' 在订阅前发生、被丢（首跑实测：log 里没有 S:initialized）
                    av.on('stateChange', (state: media.AVPlayerState) => {
                        this.log = this.log + 'S:' + state + ';';
                    });
                    av.url = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
                    av.prepare().then(() => {
                        this.log = this.log + 'PREP;';
                        av.play().then(() => {
                            setTimeout(() => {
                                this.log = this.log + 'T' + Math.round(av.currentTime * 10) + ';';
                                av.pause().then(() => {
                                    this.log = this.log + 'P' + (av.state === 'paused' ? 1 : 0) + ';';
                                });
                            }, 300);
                        });
                    }).catch((e: Error) => {
                        this.log = this.log + 'ERR;';
                    });
                }).catch((e: Error) => {
                    this.log = this.log + 'ERR;';
                });
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('media-log');
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
        return "MediaDemo";
    }
}
registerNamedRoute(() => new MediaDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/MediaDemo", pageFullPath: "entry/src/main/ets/pages/MediaDemo", integratedHsp: "false", moduleType: "followWithHap" });
