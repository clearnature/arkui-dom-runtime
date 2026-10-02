#!/usr/bin/env bash
# Electron CI 编排脚本——作为 GabrielBB/xvfb-action 的【单一客户端命令】在
# xvfb 显示上下文内执行（该 action 的 run 输入按空格拆给 xvfb-run 当 client，
# 复合命令的 &/&& 会落在显示上下文之外——十跑实证）。
# 顺序：先起 openbox 窗管（无窗管 fullscreen 语义缺失，九跑实证），再跑全矩阵。
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

openbox >/dev/null 2>&1 &
sleep 1.5
exec bash "$DIR/../../electron/run.sh" all
