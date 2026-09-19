if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface NetFile_Params {
    fileText?: string;
    httpInfo?: string;
}
import fs from "@ohos:file.fs";
import http from "@ohos:net.http";
class NetFile extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__fileText = new ObservedPropertySimplePU('(空)', this, "fileText");
        this.__httpInfo = new ObservedPropertySimplePU('(未请求)', this, "httpInfo");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: NetFile_Params) {
        if (params.fileText !== undefined) {
            this.fileText = params.fileText;
        }
        if (params.httpInfo !== undefined) {
            this.httpInfo = params.httpInfo;
        }
    }
    updateStateVars(params: NetFile_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__fileText.purgeDependencyOnElmtId(rmElmtId);
        this.__httpInfo.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__fileText.aboutToBeDeleted();
        this.__httpInfo.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __fileText: ObservedPropertySimplePU<string>;
    get fileText() {
        return this.__fileText.get();
    }
    set fileText(newValue: string) {
        this.__fileText.set(newValue);
    }
    private __httpInfo: ObservedPropertySimplePU<string>;
    get httpInfo() {
        return this.__httpInfo.get();
    }
    set httpInfo(newValue: string) {
        this.__httpInfo.set(newValue);
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
            Text.create('NetFile');
            Text.fontSize(18);
            Text.fontWeight(FontWeight.Bold);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('file=' + this.fileText);
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('http=' + this.httpInfo);
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('write');
            Button.onClick(() => {
                this.writeFile();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('read');
            Button.onClick(() => {
                this.readFile();
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('fetch');
            Button.onClick(() => {
                this.doFetch();
            });
        }, Button);
        Button.pop();
        Column.pop();
    }
    filePath(): string {
        return getContext(this).filesDir + '/demo.txt';
    }
    writeFile() {
        const file = fs.openSync(this.filePath(), fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE);
        fs.writeSync(file.fd, 'hello from arkts');
        fs.closeSync(file);
        this.fileText = 'written';
    }
    readFile() {
        this.fileText = fs.readTextSync(this.filePath());
    }
    // 相对 URL：便于同源测试（http 垫片会按当前页 origin 解析），真实应用用绝对 URL 亦可
    async doFetch() {
        const req = http.createHttp();
        try {
            const resp = await req.request('/runtime/ohos-shims.js', {
                method: http.RequestMethod.GET,
            });
            const body = resp.result as string;
            this.httpInfo = 'code=' + resp.responseCode + ' len=' + body.length;
        }
        catch (err) {
            this.httpInfo = 'error';
        }
        req.destroy();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "NetFile";
    }
}
registerNamedRoute(() => new NetFile(undefined, {}), "", { bundleName: "com.example.hmtest", moduleName: "entry", pagePath: "pages/NetFile", pageFullPath: "entry/src/main/ets/pages/NetFile", integratedHsp: "false", moduleType: "followWithHap" });
