#!/usr/bin/env python3
"""B0 可坍缩性量化（R165 · B 档起步）——【只读】静态分析已 dump 的页面 HTML。

目的：B 档（合并嵌套纯布局容器）动工前先算候选上限，避免零收益立项
（R162/R164 教训——估计必须让位给实测）。

输入（bash 包装器写入的固定路径，本进程零路径参数、零文件写）：
  build/layout-audit.html —— chrome --dump-dom 的整页输出

口径（两档模拟至不动点，各自独立计数）：
  严档（高置信起点）：容器 C(data-arkui-comp∈{Column,Row}) 嵌在纯 flex 容器系
    父(P∈{Column,Row,Flex,Stack})内，且 C 无 id、data-* 仅 comp 标记、
    C 的 style 只含 {display,flex-direction} 且 flex-direction 与父一致
    （同向重复层——删掉 C 把孩子交给父，几何风险交 B2 的 rect 对比闸验证）
  宽档（上限参考）：只要求父/子是容器系 + C 无 id + 无 data-* 语义标记
    （style 几何不管——此档不承诺安全，只标天花板）

用法（经包装器）：bash tools/layout-audit.sh [页名 ...]
安全口径：不 subprocess、不网络、不写文件——纯内存分析 + stdout。
"""
import re
import sys
from html.parser import HTMLParser

SKIP = {"br", "img", "input", "meta", "link", "hr", "source"}
FLEX_FAMILY = {"Column", "Row", "Flex", "Stack"}
GEOM_KEYS = re.compile(r"^(padding|margin|gap|width|height|min-|max-|align-|justify-|flex-wrap|flex-)")


class Node:
    __slots__ = ("tag", "attrs", "kids")

    def __init__(self, tag, attrs):
        self.tag = tag
        self.attrs = dict(attrs)
        self.kids = []


