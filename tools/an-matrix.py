#!/usr/bin/env python3
"""Android(System WebView) 第五端矩阵执行器：原始 CDP WebSocket（playwright 的
connect_over_cdp 不支持 WebView——它不是完整 Chrome，浏览器级 context 管理缺失）。

链路：模拟器内 WebView Shell → adb reverse tcp:41790（设备 localhost 直通宿主
serve.py；10.0.2.2 的 NAT 路由实测 ERR_EMPTY_RESPONSE 不可靠）→ 本机 CDP over
adb forward tcp:9222（由 android/run.sh 完成）。

三个实测坑固化在此（R149）：
① Page.navigate 的应答在 WebView 跨进程导航时永远不来（旧 DevTools 会话失效）——
  导航 fire-and-forget：发送后立即关闭 ws，不等应答；
② 轮询/求值每次用【新】ws 连接（旧连接可能挂在失效会话上）；
③ 判定 = #result 文本逐拍轮询（坑 115 纪律：单通道）。
安全自限：全部主机/端口常量；本脚本零 subprocess（adb 侧全在 android/run.sh）。
输出：CASE\\t<name>\\t<verdict>\\t<passcount>\\t<耗时s>；末行 SUMMARY。
用法: python3 tools/an-matrix.py [用例名子串过滤]（计划固定读 build/ff-plan.jsonl）
"""
import http.client
import json
import os
import sys
import time

ROOT = "/data/training/cli/arkui-dom-runtime"
PLAN_JSONL = "/data/training/cli/arkui-dom-runtime/build/ff-plan.jsonl"
FWD_PORT = 9222
PAGE_WS_TIMEOUT = 15
POLL0, POLL, CASE_TIMEOUT = 4.0, 0.8, 30
ELEMENT_PROBE = "document.getElementById('result') ? document.getElementById('result').innerText : 'NO-RESULT'"


def out(s):
    os.write(1, (s + "\n").encode())


def page_ws():
    """新开一条到当前 page target 的 CDP ws（每次调用都是新连接）。"""
    conn = http.client.HTTPConnection("127.0.0.1", FWD_PORT, timeout=10)
    conn.request("GET", "/json")
    targets = json.loads(conn.getresponse().read())
    page = next(t for t in targets if t.get("type") == "page")
    import websocket
    return websocket.create_connection(
        page["webSocketDebuggerUrl"], timeout=PAGE_WS_TIMEOUT,
        suppress_origin=True)


def evaluate(expr, tries=3):
    """Runtime.evaluate，ws 挂掉自动换新连接重试。"""
    last = None
    for _ in range(tries):
        ws = None
        try:
            ws = page_ws()
            ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
                                "params": {"expression": expr,
                                           "returnByValue": True}}))
            deadline = time.time() + PAGE_WS_TIMEOUT
            while time.time() < deadline:
                m = json.loads(ws.recv())
                if m.get("id") == 1:
                    if "error" in m:
                        raise RuntimeError(json.dumps(m["error"])[:160])
                    return m.get("result", {}).get("result", {}).get("value", "")
        except Exception as e:
            last = e
        finally:
            if ws:
                try:
                    ws.close()
                except Exception:
                    pass
        time.sleep(0.4)
    raise last if last else RuntimeError("evaluate 未知失败")


def navigate(url):
    """fire-and-forget 导航（坑①：WebView 导航后旧会话失效，应答永不到来）。"""
    ws = page_ws()
    ws.send(json.dumps({"id": 1, "method": "Page.navigate",
                        "params": {"url": url}}))
    try:
        ws.close()
    except Exception:
        pass


def run_case(c):
    url = "http://127.0.0.1:41790/" + c["page"].lstrip("/") + c["query"]
    t0 = time.time()
    navigate(url)
    time.sleep(POLL0)
    verdict, text, deadline = None, "", time.time() + CASE_TIMEOUT
    renavigated = False
    while time.time() < deadline:
        try:
            text = evaluate(ELEMENT_PROBE)
            if "=== ALL PASS" in text:
                verdict = "PASS"
                break
            if "FAILURES" in text or "=== HAS FAILURE" in text:
                verdict = "FAIL"
                break
            # 坑：adb reverse 隧道偶发空响应 → WebView 落 chrome-error 页（NO-RESULT）。
            # 每用例允许一次重新导航恢复（实测偶发，重试即好）。
            if not renavigated and (text == "NO-RESULT" or "could not be loaded" in text):
                renavigated = True
                time.sleep(1)
                navigate(url)
                time.sleep(POLL0)
                continue
        except Exception:
            pass
        time.sleep(POLL)
    if verdict is None:
        verdict = "TIMEOUT"
    npass = sum(1 for ln in text.splitlines() if ln.startswith("PASS "))
    return verdict, npass, text, time.time() - t0


def main():
    os.chdir(ROOT)
    flt = sys.argv[1] if len(sys.argv) > 1 else None
    with open(PLAN_JSONL) as f:
        plan = [json.loads(l) for l in f if l.startswith("{")]
    if flt:
        plan = [c for c in plan if flt in c["name"]]

    stats = {"PASS": 0, "FAIL": 0, "TIMEOUT": 0, "ERROR": 0}
    for c in plan:
        try:
            verdict, npass, text, dt = run_case(c)
            stats[verdict] += 1
            out(f"CASE\t{c['name']}\t{verdict}\t{npass}\t{dt:.1f}")
            if verdict != "PASS" or os.environ.get("AN_DEBUG_DUMP"):
                out(f"---- {c['name']} #result 摘要 ----")
                for ln in text.splitlines()[:14]:
                    out("  " + ln)
        except Exception as e:
            stats["ERROR"] += 1
            out(f"CASE\t{c['name']}\tERROR\t0\t0.0")
            out(f"  ERR {type(e).__name__}: {e}")
    out(f"SUMMARY\tPASS={stats['PASS']}\tFAIL={stats['FAIL']}\t"
        f"TIMEOUT={stats['TIMEOUT']}\tERROR={stats['ERROR']}\tTOTAL={len(plan)}")


if __name__ == "__main__":
    main()
