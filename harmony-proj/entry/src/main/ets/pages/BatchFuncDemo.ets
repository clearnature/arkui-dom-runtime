/**
 * R66 批量功能组件夹具源码：Repeat / WithTheme / MenuItemGroup / IndicatorComponent /
 * ContainerReader / Calendar（对应冻结产物 fixtures/pages/BatchFuncDemo.ts，
 * 测试页 test/batchfunc.html）。
 *
 * 注意：Calendar 是 systemApi 老组件，本 SDK 的 component/ 下没有 calendar.d.ts
 * （index-full.d.ts 引用它但文件未随 SDK 发布）；此页按 ets-loader/components/calendar.json
 * 的属性面书写，hvigor 编译不过时以冻结产物为准。
 */
import { IndicatorComponentController } from '@kit.ArkUI';

interface DayData {
  year: number;
  month: number;
  day: number;
  mark?: string;
}

@Entry
@Component
struct BatchFuncDemo {
  @State log: string = '';
  @State month: string = '';
  @State sel: string = '';
  @State idx: number = -1;
  @State items: string[] = ['a', 'b', 'c', 'd', 'e', 'f'];
  private indicCtrl: IndicatorComponentController = new IndicatorComponentController();

  build() {
    Column({ space: 8 }) {
      // ① Repeat：6 项数据源 + virtualScroll totalCount=4 → 只渲染前 4 项
      Repeat<string>(this.items)
        .each((ri: RepeatItem<string>) => {
          Text('R' + ri.item).id('rep-' + ri.index).fontSize(12)
        })
        .key((item: string, i: number) => item + i)
        .virtualScroll({ totalCount: 4 })

      // ② WithTheme：LIGHT 色彩模式作用域
      WithTheme({ colorMode: ThemeColorMode.LIGHT }) {
        Text('themed').id('wt-text')
      }.id('wt')

      // ③ Menu + MenuItemGroup：分组（header/footer）+ 组外散项
      Menu() {
        MenuItemGroup({ header: '分组A', footer: 'A组尾' }) {
          MenuItem({ content: 'mA1' }).id('mi-a1')
          MenuItem({ content: 'mA2' }).id('mi-a2')
        }.id('mig')
        MenuItem({ content: 'solo' }).id('mi-solo')
      }.id('mn')

      // ④ IndicatorComponent：3 个指示点 + 控制器
      IndicatorComponent(this.indicCtrl)
        .count(3)
        .initialIndex(1)
        .onChange((i: number) => { this.idx = i; })
        .id('ind')

      // ⑤ ContainerReader：容器尺寸断点读取
      ContainerReader({ size: { width: 700, height: 500 }, widthBreakpoint: 2 })
        .breakpointConfig({ width: [320, 600, 840] })
        .id('cr')

      // ⑥ Calendar（systemApi 老组件）：2026-09 锚月 + 周一头 + 周末休息 + 样式对象
      Calendar({ selected: new Date(2026, 8, 15) })
        .startOfWeek(1)
        .offDays([0, 6])
        .onSelectChange((d: Date) => {
          this.sel = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
        })
        .onRequestData((ym: string) => { this.month = ym; })
        .currentData([{ year: 2026, month: 9, day: 10, mark: '会' } as DayData])
        .todayStyle({ dayColor: '#B3261E' })
        .workStateStyle({ dayColor: '#C62828' })
        .needSlide(false)
        .id('cal')

      Text('month=' + this.month).id('cal-month-log').fontSize(12)
      Text('sel=' + this.sel).id('cal-sel-log').fontSize(12)
      Text('idx=' + this.idx).id('ind-log').fontSize(12)
    }
    .width('100%')
    .padding(8)
  }
}
