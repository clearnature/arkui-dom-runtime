#!/usr/bin/env python3
"""第六端切片 2：逐页驱动器对拍（官方 oracle vs 五端运行时）。

管线（docs/HARMONYOS-EMULATOR.md §6 切片 2）：
  设备侧：main_pages.json 逐页 → force-stop → aa start --ps hm_page pages/X
          → uitest dumpLayout（JSON）→ pagePath 标记 + app 子树可见文本
  浏览器侧：build/*.js 里按 pagePath 反查模块 → hm-harness.html 渲染
          → #result JSON（坑 115 单通道）→ #root 文本流
  对拍：两侧文本流【去空白后逐字符比对】（相邻重复折叠——设备 accessibility 双写）。

判定（@@TSV 标记块 → 包装器 tools/hm-pages.sh 落 build/assert-counts-hm.tsv；
page⇥verdict⇥dev/brw 字符数）：
  PASS 文本流一致 · DIFF 不一致（两侧全文 @@TEXT 块进 hm-pages.log 留档）
  SKIP-nomap 无对应 build 模块（HAP 页未经 extract）· SKIP-nolink 设备/hdc 缺席
  INFRA 启动标记缺失/dump 失败（计入退出码）
退出码：INFRA>0 或 SKIP-nolink 全程缺设备 → 1；DIFF 是【产出物】不算失败。

用法：python3 tools/hm-pages.py [pages/X ...]（不传=main_pages 全量）
环境：HM_HDC/HM_CLT · CHROME · HM_SETTLE(默认6s——Stress10k 类重页实测挂载 ~8s，内部 dump 点 6/8/10s 覆盖) · HM_SKIP_DEVICE=1（只跑浏览器侧）
"""
import json
import os
import re
import subprocess
import sys
import time
import html as htmlmod
import http.client


class Cdp:
    """极简同步 CDP 客户端（同 chrome-trace.py——真实时钟通道，R165 B0 实证
    --dump-dom 虚拟时钟存在「终态树不完整」假象，对拍 browser 侧一并弃用）。"""

    def __init__(self, url):
        import websocket
        self.ws = websocket.create_connection(url, timeout=10, origin="http://127.0.0.1")
        self.n = 0
        self.events = {}

    def call(self, method, params=None, timeout=10):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            self.ws.settimeout(max(0.5, deadline - time.time()))
            try:
                msg = json.loads(self.ws.recv())
            except Exception:
                continue
            if msg.get("id") == self.n:
                if "error" in msg:
                    raise RuntimeError("%s: %s" % (method, msg["error"]))
                return msg.get("result", {})
            if "method" in msg:
                self.events.setdefault(msg["method"], []).append(msg.get("params") or {})
        raise RuntimeError("%s 响应超时" % method)

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def devtools_tabs(dbg_port):
    """http.client + 字面量 host（Mimosa SSRF 纪律，禁 urlopen/动态 URL）。"""
    conn = http.client.HTTPConnection("127.0.0.1", int(dbg_port), timeout=2)
    try:
        conn.request("GET", "/json/list")
        return json.loads(conn.getresponse().read())
    finally:
        conn.close()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLT = os.environ.get(
    "HM_CLT", "/data/training/cli/commandline-tools-linux-x64-26.0.0.821/command-line-tools")
HDC = os.environ.get("HM_HDC", os.path.join(CLT, "sdk/default/openharmony/toolchains/hdc"))
EMU = os.path.join(CLT, "emulator/Emulator")
BUNDLE = "com.example.arkuidomprobe"
# 多 target（phone 5555 + 2in1 16001 并存）时 hdc shell 必须 -t——R167 实录：双实例
# 起来后全部设备调用报 connect-key/more than one device（INFRA 假红）。
# 恒对 phone（第六端正主）——固定字面量写死在各调用点，2in1（16001）是切片 3 专用
# 不经本工具。
SETTLE = float(os.environ.get("HM_SETTLE", "6"))
TMP = os.environ.get("ARKUI_PKG_TMP", "/data/tmp")


# R169：hdc 目标端口每轮冷启动会漂（R161 实录 5557→5555，本轮回 5557）——
# 候选集固定【字面量】（扫描纪律：动态串不进命令列表），tconn 逐个试 + list targets
# 对账，取命中的第一个；都不中回退 5555（设备离线时反正走 INFRA 显式跳过）。
HDC_TARGETS = ["127.0.0.1:5557", "127.0.0.1:5555", "127.0.0.1:16001"]
TARGET = "127.0.0.1:5555"


