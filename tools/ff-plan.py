#!/usr/bin/env python3
"""解析 run.sh 的 all 分派块 → Firefox 矩阵用例计划（JSON 行打到 stdout，不写文件）。

单一事实来源：用例表就是 run.sh 的 all 块本身——run.sh 增删用例，Firefox 矩阵自动跟随，
不另维护一份会漂移的清单。浏览器端（Chrome）与 Firefox 端跑同一批 case 名。

保序；相邻且共享 (prof, port) 的用例聚为一组（同 origin 顺序复跑，复现 run.sh 的
"跨进程持久化必须同端口"语义——目前只有 netfile-1/netfile-2 一组）。

输出行: {"name":..., "page":..., "query":..., "group":<int>, "port":"<原样>"}
用法: python3 tools/ff-plan.py   （解析对象固定为本仓库 run.sh，路径常量、不接受外部输入）
"""
import json
import re
import shlex
import sys

RUN_SH = "/data/training/cli/arkui-dom-runtime/run.sh"


def main():
    with open(RUN_SH) as f:
        src = f.read()
    # all 分派块：从 "  all)" 到 "    exit $rc ;;"
    m = re.search(r"^  all\)\n(.*?)^    exit \$rc ;;", src, re.S | re.M)
    if not m:
        print("run.sh 里找不到 all 分派块", file=sys.stderr)
        sys.exit(1)
    block = m.group(1).replace("\\\n", " ")   # 反斜杠续行拼接

    cases = []
    group = 0
    prev_key = None
    for line in block.splitlines():
        line = line.strip()
        if not line.startswith("run_one "):
            continue
        toks = shlex.split(line)
        # run_one name src out page [extra] [query] [prof] [port] [|| rc=1 等 shell 尾巴]
        name, page = toks[1], toks[4]
        rest = [t for t in toks[5:] if t not in ("||", "rc=1", ";;")]
        # 位置参数语义（run_one 定义）：extra、query、prof、port
        query = rest[1] if len(rest) >= 2 and rest[1] else ""
        prof = rest[2] if len(rest) >= 3 and rest[2] else ""
        port = rest[3] if len(rest) >= 4 and rest[3] else ""
        key = (prof, port)
        if key == ("", ""):
            # 普通用例：独立 origin（run.sh 里每次 run_one 也是新 profile+新端口）
            cases.append({"name": name, "page": page, "query": query,
                          "group": 0, "port": ""})
        else:
            if key != prev_key:
                group += 1
                prev_key = key
            cases.append({"name": name, "page": page, "query": query,
                          "group": group, "port": port})

    for c in cases:
        print(json.dumps(c, ensure_ascii=False))
    print(f"# 共 {len(cases)} 用例，共享 origin 组 {group} 个", file=sys.stderr)


if __name__ == "__main__":
    main()
