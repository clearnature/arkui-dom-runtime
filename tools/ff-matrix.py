#!/usr/bin/env python3
"""Firefox(Gecko) 全矩阵执行器：geckodriver + W3C WebDriver（经典 HTTP）。

为什么是 geckodriver 而不是 BiDi：Fx 156 的 BiDi 未实现 script.*（evaluate/callFunction
均 unsupported），而页面判定通道是 document.title / #result 文本——经典 WebDriver 的
element text 读取恰好覆盖，且纯 HTTP 无协议猜测。geckodriver 本体由 firefox/run.sh
负责定位、生命周期与端口保障（固定 9555），本脚本只做环回 HTTP 客户端
（http.client，host/port 全常量，无 URL 字符串拼接）。

逐用例：起内嵌静态服务（importlib 复用仓库 tools/serve.py 的全部测试端点，随机端口=
新 origin，对齐 run.sh 每用例新端口语义；就绪探针=环回 TCP 连接）→ navigate →
轮询 document.title（页面自设 'PASS'/'FAIL'）→ 读 #result 文本计 PASS 行。
部分页不设 title（如 focusdemo），title 超时后回退按 #result 文本判定——与
run.sh 的 grep 'ALL PASS' 同约定。

安全自限：所有请求目标 host 均为常量 "127.0.0.1"；文件路径全常量；geckodriver 不由
本脚本启动。
输出：CASE\\t<name>\\t<verdict>\\t<passcount>\\t<耗时s>（TSV 由 firefox/run.sh 从本
stdout 再加工）；非 PASS 与 FF_DEBUG_DUMP=1 时附 #result 摘要；末行 SUMMARY。
用法: python3 tools/ff-matrix.py [用例名子串过滤]（计划固定读 build/ff-plan.jsonl）
"""
import http.client
import importlib.util
import io
import json
import os
import re
import socket
import sys
import threading
import time

import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVE_PY = os.path.join(ROOT, "tools", "serve.py")
PLAN_JSONL = os.path.join(ROOT, "build", "ff-plan.jsonl")
GD_HOST, GD_PORT = "127.0.0.1", 9555   # firefox/run.sh 保证该端口空闲且由它启动 geckodriver
POLL0, POLL, CASE_TIMEOUT = 1.5, 0.4, 25
ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf"

sys.stdout = io.StringIO()   # 吞掉 serve.py 模块级回显；本脚本输出只走 os.write(1,...)


# R174 全补②：启动期载入族瞬态签名（与 run.sh 吸收层同款）——脚本载入 miss 被
# 页面驱动 catch 写成 FAIL 行，原判定见 FAIL 即收 → 只此签名进一次性重跑；
# 确定性真 bug 第二次照红不掩盖。
LOAD_FAMILY = re.compile(r"抛出异常.*(is not defined|未注册的模块|SyntaxError|Unexpected token|Cannot read)")


def out(s):
    os.write(1, (s + "\n").encode())


def http_req(port, method, path, body=None):
    """对本机环回常量 host 发一个 HTTP 请求（host 恒为 127.0.0.1，不拼 URL 字符串）。"""
    conn = http.client.HTTPConnection(GD_HOST, port, timeout=60)
    try:
        conn.request(method, path,
                     json.dumps(body) if body is not None else None,
                     {"Content-Type": "application/json"} if body is not None else {})
        r = conn.getresponse()
        raw = r.read()
        v = json.loads(raw) if raw else None
    finally:
        conn.close()
    if isinstance(v, dict) and v.get("error"):
        raise RuntimeError(f"{method} {path} -> {json.dumps(v['error'], ensure_ascii=False)[:200]}")
    return v


def free_port():
    s = socket.socket()
    s.bind((GD_HOST, 0))
    p = s.getsockname()[1]
    s.close()
    return p


def tcp_ready(port):
    """环回端口可连接即视为就绪（serve.py bind 后才 accept）。"""
    try:
        with socket.create_connection((GD_HOST, port), timeout=1):
            return True
    except OSError:
        return False