class RootFinder(HTMLParser):
    """抓 #root 起的子树（dump-dom 整页输入——只认 root 之后的结构）。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.root = None
        self.in_root = False

    def handle_starttag(self, tag, attrs):
        n = Node(tag, attrs)
        if self.stack:
            self.stack[-1].kids.append(n)
        if tag not in SKIP:
            self.stack.append(n)
        if not self.in_root and tag == "div" and dict(attrs).get("id") == "root":
            self.in_root = True
            self.root = n
            self.stack = [n]

    def handle_endtag(self, tag):
        if tag in SKIP:
            return
        if self.in_root and self.stack:
            self.stack.pop()

    def handle_data(self, data):
        pass  # 文本节点不参与容器合并分析（layout 成本主因是元素节点）


def comp_of(node):
    return (node.attrs.get("data-arkui-comp") or "").strip('"')


def style_of(node):
    s = node.attrs.get("style") or ""
    kv = {}
    for part in s.split(";"):
        if ":" in part:
            k, v = part.split(":", 1)
            kv[k.strip().lower()] = v.strip().lower()
    return kv


def has_semantic_markers(node):
    return any(k.startswith("data-") and k != "data-arkui-comp" for k in node.attrs)


def collapseable(node, parent, tier):
    """三档候选判定（tier: t0=contents 透传层零风险 / t1=同向无几何白名单 /
    wide=上限档——父为任意组件即可）。"""
    comp = comp_of(node)
    if "id" in node.attrs or has_semantic_markers(node):
        return False
    if tier == "t0":
        # T0：display:contents 的透传层（ForEach 等）——不生成盒，删除零布局影响
        if comp not in {"ForEach"}:
            return False
        sv = style_of(node)
        return set(sv).issubset({"display"}) and sv.get("display") == "contents"
    if comp not in {"Column", "Row", "ForEach"}:
        return False
    if tier == "wide":
        return bool(comp_of(parent))       # 上限：父是任意组件节点
    # T1（严档原逻辑）：同向白名单层
    if comp_of(parent) not in FLEX_FAMILY:
        return False
    if comp == "ForEach":
        sv0 = style_of(node)
        if set(sv0) == {"display"} and sv0.get("display") == "contents":
            return True                    # 透传层嵌在 flex 系里也零风险
        return False
    sv = style_of(node)
    if not set(sv).issubset({"display", "flex-direction"}):
        return False
    pdir = style_of(parent).get("flex-direction", "")
    ndir = sv.get("flex-direction", "")
    if ndir and pdir and ndir != pdir:
        return False
    if ndir and not pdir and comp_of(parent) not in {"Column"}:
        return False
    return True


def simulate(root, tier):
    """迭代删除候选至不动点，返回删除数。"""
    removed = 0
    changed = True
    while changed:
        changed = False

        def walk(parent):
            nonlocal removed, changed
            if changed:
                return
            i = 0
            while i < len(parent.kids):
                c = parent.kids[i]
                if collapseable(c, parent, tier):
                    parent.kids[i:i + 1] = c.kids
                    removed += 1
                    changed = True
                    return  # 树变了，重扫
                walk(c)
                i += 1
        walk(root)
    return removed


def count_all(root):
    n = 0
    stack = [root]
    while stack:
        x = stack.pop()
        for k in x.kids:
            n += 1
            stack.append(k)
    return n


def count_comp(root):
    n = 0
    stack = [root]
    while stack:
        x = stack.pop()
        for k in x.kids:
            if comp_of(k):
                n += 1
            stack.append(k)
    return n


def load_tree(raw):
    """双格式输入：① JSON 树（chrome-trace rootdump——void 子树可见，首选）
    ② HTML（legacy --dump-dom 通道，void 子树不可见）。"""
    text = raw.lstrip()
    if text.startswith("{"):
        import json as _json
        d = _json.loads(text)

        def build(x):
            n = Node(x.get("tag") or "div", x.get("attrs") or {})
            for c in x.get("kids") or []:
                n.kids.append(build(c))
            return n
        return build(d)
    p = RootFinder()
    p.feed(raw)
    p.close()
    return p.root


def find_misnest(root):
    """非法挂载检测（坑 97 家族——B0 附带影响面盘点）：
    ① HTML void 元素（input/img/br/hr…）含子树——序列化必丢、视觉必缺
    ② 语义叶组件（无子组件语义）被当父挂了东西"""
    VOID_TAGS = {"input", "img", "br", "hr", "meta", "link"}
    LEAF_COMPS = {"TextInput", "TextArea", "Search", "Hyperlink", "Checkbox",
                  "Radio", "Toggle", "Slider", "Button", "Span", "Blank",
                  "LoadingProgress", "Divider"}
    bad = []

    def walk(node):
        for k in node.kids:
            if node.tag in VOID_TAGS:
                bad.append("void<%s>含子 <%s comp=%s>" % (node.tag, k.tag, comp_of(k) or "-"))
            pc = comp_of(node)
            if pc in LEAF_COMPS and comp_of(k):
                bad.append("叶%s内含子 comp=%s" % (pc, comp_of(k)))
            walk(k)

    if root:
        walk(root)
    return bad


def main():
    path = "build/layout-audit.html"
    try:
        html = open(path, encoding="utf-8").read()
    except OSError as e:
        print("❌ 读不到 %s（先经 tools/layout-audit.sh）: %s" % (path, e))
        sys.exit(2)
    base = load_tree(html)
    if not base:
        print("❌ dump 里没有 #root")
        sys.exit(1)

    total = count_all(base)
    comps = count_comp(base)
    # 每档独立建树（simulate 会动树）
    t0_removed = simulate(load_tree(html), "t0")
    t1_removed = simulate(load_tree(html), "t1")
    wide_removed = simulate(load_tree(html), "wide")
    bad = find_misnest(load_tree(html))

    line = ("总元素 %d | comp %d | T0透传层可省 %d（%.1f%%） | T1同向层 %d（%.1f%%） | 宽档上限 %d（%.1f%%）"
            % (total, comps,
               t0_removed, t0_removed * 100.0 / max(1, total),
               t1_removed, t1_removed * 100.0 / max(1, total),
               wide_removed, wide_removed * 100.0 / max(1, total)))
    if bad:
        line += " | ⚠️非法挂载 %d（%s …）" % (len(bad), "; ".join(bad[:2]))
    print(line)


if __name__ == "__main__":
    main()
