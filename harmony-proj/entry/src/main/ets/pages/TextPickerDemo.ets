// R56/R58 测量/验证用页面：TextPicker 文本选择器（选择器三部曲收官）
//   ① 单列：create({range: string[], selected})；滚轮同步单步（R51/R52 同族已确证时序）
//   ② onChange 官方签名是联合类型 (string|string[], number|number[])——窄签名被 10605999 拒
//   ③ selectedIndex 属性覆盖 / defaultPickerItemHeight 行高 / 对象形态 range 取 .text
//   ④ R58 多列：range string[][] → N 列独立滚轮；级联：children 联动（父变→子列重置）
//   ⑤ R58 静态弹层：TextPickerDialog.show({range, selected, onAccept, onCancel})
@Entry
@Component
struct TextPickerDemo {
  @State log: string = '';

  build() {
    Column({ space: 8 }) {
      // ① 基础：四季 range，selected 1（'夏'）
      TextPicker({ range: ['春', '夏', '秋', '冬'], selected: 1 })
        .id('tx1')
        .defaultPickerItemHeight(40)
        .onChange((value: string | string[], index: number | number[]) => {
          const v = Array.isArray(value) ? value.join('/') : value;
          const i = Array.isArray(index) ? index.join('/') : index;
          this.log = this.log + 'CHG' + v + ':' + i + ';';
        })

      // ② selectedIndex 属性覆盖：create selected 0 → 属性压成 2
      TextPicker({ range: ['甲', '乙', '丙'], selected: 0 })
        .id('tx2')
        .selectedIndex(2)

      // ③ 对象形态 range（TextPickerRangeContent[]）：取 .text
      TextPicker({ range: [{ text: '红' }, { text: '绿' }], selected: 0 })
        .id('tx3')

      // ④ 多列：2 列独立滚轮，selected [1,0]
      TextPicker({ range: [['春', '秋'], ['早', '晚']], selected: [1, 0] })
        .id('tx4')
        .onChange((value: string | string[], index: number | number[]) => {
          const v = Array.isArray(value) ? value.join('/') : String(value);
          const i = Array.isArray(index) ? index.join('/') : String(index);
          this.log = this.log + 'M' + v + ':' + i + ';';
        })

      // ⑤ 级联：父变 → 子列选项联动重置
      TextPicker({
        range: [
          { text: '菜', children: [{ text: '鱼' }, { text: '肉' }] },
          { text: '果', children: [{ text: '桃' }] }
        ]
      })
        .id('tx5')
        .onChange((value: string | string[], index: number | number[]) => {
          const v = Array.isArray(value) ? value.join('/') : String(value);
          const i = Array.isArray(index) ? index.join('/') : String(index);
          this.log = this.log + 'C' + v + ':' + i + ';';
        })

      // ⑦ R168：canLoop(false)——循环滚轮关闭对照组（缺省 true，text_picker.d.ts:487
      //   "Default value: **true**"；真机截图裁定=全高展开循环滚轮）
      TextPicker({ range: ['甲', '乙', '丙'], selected: 0 })
        .id('tx6')
        .canLoop(false)
        .onChange((value: string | string[], index: number | number[]) => {
          const v = Array.isArray(value) ? value.join('/') : String(value);
          const i = Array.isArray(index) ? index.join('/') : String(index);
          this.log = this.log + 'L' + v + ':' + i + ';';
        })

      // ⑥ 静态弹层
      Button('dlg').id('btn-dlg').onClick(() => {
        TextPickerDialog.show({
          range: ['甲', '乙', '丙'],
          selected: 1,
          onAccept: (result: TextPickerResult) => {
            this.log = this.log + 'ACC' + result.value + ':' + result.index + ';';
          },
          onCancel: () => {
            this.log = this.log + 'CAN;';
          }
        });
      })

      Text(this.log).id('tx-log').fontSize(12)
    }
    .width('100%')
    .height('100%')
    .padding(8)
  }
}
