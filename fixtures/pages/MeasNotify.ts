if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface MeasNotify_Params {
    published?: string;
    err?: string;
    badErr?: string;
}
import notificationManager from "@ohos:notificationManager";
class MeasNotify extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__published = new ObservedPropertySimplePU('', this, "published");
        this.__err = new ObservedPropertySimplePU('', this, "err");
        this.__badErr = new ObservedPropertySimplePU('', this, "badErr");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: MeasNotify_Params) {
        if (params.published !== undefined) {
            this.published = params.published;
        }
        if (params.err !== undefined) {
            this.err = params.err;
        }
        if (params.badErr !== undefined) {
            this.badErr = params.badErr;
        }
    }
    updateStateVars(params: MeasNotify_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__published.purgeDependencyOnElmtId(rmElmtId);
        this.__err.purgeDependencyOnElmtId(rmElmtId);
        this.__badErr.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__published.aboutToBeDeleted();
        this.__err.aboutToBeDeleted();
        this.__badErr.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __published: ObservedPropertySimplePU<string>;
    get published() {
        return this.__published.get();
    }
    set published(newValue: string) {
        this.__published.set(newValue);
    }
    private __err: ObservedPropertySimplePU<string>;
    get err() {
        return this.__err.get();
    }
    set err(newValue: string) {
        this.__err.set(newValue);
    }
    private __badErr: ObservedPropertySimplePU<string>;
    get badErr() {
        return this.__badErr.get();
    }
    set badErr(newValue: string) {
        this.__badErr.set(newValue);
    }
    aboutToAppear() {
        // ① 基本文本通知（带显式 content type）
        notificationManager.publish({
            id: 1,
            content: {
                notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
                normal: { title: '标题A', text: '正文A' }
            }
        }).then(() => {
            this.published = this.published + 'p1;';
        }).catch((e: Error) => {
            this.err = 'e1:' + e.message;
        });
        // ② 第二条（不带 content type —— 看编译器是否接受）
        // R163 真机实录（第六端对拍首个真发现）：真机参数校验是【同步抛 401 Invalid
        // parameter】——.catch 接不住同步抛，异常穿出 aboutToAppear → jscrash 进程终止
        //（故障日志 MeasNotify.ets:26:25）。sync 兜底保探针本意：编译器仍看无 type 形态，
        // 运行时差异记进 err 通道（真机记 e2s:，垫片路径仍走 e2:/p2;）
        try {
            notificationManager.publish({
                id: 2,
                content: {
                    normal: { title: '标题B', text: '正文B' }
                }
            }).then(() => {
                this.published = this.published + 'p2;';
            }).catch((e: Error) => {
                this.err = 'e2:' + e.message;
            });
        }
        catch (e) {
            this.err = 'e2s:' + (e as Error).message;
        }
        // ③ 取消一条
        notificationManager.cancel(1).then(() => {
            this.published = this.published + 'c1;';
        }).catch((e: Error) => {
            this.err = 'e3:' + e.message;
        });
        // ④ 取消全部
        notificationManager.cancelAll().then(() => {
            this.published = this.published + 'ca;';
        }).catch((e: Error) => {
            this.err = 'e4:' + e.message;
        });
        // ⑤ 负向：content 是空的 —— 必须被拒绝（不是静默成功）
        // R163 同族：真机也是【同步抛 401】（故障日志 MeasNotify.ets:60:25——②修完⑤成为
        // 新栈），.catch 接不住；sync 兜底记录同 badErr 通道（真机同步拒绝 = 负向探针成立）
        try {
            notificationManager.publish({ id: 3, content: {} }).then(() => {
                this.published = this.published + 'p3-bad;';
            }).catch((e: Error) => {
                this.badErr = e.message;
            });
        }
        catch (e) {
            this.badErr = (e as Error).message;
        }
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 2 });
            Column.width('100%');
            Column.height('100%');
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('published=' + this.published);
            Text.id('pub');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('err=' + this.err);
            Text.id('err');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('badErr=' + this.badErr);
            Text.id('badErr');
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
        return "MeasNotify";
    }
}
registerNamedRoute(() => new MeasNotify(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/MeasNotify", pageFullPath: "entry/src/main/ets/pages/MeasNotify", integratedHsp: "false", moduleType: "followWithHap" });