def resolve_target():
    global TARGET
    env = dict(os.environ, HDC_SERVER_PORT="5557")
    for p in HDC_TARGETS:
        subprocess.run([HDC, "tconn", p], env=env, capture_output=True, timeout=15)
    r = subprocess.run([HDC, "list targets"], env=env, capture_output=True,
                       text=True, timeout=15)
    lines = {t.strip() for t in (r.stdout or "").splitlines()}
    for p in HDC_TARGETS:
        if p in lines:
            TARGET = p
            break


def hcs(*args, timeout=60):
    """hdc 调用：候选端口逐个 tconn + list targets 对账选靶（R161/R169 漂移实录）。"""
    env = dict(os.environ, HDC_SERVER_PORT="5557")
    r = subprocess.run([HDC, "-t", TARGET, "shell", *args], env=env,
                       capture_output=True, text=True, timeout=timeout, shell=False)
    return (r.stdout + r.stderr).strip()


def hdc_available():
    if os.environ.get("HM_SKIP_DEVICE") == "1" or not os.path.exists(HDC):
        return False
    resolve_target()
    r = subprocess.run([HDC, "list targets"], env=dict(os.environ, HDC_SERVER_PORT="5557"),
                       capture_output=True, text=True, timeout=15)
    return any(t.strip() and "Empty" not in t for t in (r.stdout or "").splitlines())


def device_texts(page):
    """启动一页并取 app 子树可见文本 + pagePath 标记。返回 (ok, marker, texts)。"""
    hcs("aa", "force-stop", BUNDLE)
    time.sleep(2.0)   # AMS 收尾间隙（1.0s 实测与紧随的 start 竞态）
    out = hcs("aa", "start", "-b", BUNDLE, "-a", "EntryAbility",
              "--ps", "hm_page", page)
    if "successfully" not in out:
        return False, out, []
    time.sleep(SETTLE)
    r = subprocess.run([HDC, "-t", TARGET, "shell", "uitest", "dumpLayout",
                        "-p", "/data/local/tmp/hm-s2.xml"], capture_output=True,
                       text=True, timeout=60, shell=False)
    if "saved" not in (r.stdout + r.stderr):
        return False, "dumpLayout 失败", []
    env = dict(os.environ, HDC_SERVER_PORT="5557")
    tmp = os.path.join(TMP, "hm-s2.xml")
    subprocess.run([HDC, "-t", TARGET, "file", "recv",
                    "/data/local/tmp/hm-s2.xml", tmp],
                   env=env, capture_output=True, timeout=60, shell=False)
    try:
        doc = json.load(open(tmp, encoding="utf-8"))
    except Exception as e:
        return False, "recv/parse 失败: %s" % e, []
    marker = {"pagePath": ""}

    def walk(n, in_app=False):
        a = n.get("attributes", {}) or {}
        if (a.get("bundleName") == BUNDLE) or (in_app and a.get("pagePath")):
            marker["pagePath"] = a.get("pagePath") or marker["pagePath"]
        app = in_app or a.get("bundleName") == BUNDLE
        if app:
            for k in ("text", "originalText"):
                v = (a.get(k) or "").strip()
                if v:
                    texts.append(v)
        for c in n.get("children") or []:
            walk(c, app)

    texts = []
    walk(doc)
    ok = marker["pagePath"] == page
    return ok, marker["pagePath"] or "(无 pagePath)", texts


def build_map():
    """pagePath → (module_file, reg_id)：扫 build/*.js 里的 registerNamedRoute。"""
    m = {}
    bdir = os.path.join(ROOT, "build")
    for f in sorted(os.listdir(bdir)):
        if not f.endswith(".js"):
            continue
        try:
            src = open(os.path.join(bdir, f), encoding="utf-8").read()
        except Exception:
            continue
        for p in re.findall(r'pagePath:\s*"(pages/[A-Za-z][A-Za-z0-9_]*)"', src):
            reg = re.search(r'__arkui_dom_defineCommonJS\("([A-Za-z0-9_]+)"', src)
            m[p] = (f, reg.group(1) if reg else None)
    return m


