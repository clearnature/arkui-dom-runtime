if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface ShowDemo_Params {
    log?: string;
    cnt?: number;
}
class ShowDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__log = new ObservedPropertySimplePU('', this, "log");
        this.__cnt = new ObservedPropertySimplePU(5, this, "cnt");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: ShowDemo_Params) {
        if (params.log !== undefined) {
            this.log = params.log;
        }
        if (params.cnt !== undefined) {
            this.cnt = params.cnt;
        }
    }
    updateStateVars(params: ShowDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__log.purgeDependencyOnElmtId(rmElmtId);
        this.__cnt.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__log.aboutToBeDeleted();
        this.__cnt.aboutToBeDeleted();
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
    private __cnt: ObservedPropertySimplePU<number>;
    get cnt() {
        return this.__cnt.get();
    }
    set cnt(newValue: number) {
        this.__cnt.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ① Badge：value 形态 + 位置枚举。⚠️ BadgeStyle 字段是 color/fontSize/badgeColor…（编译期实测）
            Badge.create({
                count: 9,
                position: BadgePosition.RightTop,
                style: { badgeColor: Color.Red, color: Color.White, fontSize: 10 }
            });
            // ① Badge：value 形态 + 位置枚举。⚠️ BadgeStyle 字段是 color/fontSize/badgeColor…（编译期实测）
            Badge.id('bd1');
        }, Badge);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('msg');
            Text.id('badge1-body');
        }, Text);
        Text.pop();
        // ① Badge：value 形态 + 位置枚举。⚠️ BadgeStyle 字段是 color/fontSize/badgeColor…（编译期实测）
        Badge.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ② Badge：style 定制（badgeColor/color/fontSize 都在 create 参数里 —— 没有 .style() 方法）
            Badge.create({
                value: '99',
                position: BadgePosition.Right,
                style: { badgeColor: '#1234ff', color: '#ffffff', fontSize: 12 }
            });
            // ② Badge：style 定制（badgeColor/color/fontSize 都在 create 参数里 —— 没有 .style() 方法）
            Badge.id('bd2');
        }, Badge);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('mail');
            Text.id('badge2-body');
        }, Text);
        Text.pop();
        // ② Badge：style 定制（badgeColor/color/fontSize 都在 create 参数里 —— 没有 .style() 方法）
        Badge.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ③ Counter：容器 + 内置加减 + 事件归属
            Counter.create();
            // ③ Counter：容器 + 内置加减 + 事件归属
            Counter.id('ct1');
            // ③ Counter：容器 + 内置加减 + 事件归属
            Counter.onInc(() => { this.log = this.log + 'INC;'; });
            // ③ Counter：容器 + 内置加减 + 事件归属
            Counter.onDec(() => { this.log = this.log + 'DEC;'; });
        }, Counter);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('5');
            Text.id('counter-body');
        }, Text);
        Text.pop();
        // ③ Counter：容器 + 内置加减 + 事件归属
        Counter.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ④ Divider：横向默认 / 纵向 + 颜色粗细
            Divider.create();
            // ④ Divider：横向默认 / 纵向 + 颜色粗细
            Divider.id('dv1');
            // ④ Divider：横向默认 / 纵向 + 颜色粗细
            Divider.color('#888888');
            // ④ Divider：横向默认 / 纵向 + 颜色粗细
            Divider.strokeWidth(3);
        }, Divider);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Divider.create();
            Divider.id('dv2');
            Divider.vertical(true);
            Divider.strokeWidth(5);
        }, Divider);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ⑤ Marquee：跑马灯。⚠️ MarqueeOptions 的 start 是【必填】（编译期实测）
            Marquee.create({ src: 'Hello marquee', start: true, loop: 2 });
            // ⑤ Marquee：跑马灯。⚠️ MarqueeOptions 的 start 是【必填】（编译期实测）
            Marquee.id('mq1');
            // ⑤ Marquee：跑马灯。⚠️ MarqueeOptions 的 start 是【必填】（编译期实测）
            Marquee.fontColor('#0066cc');
            // ⑤ Marquee：跑马灯。⚠️ MarqueeOptions 的 start 是【必填】（编译期实测）
            Marquee.fontSize(16);
            // ⑤ Marquee：跑马灯。⚠️ MarqueeOptions 的 start 是【必填】（编译期实测）
            Marquee.onStart(() => { this.log = this.log + 'MS;'; });
            // ⑤ Marquee：跑马灯。⚠️ MarqueeOptions 的 start 是【必填】（编译期实测）
            Marquee.onFinish(() => { this.log = this.log + 'MF;'; });
        }, Marquee);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(this.log);
            Text.id('show-log');
            Text.fontSize(12);
            Text.height(24);
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
        return "ShowDemo";
    }
}
registerNamedRoute(() => new ShowDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/ShowDemo", pageFullPath: "entry/src/main/ets/pages/ShowDemo", integratedHsp: "false", moduleType: "followWithHap" });
