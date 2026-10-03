#!/usr/bin/env python3
"""WebKit(WPE/GTK) 全矩阵执行器：playwright python API。

为什么是 playwright 而不是WebDriver：WebKit 没有独立可执行的 WebDriver 端点
（MiniBrowser 路线要自带 GTK 应用壳），playwright 自带的 WebKitKitBuild 是唯一
免编译通路。判定通道 = #result 文本逐拍轮询（坑 115 教训：只用单一通道，杜绝
title 快照与计数的竞态）；与 run.sh grep 'ALL PASS' 同约定。

逐用例：起内嵌静态服务（importlib 复用仓库 tools/serve.py 的全部测试端点，随机
端口=新 origin，对齐 run.sh 每用例新端口语义）→ goto → 轮询 #result → 计 PASS 行。
安全自限：所有文件路径均为常量；服务仅绑本机环回。
输出：CASE\\t<name>\\t<verdict>\\t<passcount>\\t<耗时s>（TSV 由 webkit/run.sh 再加工）；
非 PASS 与 WK_DEBUG_DUMP=1 时附 #result 摘要；末行 SUMMARY。
用法: <有 playwright 的 python> tools/wk-matrix.py [用例名子串过滤]
（计划固定读 build/ff-plan.jsonl——与 Firefox 矩阵同一份单一事实来源）
"""
import importlib.util
import io
import json
import os
import socket
import sys
import threading
import time

import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVE_PY = os.path.join(ROOT, "tools", "serve.py")
PLAN_JSONL = os.path.join(ROOT, "build", "ff-plan.jsonl")
POLL0, POLL, CASE_TIMEOUT = 1.5, 0.4, 25

sys.stdout = io.StringIO()   # 吞掉 serve.py 模块级回显；本脚本输出只走 os.write(1,...)


def out(s):
    os.write(1, (s + "\n").encode())


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def tcp_ready(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except OSError:
        return False


def start_server(want_port):
    """同进程起一份 tools/serve.py（守护线程；独立模块实例=独立 flaky 计数）。
    want_port=0 时自选空闲端口。返回端口号。"""
    if not want_port:
        want_port = free_port()
    sys.argv = ["serve.py", str(want_port)]
    spec = importlib.util.spec_from_file_location("arksrv_wk_" + str(want_port), SERVE_PY)
    mod = importlib.util.module_from_spec(spec)
    threading.Thread(target=spec.loader.exec_module, args=(mod,), daemon=True).start()
    for _ in range(60):
        if tcp_ready(want_port):
            return want_port
        time.sleep(0.2)
    raise RuntimeError("serve.py 未就绪（环回端口无响应）")


def main():
    os.chdir(ROOT)   # serve.py 以 cwd 为服务根，必须在仓库根运行
    flt = sys.argv[1] if len(sys.argv) > 1 else None
    with open(PLAN_JSONL, encoding="utf-8") as f:
        plan = [json.loads(l) for l in f if l.startswith("{")]
    if flt:
        plan = [c for c in plan if flt in c["name"]]

    from playwright.sync_api import sync_playwright
    stats = {"PASS": 0, "FAIL": 0, "TIMEOUT": 0, "ERROR": 0}
    with sync_playwright() as p:
        browser = p.webkit.launch(headless=True)
        page = browser.new_page(viewport={"width": 620, "height": 1100})
        cur_group, port = None, None
        for c in plan:
            try:
                if c["group"] != cur_group:
                    cur_group = c["group"]
                    port = start_server(0)
                url = "http://127.0.0.1:" + str(port) + "/" + c["page"].lstrip("/") + c["query"]
                t0 = time.time()
                page.goto(url, wait_until="load", timeout=30000)
                time.sleep(POLL0)
                verdict, text, deadline = None, "", time.time() + CASE_TIMEOUT
                while time.time() < deadline:
                    try:
                        text = page.locator("#result").inner_text(timeout=2000)
                        if "=== ALL PASS" in text:
                            verdict = "PASS"
                            break
                        if "FAILURES" in text or "=== HAS FAILURE" in text:
                            verdict = "FAIL"
                            break
                    except Exception:
                        pass
                    time.sleep(POLL)
                if verdict is None:
                    verdict = "TIMEOUT"
                npass = sum(1 for ln in text.splitlines() if ln.startswith("PASS "))
                stats[verdict] += 1
                out(f"CASE\t{c['name']}\t{verdict}\t{npass}\t{time.time()-t0:.1f}")
                if verdict != "PASS" or os.environ.get("WK_DEBUG_DUMP"):
                    out(f"---- {c['name']} #result 摘要 ----")
                    for ln in text.splitlines()[:14]:
                        out("  " + ln)
            except Exception as e:
                stats["ERROR"] += 1
                out(f"CASE\t{c['name']}\tERROR\t0\t0.0")
                out(f"  ERR {type(e).__name__}: {e}")
        browser.close()
    out(f"SUMMARY\tPASS={stats['PASS']}\tFAIL={stats['FAIL']}\t"
        f"TIMEOUT={stats['TIMEOUT']}\tERROR={stats['ERROR']}\tTOTAL={len(plan)}")


if __name__ == "__main__":
    main()
