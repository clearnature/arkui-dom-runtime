#!/usr/bin/env python3
"""浏览器腿 Tracing 采集（R164 对拍）——与 electron ARKUI_TRACE 同口径：

同一测试页 × 同一 Tracing 类别 × 互斥时间分析（tools/trace-report.mjs），
产出 build/<页>.chrome-trace.json（@@TRACE 标记块 → tools/chrome-trace.sh
包装器落盘），用于 Electron ↔ Chrome 双端 bucket 对拍（验证 style/layout/
parse 结论不是 Electron 特有）。

分工：Chrome 的启动/终止由 bash 包装器负责（本进程只连已起的调试端口）——
serve.py 本进程起（固定命令三元组 + realpath containment 守卫）。真实时钟
（与 electron 侧一致；对比看 bucket 相对构成，不比绝对墙钟）。

用法（经包装器）：bash tools/chrome-trace.sh [页名 ...]（默认 stress10k attrheavy）
直连（调试用，需自备 chrome --remote-debugging-port）：
    python3 tools/chrome-trace.py <dbg_port> [页名 ...]

安全口径：subprocess 参数列表（shell 默认 False）且命令元素全固定；HTTP 走
http.client + 字面量 host "127.0.0.1"（ff-matrix 先例，禁 urlopen/动态 URL）；
用户输入（页名）只进本地 URL 白名单路径段与标记块，不进命令、不进文件路径。
"""
import http.client
import json
import os
import re
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATEGORIES = ["devtools.timeline", "blink", "disabled-by-default-devtools.timeline"]
PAGE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
PORT_RE = re.compile(r"^\d{1,5}$")


class Cdp:
    """极简同步 CDP 客户端（ws 文本帧 + id 关联；事件经字典表捕获）。"""

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
    """取页面目标清单：http.client + 字面量 host（禁动态 URL——Mimosa SSRF 纪律）。"""
    conn = http.client.HTTPConnection("127.0.0.1", int(dbg_port), timeout=2)
    try:
        conn.request("GET", "/json/list")
        resp = conn.getresponse()
        return json.loads(resp.read())
    finally:
        conn.close()


def main():
    if len(sys.argv) < 2 or not PORT_RE.match(sys.argv[1]):
        print("用法: chrome-trace.py <dbg_port> [trace|rootdump] [页名 ...]"
              "（通常经 tools/chrome-trace.sh / layout-audit.sh）")
        sys.exit(2)
    dbg_port = sys.argv[1]
    mode = "trace"
    rest = sys.argv[2:]
    if rest and rest[0] in ("trace", "rootdump"):
        mode = rest[0]
        rest = rest[1:]
    pages = rest or ["stress10k", "attrheavy"]
    for pg in pages:
        if not PAGE_RE.match(pg):
            print("❌ 非法页名: %r" % pg)
            sys.exit(2)

    # 本地服务：固定命令三元组（字面量解释器 + ROOT 内脚本 + 字面量端口），
    # realpath containment 守卫（与 hm-pages 同纪律）
    serve_path = os.path.realpath(os.path.join(ROOT, "tools", "serve.py"))
    if not serve_path.startswith(os.path.realpath(ROOT) + os.sep) \
            or not os.path.isfile(serve_path):
        raise SystemExit("❌ serve 脚本路径异常: " + serve_path)
    srv = subprocess.Popen(["python3", serve_path, "0"],
                           cwd=ROOT, stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, text=True, shell=False)
    port = ""
    for _ in range(50):
        line = srv.stdout.readline()
        m = re.search(r"http://127\.0\.0\.1:(\d+)", line or "")
        if m:
            port = m.group(1)
            break
        time.sleep(0.1)
    if not port:
        print("❌ serve 未启动")
        srv.terminate()
        sys.exit(1)

    ws_url = ""
    for _ in range(50):
        try:
            tabs = [t for t in devtools_tabs(dbg_port) if t.get("type") == "page"]
            if tabs:
                ws_url = tabs[0]["webSocketDebuggerUrl"]
                break
        except Exception:
            pass
        time.sleep(0.2)
    if not ws_url:
        print("❌ 拿不到页面 CDP 端点（chrome 起了吗）")
        srv.terminate()
        sys.exit(1)

    if mode == "rootdump":
        # B0 专用：真实时钟渲完一页 → 取 #root 的【JSON 树】打 stdout（诊断行
        # 走 stderr）——不走 --dump-dom 虚拟时钟（终态树不完整假象实测 3/3），
        # 也不走 outerHTML（void 元素子树被序列化丢弃，挂错父不可见）
        pg = pages[0]
        cdp = Cdp(ws_url)
        cdp.call("Page.navigate",
                 {"url": "http://127.0.0.1:%s/test/%s.html" % (port, pg)})
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
        # 额外 0.5s 等断言后可能的重挂载/微任务收尾
        time.sleep(0.5)
        # JSON 树序列化（**不用 outerHTML**：HTML 序列化对 void 元素（input 等）
        # 丢弃子树——textdemo 的挂错父实锤靠 id 查询才现形，outerHTML 永远看不到）
        r = cdp.call("Runtime.evaluate", {
            "expression": "(function(){function conv(n){var o={tag:(n.tagName||'').toLowerCase(),attrs:{},kids:[]};"
                          "if(n.attributes){for(var i=0;i<n.attributes.length;i++){o.attrs[n.attributes[i].name]=n.attributes[i].value;}}"
                          "var c=n.firstChild;while(c){if(c.nodeType===1){o.kids.push(conv(c));}c=c.nextSibling;}return o;}"
                          "var r=document.getElementById('root');return r?JSON.stringify(conv(r)):''})()",
            "returnByValue": True}, timeout=10)
        sys.stdout.write(r.get("result", {}).get("value") or "")
        sys.stdout.write("\n")
        print("[rootdump %s] #result %s" % (pg, "落定" if done else "90s 超时（仍输出）"),
              file=sys.stderr)
        cdp.close()
        srv.terminate()
        return

    results = []
    for pg in pages:
        cdp = Cdp(ws_url)
        cdp.events.clear()
        cdp.call("Tracing.start", {"traceConfig": {"includedCategories": CATEGORIES}})
        # URL 路径段=白名单页名（PAGE_RE 已过）
        cdp.call("Page.navigate",
                 {"url": "http://127.0.0.1:%s/test/%s.html" % (port, pg)})
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
        print("[%s] #result %s" % (pg, "落定" if done else "90s 超时（仍采集）"))
        cdp.call("Tracing.end", timeout=5)
        t0 = time.time()
        while time.time() - t0 < 8 and not cdp.events.get("Tracing.tracingComplete"):
            try:
                cdp.ws.settimeout(1)
                msg = json.loads(cdp.ws.recv())
                if "method" in msg:
                    cdp.events.setdefault(msg["method"], []).append(msg.get("params") or {})
            except Exception:
                pass
        evs = []
        for chunk in cdp.events.get("Tracing.dataCollected", []):
            evs.extend(chunk.get("value") or {})
        results.append((pg, evs))
        print("[%s] 事件 %d" % (pg, len(evs)))
        cdp.close()

    srv.terminate()
    # 只算不写：@@TRACE 标记块交包装器落盘（bash 按白名单标记名建文件）
    for pg, evs in results:
        print("@@TRACE_BEGIN " + pg)
        print(json.dumps({"traceEvents": evs}, separators=(",", ":")))
        print("@@TRACE_END " + pg)


if __name__ == "__main__":
    main()