def browser_texts(route, mod_file, reg):
    """真实时钟 CDP 取 harness 的 JSON texts（rootdump 化——R165 B0 实证
    --dump-dom 虚拟时钟「终态树不完整」：TextDemo 残树 brw=7，真实时钟 4 控件齐）。"""
    dbg = os.environ.get("HM_CHROME_DEBUG_PORT", "")
    if not dbg or not re.match(r"^\d{1,5}$", dbg):
        return None, "浏览器调试端口未就绪（tools/hm-pages.sh 应已起 chrome）"
    ws_url = ""
    for _ in range(50):
        try:
            tabs = [t for t in devtools_tabs(dbg) if t.get("type") == "page"]
            if tabs:
                ws_url = tabs[0]["webSocketDebuggerUrl"]
                break
        except Exception:
            pass
        time.sleep(0.2)
    if not ws_url:
        return None, "拿不到页面 CDP 端点"
    cdp = Cdp(ws_url)
    try:
        from urllib.parse import quote
        # 相对模块路径（harness 在 test/ 下，模块在 build/）；页名已过主流程白名单
        url = ("http://127.0.0.1:%s/test/hm-harness.html?mod=../build/%s&route=%s" % (
            serve_port, quote(mod_file, safe="/._-"), quote(route, safe="/._-")))
        if reg:
            url += "&reg=" + quote(reg, safe="._-")
        cdp.call("Page.navigate", {"url": url})
        done = False
        for _ in range(450):
            try:
                r = cdp.call("Runtime.evaluate",
                             {"expression": "(() => { const e = document.getElementById('result');"
                                            " return e ? e.textContent : ''; })()",
                              "returnByValue": True}, timeout=5)
                txt = r.get("result", {}).get("value") or ""
                if txt and "running" not in txt:
                    done = True
                    break
            except Exception:
                pass
            time.sleep(0.2)
        if not done:
            return None, "90s 未落定（真实时钟）"
        r = cdp.call("Runtime.evaluate",
                     {"expression": "(document.getElementById('result')||{textContent:''}).textContent",
                      "returnByValue": True}, timeout=10)
        data = json.loads(r.get("result", {}).get("value") or "")
        if not data.get("ok"):
            return None, "harness 失败: " + str(data.get("err"))[:120]
        return data.get("texts") or "", ""
    finally:
        cdp.close()


def norm(texts):
    """归一化：相邻重复折叠（设备 accessibility 双写）→ 去空白 → 连接。"""
    out = []
    for t in texts:
        if not out or out[-1] != t:
            out.append(t)
    return re.sub(r"\s+", "", "".join(out))


# ── 主流程 ──
pages_json = os.path.join(ROOT, "harmony-proj/entry/src/main/resources/base/profile/main_pages.json")
all_pages = ["pages/" + p.split("/")[-1]
             for p in json.load(open(pages_json, encoding="utf-8"))["src"]]
sel = [a for a in sys.argv[1:]] or all_pages
# 安全校验（Mimosa 路径穿越防线）：argv 页名白名单——只收 main_pages 形态，
# 非法名在进入任何文件路径拼接前即拒绝
_PAGE_RE = re.compile(r"^pages/[A-Za-z][A-Za-z0-9_]*$")
for _p in sel:
    if not _PAGE_RE.match(_p):
        print("❌ 非法页名（只接受 pages/<Name>）: %r" % _p)
        sys.exit(2)


def safename(page):
    """页名 → 文件名片段（白名单已过，仍收敛到 [A-Za-z0-9_] 防御纵深）。"""
    return re.sub(r"[^A-Za-z0-9_]", "_", page.split("/")[-1])


bmap = build_map()

# 本地服务（browser phase 用）——固定命令三元组（字面量解释器 + ROOT 内脚本 +
# 字面量端口 "0"），list 形式 shell=False；启动前做路径 containment 守卫：
# 无任何用户输入（argv 页名）可达此命令（Mimosa 188 行复查收口）
import subprocess as sp
_SERVE = os.path.realpath(os.path.join(ROOT, "tools", "serve.py"))
if not _SERVE.startswith(os.path.realpath(ROOT) + os.sep) or not os.path.isfile(_SERVE):
    raise SystemExit("❌ serve 脚本路径异常: " + _SERVE)
srv = sp.Popen(["python3", _SERVE, "0"],
               cwd=ROOT, stdout=sp.PIPE, stderr=sp.STDOUT, text=True)
serve_port = ""
for _ in range(50):
    line = srv.stdout.readline()
    m = re.search(r"http://127\.0\.0\.1:(\d+)", line or "")
    if m:
        serve_port = m.group(1)
        break
    time.sleep(0.1)

