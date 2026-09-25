  // ────────────────── RowSplit / ColumnSplit 分隔容器（R62）──────────────────
  //
  // 产物形态（实测 fixtures/pages/SplitDemo.ts）：
  //   RowSplit.create(); RowSplit.width(240); RowSplit.height(60);
  //   ColumnSplit.create(); ColumnSplit.width(120); ColumnSplit.height(80);
  //
  // 语义（.d.ts）：RowSplit = 水平 flex 容器（子组件左右排列），ColumnSplit = 垂直 flex
  //   容器（子组件上下排列）；无自有属性（extends CommonMethod only）；真机有可拖拽分隔
  //   条（DOM 无拖拽分隔条实现，记标注）。
  // DOM：RowSplit → flex row；ColumnSplit → flex column；子组件由通用 width/height 控制。
  const RowSplit = ensureComponent('RowSplit', () => {
    const el = document.createElement('div');
    el.__arkuiRowSplit = true;
    el.dataset.rowSplit = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'row';
    el.style.overflow = 'hidden';
    el.style.position = 'relative';                   // 子组件 offset 相对容器
    return el;
  });
  const ColumnSplit = ensureComponent('ColumnSplit', () => {
    const el = document.createElement('div');
    el.__arkuiColumnSplit = true;
    el.dataset.columnSplit = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.overflow = 'hidden';
    el.style.position = 'relative';
    return el;
  });
