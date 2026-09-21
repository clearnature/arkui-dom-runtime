if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface ShapeDemo_Params {
}
class ShapeDemo extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.setInitiallyProvidedValue(params);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: ShapeDemo_Params) {
    }
    updateStateVars(params: ShapeDemo_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
    }
    aboutToBeDeleted() {
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create({ space: 8 });
            Column.width('100%');
            Column.height('100%');
            Column.padding(8);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ① 枚举颜色 + 描边。⚠️ 非正方形：80×60 的内切圆 r=30 —— r=min(w,h)/2 的取值方向
            // 只有非正方形才能测出来（正方形下 min=max，破坏验证会空转，R13 坑 2 的翻版）
            Circle.create({ width: 80, height: 60 });
            // ① 枚举颜色 + 描边。⚠️ 非正方形：80×60 的内切圆 r=30 —— r=min(w,h)/2 的取值方向
            // 只有非正方形才能测出来（正方形下 min=max，破坏验证会空转，R13 坑 2 的翻版）
            Circle.id('c1');
            // ① 枚举颜色 + 描边。⚠️ 非正方形：80×60 的内切圆 r=30 —— r=min(w,h)/2 的取值方向
            // 只有非正方形才能测出来（正方形下 min=max，破坏验证会空转，R13 坑 2 的翻版）
            Circle.fill(Color.Red);
            // ① 枚举颜色 + 描边。⚠️ 非正方形：80×60 的内切圆 r=30 —— r=min(w,h)/2 的取值方向
            // 只有非正方形才能测出来（正方形下 min=max，破坏验证会空转，R13 坑 2 的翻版）
            Circle.stroke(Color.Blue);
            // ① 枚举颜色 + 描边。⚠️ 非正方形：80×60 的内切圆 r=30 —— r=min(w,h)/2 的取值方向
            // 只有非正方形才能测出来（正方形下 min=max，破坏验证会空转，R13 坑 2 的翻版）
            Circle.strokeWidth(3);
        }, Circle);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ② 圆角矩形 + 字符串颜色
            Rect.create({ width: 120, height: 60, radiusWidth: 12, radiusHeight: 12 });
            // ② 圆角矩形 + 字符串颜色
            Rect.id('r1');
            // ② 圆角矩形 + 字符串颜色
            Rect.fill(Color.Green);
            // ② 圆角矩形 + 字符串颜色
            Rect.stroke('#333333');
            // ② 圆角矩形 + 字符串颜色
            Rect.strokeWidth(2);
        }, Rect);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ③ 椭圆
            Ellipse.create({ width: 100, height: 50 });
            // ③ 椭圆
            Ellipse.id('e1');
            // ③ 椭圆
            Ellipse.fill('#ffcc00');
        }, Ellipse);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ④ 线段：startPoint/endPoint 是属性方法（LineOptions 里没有它们 —— 测量时撞上的）
            Line.create({ width: 100, height: 40 });
            // ④ 线段：startPoint/endPoint 是属性方法（LineOptions 里没有它们 —— 测量时撞上的）
            Line.id('l1');
            // ④ 线段：startPoint/endPoint 是属性方法（LineOptions 里没有它们 —— 测量时撞上的）
            Line.startPoint([0, 20]);
            // ④ 线段：startPoint/endPoint 是属性方法（LineOptions 里没有它们 —— 测量时撞上的）
            Line.endPoint([100, 20]);
            // ④ 线段：startPoint/endPoint 是属性方法（LineOptions 里没有它们 —— 测量时撞上的）
            Line.stroke(Color.Red);
            // ④ 线段：startPoint/endPoint 是属性方法（LineOptions 里没有它们 —— 测量时撞上的）
            Line.strokeWidth(2);
        }, Line);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ⑤ 路径：commands 原样进 d
            Path.create({ width: 100, height: 100, commands: 'M0 0 L50 50 L100 0' });
            // ⑤ 路径：commands 原样进 d
            Path.id('p1');
            // ⑤ 路径：commands 原样进 d
            Path.stroke('#0066cc');
            // ⑤ 路径：commands 原样进 d
            Path.strokeWidth(2);
            // ⑤ 路径：commands 原样进 d
            Path.fillOpacity(0);
        }, Path);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ⑥ 多边形：points
            Polygon.create({ width: 80, height: 80 });
            // ⑥ 多边形：points
            Polygon.id('pg1');
            // ⑥ 多边形：points
            Polygon.points([[40, 0], [80, 80], [0, 80]]);
            // ⑥ 多边形：points
            Polygon.fill('#cc6600');
        }, Polygon);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ⑦ 折线：points + 不填充
            Polyline.create({ width: 100, height: 60 });
            // ⑦ 折线：points + 不填充
            Polyline.id('pl1');
            // ⑦ 折线：points + 不填充
            Polyline.points([[0, 40], [50, 0], [100, 40]]);
            // ⑦ 折线：points + 不填充
            Polyline.stroke('#990099');
            // ⑦ 折线：points + 不填充
            Polyline.strokeWidth(3);
            // ⑦ 折线：points + 不填充
            Polyline.fillOpacity(0);
        }, Polyline);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // ⑧ Shape 容器：viewPort + 嵌套子形状 + 容器 fill/stroke
            Shape.create();
            // ⑧ Shape 容器：viewPort + 嵌套子形状 + 容器 fill/stroke
            Shape.id('sh1');
            // ⑧ Shape 容器：viewPort + 嵌套子形状 + 容器 fill/stroke
            Shape.width(120);
            // ⑧ Shape 容器：viewPort + 嵌套子形状 + 容器 fill/stroke
            Shape.height(80);
            // ⑧ Shape 容器：viewPort + 嵌套子形状 + 容器 fill/stroke
            Shape.viewPort({ x: 0, y: 0, width: 120, height: 80 });
            // ⑧ Shape 容器：viewPort + 嵌套子形状 + 容器 fill/stroke
            Shape.fill('#eeeeee');
            // ⑧ Shape 容器：viewPort + 嵌套子形状 + 容器 fill/stroke
            Shape.stroke('#222222');
            // ⑧ Shape 容器：viewPort + 嵌套子形状 + 容器 fill/stroke
            Shape.strokeWidth(1);
        }, Shape);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Rect.create();
            Rect.width('100%');
            Rect.height('100%');
        }, Rect);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Circle.create({ width: 40, height: 40 });
        }, Circle);
        // ⑧ Shape 容器：viewPort + 嵌套子形状 + 容器 fill/stroke
        Shape.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    public __resetStateVarsOnReuse__Internal(params: Object): void {
    }
    static getEntryName(): string {
        return "ShapeDemo";
    }
}
registerNamedRoute(() => new ShapeDemo(undefined, {}), "", { bundleName: "com.example.arkuidomprobe", moduleName: "entry", pagePath: "pages/ShapeDemo", pageFullPath: "entry/src/main/ets/pages/ShapeDemo", integratedHsp: "false", moduleType: "followWithHap" });
