// R49 测量/验证用页面：ListItemGroup 分组容器（header/footer/space/spaceWidth/divider/粘头）
//   ① 组A：header('GA头' 40) + 3×ListItem(80) + footer('GA尾' 40)、space 10、CARD、divider
//      → 组高 340（40+240+20+40）；间距只夹在 item 间（不作用 header/footer）
//   ② 组B：spaceWidth 4 压过 space 99（.d.ts precedence）→ 组高 98
//   ③ List.sticky(Header)：滚 120px 后组A头吸顶；组B 首项（非 sticky 对照）在 220
@Entry
@Component
struct ListGroupDemo {
  @State log: string = '';

  @Builder gah() {
    Text('GA头').id('gah').height(40).width('100%')
  }

  @Builder gaf() {
    Text('GA尾').id('gaf').height(40).width('100%')
  }

  build() {
    Column({ space: 8 }) {
      List() {
        ListItemGroup({ header: () => this.gah(), footer: () => this.gaf(), space: 10, style: ListItemGroupStyle.CARD }) {
          ListItem() {
            Text('ga0').height(80).width('100%')
          }
          .id('ga0')
          ListItem() {
            Text('ga1').height(80).width('100%')
          }
          .id('ga1')
          ListItem() {
            Text('ga2').height(80).width('100%')
          }
          .id('ga2')
        }
        .id('ga')
        .divider({ strokeWidth: 1, color: '#FF0000', startMargin: 4, endMargin: 4 })

        ListItemGroup({ spaceWidth: 4, space: 99 }) {
          ListItem() {
            Text('gb0').height(30).width('100%')
          }
          .id('gb0')
          ListItem() {
            Text('gb1').height(30).width('100%')
          }
          .id('gb1')
          ListItem() {
            Text('gb2').height(30).width('100%')
          }
          .id('gb2')
        }
        .id('gb')
      }
      .id('ls1')
      .width(360)
      .height(300)
      .sticky(StickyStyle.Header)

      Text(this.log).id('lg-log').fontSize(12)
    }
    .width('100%')
    .height('100%')
    .padding(0)
  }
}
