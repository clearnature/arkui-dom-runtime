if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface GestureDemo_Params {
    log?: string;
    pan?: string;
}
class GestureDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.__pan = new ObservedPropertySimplePU('', this, "pan");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: GestureDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.pan !== undefined) {
            this.pan = params.pan;
        }
    }
    updateStateVars(params: GestureDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
        this.__pan.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
        this.__pan.aboutToBeDeleted();
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
    private __pan: ObservedPropertySimplePU<string>;
    get pan() {
        return this.__pan.get();
    }
    set pan(newValue: string) {
        this.__pan.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 4 });
            Column.width('100%');
            Column.height('100%');
            Column.alignItems(HorizontalAlign.Start);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.width(160);
            Row.height(80);
            Row.backgroundColor('#3366cc');
            Row.id('pad');
            globalThis.Gesture.create(GesturePriority.Low);
            PanGesture.create({ fingers: 1, direction: PanDirection.All, distance: 5 });
            PanGesture.onActionStart((e: GestureEvent) => {
                this.log = this.log + 'PS;';
            });
            PanGesture.onActionUpdate((e: GestureEvent) => {
                this.pan = 'upd=' + Math.round(e.offsetX) + ',' + Math.round(e.offsetY);
            });
            PanGesture.onActionEnd((e: GestureEvent) => {
                this.log = this.log + 'PE;';
                this.pan = 'end=' + Math.round(e.offsetX) + ',' + Math.round(e.offsetY);
            });
            PanGesture.pop();
            globalThis.Gesture.pop();
        }, Row);
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.width(120);
            Row.height(40);
            Row.backgroundColor('#228833');
            Row.id('tap');
            globalThis.Gesture.create(GesturePriority.Low);
            TapGesture.create({ count: 2, fingers: 1 });
            TapGesture.onAction((e: GestureEvent) => {
                this.log = this.log + 'T' + (e.repeat ? 'R' : 'F') + ';';
            });
            TapGesture.pop();
            globalThis.Gesture.pop();
        }, Row);
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.width(120);
            Row.height(40);
            Row.backgroundColor('#aa6622');
            Row.id('press');
            globalThis.Gesture.create(GesturePriority.Low);
            LongPressGesture.create({ repeat: false, duration: 300 });
            LongPressGesture.onAction((e: GestureEvent) => {
                this.log = this.log + 'L' + (e.repeat ? 'R' : 'F') + ';';
            });
            LongPressGesture.pop();
            globalThis.Gesture.pop();
        }, Row);
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.width(120);
            Row.height(40);
            Row.backgroundColor('#883399');
            Row.id('swipe');
            globalThis.Gesture.create(GesturePriority.Low);
            SwipeGesture.create({ fingers: 1, direction: SwipeDirection.Horizontal, speed: 100 });
            SwipeGesture.onAction((e: GestureEvent) => {
                this.log = this.log + 'W' + Math.round(e.angle) + 'v' + Math.round(e.speed / 100) + ';';
            });
            SwipeGesture.pop();
            globalThis.Gesture.pop();
        }, Row);
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Row.create();
            Row.width(120);
            Row.height(40);
            Row.backgroundColor('#117799');
            Row.id('pinch');
            globalThis.Gesture.create(GesturePriority.Low);
            PinchGesture.create({ fingers: 2, distance: 5 });
            PinchGesture.onActionStart((e: GestureEvent) => {
                this.log = this.log + 'KS;';
            });
            PinchGesture.onActionUpdate((e: GestureEvent) => {
                this.pan = 'scale=' + e.scale.toFixed(2);
            });
            PinchGesture.onActionEnd((e: GestureEvent) => {
                this.log = this.log + 'KE;';
            });
            PinchGesture.pop();
            globalThis.Gesture.pop();
        }, Row);
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('pan=' + this.pan);
            Text.id('pan');
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('log=' + this.log);
            Text.id('glog');
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
        return "GestureDemo";
    }
}
registerNamedRoute(() => new GestureDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/GestureDemo", pageFullPath: "entry/src/main/ets/pages/GestureDemo", integratedHsp: "false", moduleType: "followWithHap" });