def start_server(want_port):
    """在同进程起一份 tools/serve.py（守护线程；独立模块实例=独立 flaky 计数，
    对齐 run.sh 每用例新服务语义）。want_port=0 时自选空闲端口。返回端口号。"""
    if not want_port:
        want_port = free_port()
    sys.argv = ["serve.py", str(want_port)]
    spec = importlib.util.spec_from_file_location("arksrv_ff_" + str(want_port), SERVE_PY)
    mod = importlib.util.module_from_spec(spec)
    threading.Thread(target=spec.loader.exec_module, args=(mod,), daemon=True).start()
    for _ in range(60):
        if tcp_ready(want_port):
            return want_port
        time.sleep(0.2)
    raise RuntimeError("serve.py 未就绪（环回端口无响应）")


def run_case(driver, sid, c):
    """跑单个用例，返回 (verdict, npass, text, 耗时s)。

    判定通道 = #result 文本逐拍轮询（页面终态时写入 '=== ALL PASS ===' 或失败头，
    与 run.sh grep 'ALL PASS' 同约定）。
    教训（R145 实测）：首版 title 快通道早退会带走上一拍的陈旧 #result 快照
    （'running…' 非空 → 终读被跳过 → 计 0 条，5 个快页同日中招）——title 只反映
    "完成与否"，#result 才有计数，两个通道混用天然有竞态，干脆只留 #result。
    """
    page_path = "/test/" + c["page"].split("test/", 1)[-1]
    url = "http://127.0.0.1:" + str(c["_port"]) + page_path + c["query"]
    t0 = time.time()
    verdict, text = None, ""
    # R174 全补②：载入族 FAIL 进一次性重跑（吸收层——run.sh 同款签名）
    for attempt in (1, 2):
        driver("POST", f"/session/{sid}/url", {"url": url})
        time.sleep(POLL0)
        verdict, text, deadline = None, "", time.time() + CASE_TIMEOUT
        while time.time() < deadline:
            try:
                el = driver("POST", f"/session/{sid}/element",
                            {"using": "css selector", "value": "#result"})["value"]
                text = driver("GET", f"/session/{sid}/element/{el[ELEMENT_KEY]}/text")["value"]
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
        if verdict == "FAIL" and attempt == 1 and LOAD_FAMILY.search(text):
            out("  ⚠ 启动期载入族瞬态——重跑一次（瞬态吸收层）")
            continue
        break
    npass = sum(1 for ln in text.splitlines() if ln.startswith("PASS "))
    return verdict, npass, text, time.time() - t0


def main():
    os.chdir(ROOT)   # serve.py 以 cwd 为服务根，必须在仓库根运行
    flt = sys.argv[1] if len(sys.argv) > 1 else None
    with open(PLAN_JSONL, encoding="utf-8") as f:
        plan = [json.loads(l) for l in f if l.startswith("{")]
    if flt:
        plan = [c for c in plan if flt in c["name"]]

    def driver(method, path, body=None):
        return http_req(GD_PORT, method, path, body)

    sid = None
    stats = {"PASS": 0, "FAIL": 0, "TIMEOUT": 0, "ERROR": 0}
    try:
        v = driver("POST", "/session", {"capabilities": {"alwaysMatch": {
            "browserName": "firefox",
            "moz:firefoxOptions": {"args": ["-headless"]}}}})
        sid = v["value"]["sessionId"]

        cur_group, port = None, None
        for c in plan:
            try:
                if c["group"] != cur_group:
                    cur_group = c["group"]
                    port = start_server(0)   # 共享组固定端口语义由 ff-plan 聚组、此处逐组起新服务
                c["_port"] = port
                verdict, npass, text, dt = run_case(driver, sid, c)
                stats[verdict] += 1
                out(f"CASE\t{c['name']}\t{verdict}\t{npass}\t{dt:.1f}")
                if verdict != "PASS" or os.environ.get("FF_DEBUG_DUMP"):
                    out(f"---- {c['name']} #result 摘要 ----")
                    for ln in text.splitlines()[:14]:
                        out("  " + ln)
            except Exception as e:
                stats["ERROR"] += 1
                out(f"CASE\t{c['name']}\tERROR\t0\t0.0")
                out(f"  ERR {type(e).__name__}: {e}")
        out(f"SUMMARY\tPASS={stats['PASS']}\tFAIL={stats['FAIL']}\t"
            f"TIMEOUT={stats['TIMEOUT']}\tERROR={stats['ERROR']}\tTOTAL={len(plan)}")
    finally:
        if sid:
            try:
                http_req(GD_PORT, "DELETE", "/session/" + sid)
            except Exception:
                pass


if __name__ == "__main__":
    main()
