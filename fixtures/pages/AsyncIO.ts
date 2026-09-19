if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface AsyncIO_Params {
    msg?: string;
    post?: string;
    timeout?: string;
}
import fs from "@ohos:file.fs";
import http from "@ohos:net.http";
class AsyncIO extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__msg = new ObservedPropertySimplePU('(idle)', this, "msg");
        this.__post = new ObservedPropertySimplePU('(no post)', this, "post");
        this.__timeout = new ObservedPropertySimplePU('(no timeout)', this, "timeout");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: AsyncIO_Params) {
        if (params.msg !== undefined) {
            this.msg = params.msg;
        }
        if (params.post !== undefined) {
            this.post = params.post;
        }
        if (params.timeout !== undefined) {
            this.timeout = params.timeout;
        }
    }
    updateStateVars(params: AsyncIO_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__msg.purgeDependencyOnElmtId(rmElmtId);
        this.__post.purgeDependencyOnElmtId(rmElmtId);
        this.__timeout.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__msg.aboutToBeDeleted();
        this.__post.aboutToBeDeleted();
        this.__timeout.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __msg: ObservedPropertySimplePU<string>;
    get msg() {
        return this.__msg.get();
    }
    set msg(newValue: string) {
        this.__msg.set(newValue);
    }
    private __post: ObservedPropertySimplePU<string>;
    get post() {
        return this.__post.get();
    }
    set post(newValue: string) {
        this.__post.set(newValue);
    }
    private __timeout: ObservedPropertySimplePU<string>;
    get timeout() {
        return this.__timeout.get();
    }
    set timeout(newValue: string) {
        this.__timeout.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.justifyContent(FlexAlign.Center);
            Column.alignItems(HorizontalAlign.Center);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('AsyncIO');
            Text.fontSize(18);
            Text.fontWeight(FontWeight.Bold);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('msg=' + this.msg);
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('post=' + this.post);
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('timeout=' + this.timeout);
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('saveAsync');
            Button.onClick(() => {
                this.saveAsync();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('loadAsync');
            Button.onClick(() => {
                this.loadAsync();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('post');
            Button.onClick(() => {
                this.doPost();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('slow');
            Button.onClick(() => {
                this.doSlow();
            });
        }, Button);
        Button.pop();
        Column.pop();
    }
    async saveAsync() {
        const path = getContext(this).filesDir + '/async.txt';
        const file = await fs.open(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE);
        await fs.write(file.fd, 'async-payload');
        await fs.close(file);
        this.msg = 'saved-async';
    }
    async loadAsync() {
        this.msg = await fs.readText(getContext(this).filesDir + '/async.txt');
    }
    async doPost() {
        const req = http.createHttp();
        try {
            const resp = await req.request('/echo', {
                method: http.RequestMethod.POST,
                header: { 'Content-Type': 'application/json', 'X-Probe': 'probe-1' },
                extraData: JSON.stringify({ n: 1 }),
            });
            this.post = 'code=' + resp.responseCode + ' body=' + (resp.result as string);
        }
        catch (err) {
            this.post = 'error';
        }
        req.destroy();
    }
    async doSlow() {
        const req = http.createHttp();
        try {
            const resp = await req.request('/slow', {
                method: http.RequestMethod.GET,
                readTimeout: 500,
            });
            this.timeout = 'code=' + resp.responseCode;
        }
        catch (err) {
            this.timeout = 'threw';
        }
        req.destroy();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "AsyncIO";
    }
}
registerNamedRoute(() => new AsyncIO(undefined, {}), "", { bundleName: "com.example.hmtest", moduleName: "entry", pagePath: "pages/AsyncIO", pageFullPath: "entry/src/main/ets/pages/AsyncIO", integratedHsp: "false", moduleType: "followWithHap" });
