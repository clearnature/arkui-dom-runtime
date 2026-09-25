// R67 测量/验证用页面：批次 E 布局/叠放族（FolderStack + GridContainer + XComponentNode）
//   ① FolderStack：upperItems 悬停避让 + onFolderStateChange/onHoverStatusChange（折屏硬件驱动，
//      真机验证需折叠屏；普通设备只验叠放基座与属性登记）
//   ② GridContainer（deprecated since 9）：columns/sizeType/gutter/margin 列网格
//   ③ XComponentNode（deprecated since 12）：类面 onCreate/onDestroy/changeRenderType
// ⚠️ Sheet/Section（ets-loader 内部组件，本 SDK 无公开 d.ts）与 UnionEffectContainer
//    （systemApi:true）不在普通应用的可达范围内 —— 浏览器端手写产物
//    fixtures/pages/BatchLayoutDemo.ts 会直接建出这三件做断言，真机页不包含它们。
import { XComponentNode, NodeRenderType, RenderOptions, UIContext } from '@kit.ArkUI';

class BatchNode extends XComponentNode {
  fired: number = 0;

  constructor(uiContext: UIContext) {
    super(uiContext, {} as RenderOptions, 'batch-xcn', XComponentType.NODE, '');
  }

  onCreate(): void {
    this.fired = this.fired + 1;
  }

  onDestroy(): void {
    this.fired = this.fired - 1;
  }
}

@Entry
@Component
struct BatchLayoutDemo {
  @State log: string = '';
  @State foldLog: string = '';
  @State hoverLog: string = '';
  private node: BatchNode | null = null;

  aboutToAppear(): void {
    this.node = new BatchNode(this.getUIContext());
    const node = this.node;
    // changeRenderType：合法值（TEXTURE=1）返回 true；非法值（9）返回 false
    const okTexture: boolean = node.changeRenderType(NodeRenderType.RENDER_TYPE_TEXTURE);
    const okInvalid: boolean = node.changeRenderType(9);
    this.log = 'rt=' + (okTexture ? '1' : '0') + ',bad=' + (okInvalid ? '1' : '0') + ';';
  }

  build() {
    Column({ space: 8 }) {
      // ① FolderStack：叠放基座 + 悬停避让声明（'fs-upper' 移到上半屏）
      FolderStack({ upperItems: ['fs-upper'] }) {
        Text('upper').id('fs-upper').width('80%').height(60).backgroundColor('#c8e6c9')
        Text('lower').width('80%').height(60).backgroundColor('#ffcdd2')
      }
      .id('fs')
      .alignContent(Alignment.Center)
      .enableAnimation(false)
      .autoHalfFold(true)
      .onFolderStateChange((e: OnFoldStatusChangeInfo) => {
        this.foldLog = this.foldLog + 'F' + e.foldStatus + ';';
      })
      .onHoverStatusChange((p: HoverEventParam) => {
        this.hoverLog = this.hoverLog + 'H' + (p.isHoverMode ? '1' : '0') + ';';
      })

      // ② GridContainer：4 列网格，gutter 8 / margin 12
      GridContainer({ columns: 4, sizeType: SizeType.SM, gutter: 8, margin: 12 }) {
        Text('c0').backgroundColor('#bbdefb')
        Text('c1').backgroundColor('#bbdefb')
        Text('c2').backgroundColor('#bbdefb')
        Text('c3').backgroundColor('#bbdefb')
      }
      .id('gc')

      // ③ XComponentNode 类面的断言输出（宿主 div 由声明式面/NodeController 接线，本页只验类语义）
      Text(this.log).id('xcn-log').fontSize(12)
      Text(this.foldLog).id('fs-fold-log').fontSize(12)
      Text(this.hoverLog).id('fs-hover-log').fontSize(12)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
