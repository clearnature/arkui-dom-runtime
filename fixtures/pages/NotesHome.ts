if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface NotesHome_Params {
    notes?: NoteItem[];
    keyword?: string;
    deviceLine?: string;
    copyLog?: string;
}
import router from "@ohos:router";
import pasteboard from "@ohos:pasteboard";
import deviceInfo from "@ohos:deviceInfo";
interface NoteItem {
    title: string;
    body: string;
    date: string;
}
class NotesHome extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__notes = new ObservedPropertyObjectPU([], this, "notes");
        this.__keyword = new ObservedPropertySimplePU('', this, "keyword");
        this.__deviceLine = new ObservedPropertySimplePU('', this, "deviceLine");
        this.__copyLog = new ObservedPropertySimplePU('', this, "copyLog");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: NotesHome_Params) {
        if (params.notes !== undefined) {
            this.notes = params.notes;
        }
        if (params.keyword !== undefined) {
            this.keyword = params.keyword;
        }
        if (params.deviceLine !== undefined) {
            this.deviceLine = params.deviceLine;
        }
        if (params.copyLog !== undefined) {
            this.copyLog = params.copyLog;
        }
    }
    updateStateVars(params: NotesHome_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__notes.purgeDependencyOnElmtId(rmElmtId);
        this.__keyword.purgeDependencyOnElmtId(rmElmtId);
        this.__deviceLine.purgeDependencyOnElmtId(rmElmtId);
        this.__copyLog.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__notes.aboutToBeDeleted();
        this.__keyword.aboutToBeDeleted();
        this.__deviceLine.aboutToBeDeleted();
        this.__copyLog.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __notes: ObservedPropertyObjectPU<NoteItem[]>;
    get notes() {
        return this.__notes.get();
    }
    set notes(newValue: NoteItem[]) {
        this.__notes.set(newValue);
    }
    private __keyword: ObservedPropertySimplePU<string>;
    get keyword() {
        return this.__keyword.get();
    }
    set keyword(newValue: string) {
        this.__keyword.set(newValue);
    }
    private __deviceLine: ObservedPropertySimplePU<string>;
    get deviceLine() {
        return this.__deviceLine.get();
    }
    set deviceLine(newValue: string) {
        this.__deviceLine.set(newValue);
    }
    private __copyLog: ObservedPropertySimplePU<string>;
    get copyLog() {
        return this.__copyLog.get();
    }
    set copyLog(newValue: string) {
        this.__copyLog.set(newValue);
    }
    aboutToAppear() {
        const arr: NoteItem[] = [];
        for (let i = 0; i < 300; i++) {
            arr.push({ title: 'Note ' + i, body: 'Body of Note ' + i + ' for copy test', date: '2026-09-26' });
        }
        this.notes = arr;
        this.deviceLine = deviceInfo.productModel + ' / ' + deviceInfo.osFullName;
    }
    filtered(): NoteItem[] {
        const out: NoteItem[] = [];
        for (const n of this.notes) {
            if (this.keyword === '' || n.title.indexOf(this.keyword) >= 0) {
                out.push(n);
            }
        }
        return out;
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 4 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('Notes ' + this.deviceLine);
            Text.id('home-title');
            Text.fontSize(14);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TextInput.create({ placeholder: 'search' });
            TextInput.id('search-box');
            TextInput.onChange((v: string) => {
                this.keyword = v;
            });
        }, TextInput);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('copy-first');
            Button.id('btn-copy');
            Button.onClick(() => {
                const pb = pasteboard.getSystemPasteboard();
                pb.setData(pasteboard.createData('text/plain', this.notes[0].body)).then(() => {
                    this.copyLog = 'copied';
                });
            });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('copyLog=' + this.copyLog);
            Text.id('copy-log');
            Text.fontSize(11);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('count=' + this.filtered().length);
            Text.id('note-count');
            Text.fontSize(11);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            List.create({ space: 2 });
            List.width('100%');
            List.layoutWeight(1);
        }, List);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ForEach.create();
            const forEachItemGenFunction = (_item, idx: number) => {
                const n = _item;
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
                            Row.create();
                            Row.width('90%');
                            Row.padding(6);
                            Row.onClick(() => {
                                router.pushUrl({ url: 'pages/NotesDetail', params: { idx: String(idx), title: n.title } });
                            });
                        }, Row);
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Text.create(n.title);
                            Text.fontSize(14);
                            Text.fontColor('#222222');
                        }, Text);
                        Text.pop();
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            Text.create(n.date);
                            Text.fontSize(11);
                            Text.fontColor('#888888');
                            Text.margin({ left: 8 });
                        }, Text);
                        Text.pop();
                        Row.pop();
                        ListItem.pop();
                    };
                    this.observeComponentCreation2(itemCreation2, ListItem);
                    ListItem.pop();
                }
            };
            this.forEachUpdateFunction(elmtId, this.filtered(), forEachItemGenFunction, (n: NoteItem, idx: number) => 'n' + idx, true, true);
        }, ForEach);
        ForEach.pop();
        List.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "NotesHome";
    }
}
registerNamedRoute(() => new NotesHome(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/NotesHome", pageFullPath: "entry/src/main/ets/pages/NotesHome", integratedHsp: "false", moduleType: "followWithHap" });