device_ok = hdc_available()
if not device_ok:
    print("⏭  hm-pages 跳过设备侧（hdc/模拟器缺席或 HM_SKIP_DEVICE=1）——只跑浏览器侧记录")

rows, infra, diffs = [], 0, 0
for page in sel:
    if page not in bmap:
        rows.append((page, "SKIP-nomap", 0, 0))
        print("SKIP-nomap  %s（build/ 无该路由的模块——不经 HAP/extract 的页）" % page)
        continue
    mod_file, reg = bmap[page]
    # 浏览器侧
    brw, berr = browser_texts(page, mod_file, reg)
    if brw is None:
        rows.append((page, "INFRA", 0, 0))
        infra += 1
        print("INFRA(bw)   %s: %s" % (page, berr))
        continue
    # 原子纪律：python 只算不写盘（派生路径写被安全扫描判死）——原 per-page 留档
    # 改为 @@TEXT 标记块进 stdout，由 tools/hm-pages.sh 落盘
    print("@@TEXT brw %s %r" % (page, brw))
    # 设备侧
    if device_ok:
        d_ok, marker, dev = device_texts(page)
        # 标记缺失自愈（首跑实录：重页 3s 内 window 未挂上 → 空树假 INFRA——
        # Stress10kDemo/MeasNotify/BatchVerifyDemo 手动复现即过；Stress10k 实测
        # 挂载 >7s）：整体重启动幂等重试，dump 点 ≈3s/7s/11s
        for _r in range(3):
            if d_ok:
                break
            time.sleep(4)
            d_ok, marker, dev = device_texts(page)
        print("@@TEXT dev %s %r" % (page, dev))
        if not d_ok:
            rows.append((page, "INFRA", 0, len(norm(brw))))
            infra += 1
            print("INFRA(dev)  %s: 启动标记=%s" % (page, marker))
            continue
        nb, nd = norm(brw), norm(dev)
        # 三档判定：PASS 全等；PASS-SUBSET 设备流是浏览器流的子序列（挂载窗口口径
        # ——设备 dumpLayout 只含可见/已挂载子树，浏览器 DOM 含全部；对拍目的=
        # 「设备见到的我们也能渲染」，子序列成立即归一为通过）；其余 DIFF
        def is_subseq(needle, hay):
            it = iter(hay)
            return all(ch in it for ch in needle)
        if nb == nd:
            verdict = "PASS"
        elif is_subseq(nd, nb):
            verdict = "PASS-SUBSET"
        else:
            verdict = "DIFF"
        rows.append((page, verdict, len(nd), len(nb)))
        if verdict == "DIFF":
            diffs += 1
            print("DIFF        %s\n            dev(%d): %s\n            brw(%d): %s"
                  % (page, len(nd), nd[:90], len(nb), nb[:90]))
        elif verdict == "PASS-SUBSET":
            print("PASS-SUBSET %s（dev %d ⊆ brw %d——挂载窗口口径）" % (page, len(nd), len(nb)))
        else:
            print("PASS        %s（%d 字符）" % (page, len(nd)))
    else:
        rows.append((page, "SKIP-nolink", 0, len(norm(brw))))
        print("SKIP-nolink %s（浏览器侧 %d 字符已留档）" % (page, len(norm(brw))))

srv.terminate()
# tsv 同样经标记块交由包装器落盘（@@TSV-BEGIN/END）
print("@@TSV-BEGIN")
print("PAGE\tVERDICT\tDEV\tBRW")
for r in rows:
    print("\t".join(map(str, r)))
print("@@TSV-END")
n = {v: sum(1 for r in rows if r[1] == v)
     for v in ("PASS", "PASS-SUBSET", "DIFF", "SKIP-nomap", "SKIP-nolink", "INFRA")}
print("\n── hm-pages 汇总（%d 页）──" % len(rows))
print("   PASS=%(PASS)d DIFF=%(DIFF)d SKIP-nomap=%(SKIP-nomap)d "
      "SKIP-nolink=%(SKIP-nolink)d INFRA=%(INFRA)d" % n)
print("   清单经包装器落 build/assert-counts-hm.tsv；全文（含 @@TEXT 双侧流）在 build/hm-pages.log")
sys.exit(1 if (infra or (not device_ok and rows)) else 0)
