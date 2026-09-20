if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface MeasImage_Params {
    w1?: number;
    h1?: number;
    mime?: string;
    w2?: number;
    h2?: number;
    err?: string;
    syncW?: number;
    syncErr?: string;
    missErr?: string;
    mimeJpg?: string;
    mimeMis?: string;
    wMis?: number;
}
import image from "@ohos:multimedia.image";
class MeasImage extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__w1 = new ObservedPropertySimplePU(0, this, "w1");
        this.__h1 = new ObservedPropertySimplePU(0, this, "h1");
        this.__mime = new ObservedPropertySimplePU('', this, "mime");
        this.__w2 = new ObservedPropertySimplePU(0, this, "w2");
        this.__h2 = new ObservedPropertySimplePU(0, this, "h2");
        this.__err = new ObservedPropertySimplePU('', this, "err");
        this.__syncW = new ObservedPropertySimplePU(0, this, "syncW");
        this.__syncErr = new ObservedPropertySimplePU('', this, "syncErr");
        this.__missErr = new ObservedPropertySimplePU('', this, "missErr");
        this.__mimeJpg = new ObservedPropertySimplePU('', this, "mimeJpg");
        this.__mimeMis = new ObservedPropertySimplePU('', this, "mimeMis");
        this.__wMis = new ObservedPropertySimplePU(0, this, "wMis");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: MeasImage_Params) {
        if (params.w1 !== undefined) {
            this.w1 = params.w1;
        }
        if (params.h1 !== undefined) {
            this.h1 = params.h1;
        }
        if (params.mime !== undefined) {
            this.mime = params.mime;
        }
        if (params.w2 !== undefined) {
            this.w2 = params.w2;
        }
        if (params.h2 !== undefined) {
            this.h2 = params.h2;
        }
        if (params.err !== undefined) {
            this.err = params.err;
        }
        if (params.syncW !== undefined) {
            this.syncW = params.syncW;
        }
        if (params.syncErr !== undefined) {
            this.syncErr = params.syncErr;
        }
        if (params.missErr !== undefined) {
            this.missErr = params.missErr;
        }
        if (params.mimeJpg !== undefined) {
            this.mimeJpg = params.mimeJpg;
        }
        if (params.mimeMis !== undefined) {
            this.mimeMis = params.mimeMis;
        }
        if (params.wMis !== undefined) {
            this.wMis = params.wMis;
        }
    }
    updateStateVars(params: MeasImage_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__w1.purgeDependencyOnElmtId(rmElmtId);
        this.__h1.purgeDependencyOnElmtId(rmElmtId);
        this.__mime.purgeDependencyOnElmtId(rmElmtId);
        this.__w2.purgeDependencyOnElmtId(rmElmtId);
        this.__h2.purgeDependencyOnElmtId(rmElmtId);
        this.__err.purgeDependencyOnElmtId(rmElmtId);
        this.__syncW.purgeDependencyOnElmtId(rmElmtId);
        this.__syncErr.purgeDependencyOnElmtId(rmElmtId);
        this.__missErr.purgeDependencyOnElmtId(rmElmtId);
        this.__mimeJpg.purgeDependencyOnElmtId(rmElmtId);
        this.__mimeMis.purgeDependencyOnElmtId(rmElmtId);
        this.__wMis.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__w1.aboutToBeDeleted();
        this.__h1.aboutToBeDeleted();
        this.__mime.aboutToBeDeleted();
        this.__w2.aboutToBeDeleted();
        this.__h2.aboutToBeDeleted();
        this.__err.aboutToBeDeleted();
        this.__syncW.aboutToBeDeleted();
        this.__syncErr.aboutToBeDeleted();
        this.__missErr.aboutToBeDeleted();
        this.__mimeJpg.aboutToBeDeleted();
        this.__mimeMis.aboutToBeDeleted();
        this.__wMis.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __w1: ObservedPropertySimplePU<number>;
    get w1() {
        return this.__w1.get();
    }
    set w1(newValue: number) {
        this.__w1.set(newValue);
    }
    private __h1: ObservedPropertySimplePU<number>;
    get h1() {
        return this.__h1.get();
    }
    set h1(newValue: number) {
        this.__h1.set(newValue);
    }
    private __mime: ObservedPropertySimplePU<string>;
    get mime() {
        return this.__mime.get();
    }
    set mime(newValue: string) {
        this.__mime.set(newValue);
    }
    private __w2: ObservedPropertySimplePU<number>;
    get w2() {
        return this.__w2.get();
    }
    set w2(newValue: number) {
        this.__w2.set(newValue);
    }
    private __h2: ObservedPropertySimplePU<number>;
    get h2() {
        return this.__h2.get();
    }
    set h2(newValue: number) {
        this.__h2.set(newValue);
    }
    private __err: ObservedPropertySimplePU<string>;
    get err() {
        return this.__err.get();
    }
    set err(newValue: string) {
        this.__err.set(newValue);
    }
    private __syncW: ObservedPropertySimplePU<number>;
    get syncW() {
        return this.__syncW.get();
    }
    set syncW(newValue: number) {
        this.__syncW.set(newValue);
    }
    private __syncErr: ObservedPropertySimplePU<string>;
    get syncErr() {
        return this.__syncErr.get();
    }
    set syncErr(newValue: string) {
        this.__syncErr.set(newValue);
    }
    private __missErr: ObservedPropertySimplePU<string>;
    get missErr() {
        return this.__missErr.get();
    }
    set missErr(newValue: string) {
        this.__missErr.set(newValue);
    }
    private __mimeJpg: ObservedPropertySimplePU<string>;
    get mimeJpg() {
        return this.__mimeJpg.get();
    }
    set mimeJpg(newValue: string) {
        this.__mimeJpg.set(newValue);
    }
    private __mimeMis: ObservedPropertySimplePU<string>;
    get mimeMis() {
        return this.__mimeMis.get();
    }
    set mimeMis(newValue: string) {
        this.__mimeMis.set(newValue);
    }
    private __wMis: ObservedPropertySimplePU<number>;
    get wMis() {
        return this.__wMis.get();
    }
    set wMis(newValue: number) {
        this.__wMis.set(newValue);
    }
    aboutToAppear() {
        // ① 已知尺寸 PNG（7×3）；相对路径由运行时按页面 origin 解析
        const src: image.ImageSource = image.createImageSource('/test-assets/known-7x3.png');
        src.getImageInfo().then((info: image.ImageInfo) => {
            this.w1 = info.size.width;
            this.h1 = info.size.height;
            this.mime = info.mimeType;
            // ② 解码过之后再问同步版：应当拿到同一份结果（本实现无法同步解码，只回缓存）
            const s = src.getImageInfoSync();
            this.syncW = s.size.width;
        }).catch((e: Error) => {
            this.err = e.message;
        });
        // ③ 另一张不同尺寸的（13×5），验证不是写死的
        const src2: image.ImageSource = image.createImageSource('/test-assets/known-13x5.png');
        src2.getImageInfo().then((info: image.ImageInfo) => {
            this.w2 = info.size.width;
            this.h2 = info.size.height;
        }).catch((e: Error) => {
            this.err = e.message;
        });
        // ④ 负向：没先异步解码就问同步版 —— 必须响亮失败，不能编一个尺寸出来
        const src3: image.ImageSource = image.createImageSource('/test-assets/known-1x1.png');
        try {
            src3.getImageInfoSync();
            this.syncErr = 'no-throw';
        }
        catch (e) {
            this.syncErr = 'threw';
        }
        // ⑤ 负向：文件不存在 —— 必须报可操作的错（不是静默返回 0×0）
        const src4: image.ImageSource = image.createImageSource('/test-assets/does-not-exist.png');
        src4.getImageInfo().then((info: image.ImageInfo) => {
            this.missErr = 'resolved:' + info.size.width;
        }).catch((e: Error) => {
            this.missErr = e.message;
        });
        // ⑥ 真 JPEG（11×4）：mimeType 必须是 image/jpeg —— 这条给 mimeType 断言装上牙齿
        const src5: image.ImageSource = image.createImageSource('/test-assets/known-11x4.jpg');
        src5.getImageInfo().then((info: image.ImageInfo) => {
            this.mimeJpg = info.mimeType;
        }).catch((e: Error) => {
            this.mimeJpg = 'err:' + e.message;
        });
        // ⑦ 伪装：PNG 字节但扩展名 .jpg（服务端按扩展名给 image/jpeg）
        //    mimeType 的权威语义是【解码后的真实格式】→ 必须报 image/png，而不是响应头
        const src6: image.ImageSource = image.createImageSource('/test-assets/known-mislabeled.jpg');
        src6.getImageInfo().then((info: image.ImageInfo) => {
            this.mimeMis = info.mimeType;
            this.wMis = info.size.width;
        }).catch((e: Error) => {
            this.mimeMis = 'err:' + e.message;
        });
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 2 });
            Column.width('100%');
            Column.height('100%');
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('w1=' + this.w1);
            Text.id('w1');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('h1=' + this.h1);
            Text.id('h1');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('mime=' + this.mime);
            Text.id('mime');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('syncW=' + this.syncW);
            Text.id('syncW');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('w2=' + this.w2);
            Text.id('w2');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('h2=' + this.h2);
            Text.id('h2');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('syncErr=' + this.syncErr);
            Text.id('syncErr');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('missErr=' + this.missErr);
            Text.id('missErr');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('mimeJpg=' + this.mimeJpg);
            Text.id('mimeJpg');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('mimeMis=' + this.mimeMis);
            Text.id('mimeMis');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('wMis=' + this.wMis);
            Text.id('wMis');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('err=' + this.err);
            Text.id('err');
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
        return "MeasImage";
    }
}
registerNamedRoute(() => new MeasImage(undefined, {}), "", { bundleName: "com.example.hmtest", moduleName: "entry", pagePath: "pages/MeasImage", pageFullPath: "entry/src/main/ets/pages/MeasImage", integratedHsp: "false", moduleType: "followWithHap" });
