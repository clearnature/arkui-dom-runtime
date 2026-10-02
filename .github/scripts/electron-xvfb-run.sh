#!/usr/bin/env bash
# Electron CI 编排脚本——在 xvfb 显示上下文内执行。
# 窗管用 metacity（GNOME 系：maximize/restore 几何还原语义与本地一致——
# openbox 的 restore 不还原宽度，CI 十六跑 windowdemo 实证）。
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

metacity >/dev/null 2>&1 &
sleep 1.5
exec bash "$DIR/../../electron/run.sh" all
