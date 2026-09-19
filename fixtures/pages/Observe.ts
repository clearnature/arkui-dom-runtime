if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface Observe_Params {
    items?: Item[];
    single?: Item;
}
interface SingleView_Params {
    obj?: Item;
}
interface ItemView_Params {
    item?: Item;
}
/*
 * ArkTS 状态管理 V1 深度观测用例页：@Observed + @ObjectLink。
 *
 * 【只做测量 + 提供断言目标】。V1 与 V2 的观测模型不同：
 *   V2 用 @Trace 逐字段标记；
 *   V1 用 @Observed 标记【整个类】——该类的所有自身字段都被观测，
 *      但【嵌套的非 @Observed 对象内部】不被观测（这正是本页的负向断言）。
 *
 * @ObjectLink 只接受 @Observed 实例（或 @State/@Prop/@Link 持有的可观测对象），
 * 且子组件里只能改它的字段、不能整个替换。
 */
// 普通类：不做 @Observed → 它的字段变更【不应】触发重渲染（负向断言）
class Meta {
    label: string;
    constructor(label: string) {
        this.label = label;
    }
}
// @Observed：标记整个类。自身字段 name/count/child 的变更都应触发
@Observed
class Item {
    id: number;
    name: string;
    count: number;
    child: Meta;
    constructor(id: number, name: string) {
        this.id = id;
        this.name = name;
        this.count = 0;
        this.child = new Meta('meta0');
    }
}
class ItemView extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__item = new SynchedPropertyNesedObjectPU(params.item, this, "item");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: ItemView_Params) {
        this.__item.set(params.item);
    }
    updateStateVars(params: ItemView_Params) {
        this.__item.set(params.item);
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__item.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__item.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __item: SynchedPropertyNesedObjectPU<Item>;
    get item() {
        return this.__item.get();
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 2 });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(`${this.item.name}`);
            Text.id(`item-name-${this.item.id}`);
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(`${this.item.count}`);
            Text.id(`item-count-${this.item.id}`);
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(`${this.item.child.label}`);
            Text.id(`item-meta-${this.item.id}`);
            Text.fontSize(12);
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('childBump');
            Button.id(`item-bump-${this.item.id}`);
            Button.onClick(() => { this.item.count += 1; });
        }, Button);
        Button.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
}
class SingleView extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__obj = new SynchedPropertyNesedObjectPU(params.obj, this, "obj");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: SingleView_Params) {
        this.__obj.set(params.obj);
    }
    updateStateVars(params: SingleView_Params) {
        this.__obj.set(params.obj);
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__obj.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__obj.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __obj: SynchedPropertyNesedObjectPU<Item>;
    get obj() {
        return this.__obj.get();
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(`single=${this.obj.name}`);
            Text.id('single-name');
            Text.fontSize(12);
        }, Text);
        Text.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
}
class Observe extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__items = new ObservedPropertyObjectPU([new Item(1, 'a'), new Item(2, 'b')], this, "items");
        this.__single = new ObservedPropertyObjectPU(new Item(9, 'solo'), this, "single");
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: Observe_Params) {
        if (params.items !== undefined) {
            this.items = params.items;
        }
        if (params.single !== undefined) {
            this.single = params.single;
        }
    }
    updateStateVars(params: Observe_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__items.purgeDependencyOnElmtId(rmElmtId);
        this.__single.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__items.aboutToBeDeleted();
        this.__single.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __items: ObservedPropertyObjectPU<Item[]>;
    get items() {
        return this.__items.get();
    }
    set items(newValue: Item[]) {
        this.__items.set(newValue);
    }
    private __single: ObservedPropertyObjectPU<Item>;
    get single() {
        return this.__single.get();
    }
    set single(newValue: Item) {
        this.__single.set(newValue);
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.padding(12);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 数组元素变更（长度不变）→ 子组件应重渲染
            ForEach.create();
            const forEachItemGenFunction = _item => {
                const it = _item;
                {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        if (isInitialRender) {
                            let componentCall = new ItemView(this, { item: it }, undefined, elmtId, () => { }, { page: "entry/src/main/ets/pages/Observe.ets", line: 72, col: 9 });
                            ViewPU.create(componentCall);
                            let paramsLambda = () => {
                                return {
                                    item: it
                                };
                            };
                            componentCall.paramsGenerator_ = paramsLambda;
                        }
                        else {
                            this.updateStateVarsOfChildByElmtId(elmtId, {
                                item: it
                            });
                        }
                    }, { name: "ItemView" });
                }
            };
            this.forEachUpdateFunction(elmtId, this.items, forEachItemGenFunction, (it: Item) => String(it.id), false, false);
        }, ForEach);
        // 数组元素变更（长度不变）→ 子组件应重渲染
        ForEach.pop();
        {
            this.observeComponentCreation2((elmtId, isInitialRender) => {
                if (isInitialRender) {
                    let componentCall = new SingleView(this, { obj: this.single }, undefined, elmtId, () => { }, { page: "entry/src/main/ets/pages/Observe.ets", line: 75, col: 7 });
                    ViewPU.create(componentCall);
                    let paramsLambda = () => {
                        return {
                            obj: this.single
                        };
                    };
                    componentCall.paramsGenerator_ = paramsLambda;
                }
                else {
                    this.updateStateVarsOfChildByElmtId(elmtId, {
                        obj: this.single
                    });
                }
            }, { name: "SingleView" });
        }
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('rename');
            Button.id('rename');
            Button.onClick(() => { this.items[0].name = 'renamed'; });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('bump');
            Button.id('bump');
            Button.onClick(() => { this.items[1].count += 1; });
        }, Button);
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 改嵌套的非 @Observed 对象内部 → 【不应】触发重渲染
            Button.createWithLabel('touchmeta');
            // 改嵌套的非 @Observed 对象内部 → 【不应】触发重渲染
            Button.id('touchmeta');
            // 改嵌套的非 @Observed 对象内部 → 【不应】触发重渲染
            Button.onClick(() => { this.items[0].child.label = 'metaX'; });
        }, Button);
        // 改嵌套的非 @Observed 对象内部 → 【不应】触发重渲染
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 替换嵌套对象本身 → 是 @Observed Item 的字段写入 → 应触发
            Button.createWithLabel('replacemeta');
            // 替换嵌套对象本身 → 是 @Observed Item 的字段写入 → 应触发
            Button.id('replacemeta');
            // 替换嵌套对象本身 → 是 @Observed Item 的字段写入 → 应触发
            Button.onClick(() => { this.items[0].child = new Meta('metaY'); });
        }, Button);
        // 替换嵌套对象本身 → 是 @Observed Item 的字段写入 → 应触发
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Button.createWithLabel('singlerename');
            Button.id('singlerename');
            Button.onClick(() => { this.single.name = 'solo2'; });
        }, Button);
        Button.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "Observe";
    }
}
registerNamedRoute(() => new Observe(undefined, {}), "", { bundleName: "com.example.hmtest", moduleName: "entry", pagePath: "pages/Observe", pageFullPath: "entry/src/main/ets/pages/Observe", integratedHsp: "false", moduleType: "followWithHap" });
