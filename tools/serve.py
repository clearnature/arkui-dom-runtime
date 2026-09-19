#!/usr/bin/env python3
"""极简静态服务器：为测试页与产物提供正确 MIME 的 HTTP 服务。

为什么要它：Chrome 对 file:// 下的脚本有额外限制，且 ES module 需要正确 MIME。
用法: python3 tools/serve.py [port]  （在工程根目录运行）
"""
import http.server
import json
import os
import socketserver
import sys
import time

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 0   # 0 = 由 OS 分配空闲端口
ROOT = os.getcwd()


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.html': 'text/html; charset=utf-8',
        '.json': 'application/json',
    }

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass  # 静默，避免污染断言输出

    def _send(self, code, body: bytes, ctype: str = 'text/plain; charset=utf-8'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # /slow：故意慢响应，用于验证 readTimeout（确定性、不依赖外网）
        # 注意必须配 ThreadingTCPServer：单线程 TCPServer 会被这个 sleep 阻塞整个服务
        if self.path == '/slow':
            time.sleep(1.5)
            self._send(200, b'slow-done')
            return
        super().do_GET()

    def do_POST(self):
        # /echo：回显 method / body / content-type，用于验证 POST 与自定义 header
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n).decode('utf-8', 'replace')
        payload = json.dumps({
            'method': 'POST',
            'path': self.path,
            'body': body,
            'contentType': self.headers.get('Content-Type'),
            'xProbe': self.headers.get('X-Probe'),
        }).encode('utf-8')
        self._send(200, payload, 'application/json')


class Server(socketserver.ThreadingTCPServer):
    # 必须多线程：/slow 这类端点会 sleep，单线程会把整个服务阻塞住
    allow_reuse_address = True
    daemon_threads = True


with Server(('127.0.0.1', PORT), Handler) as httpd:
    host, port = httpd.server_address[0], httpd.server_address[1]
    print(f'serving {ROOT} at http://{host}:{port}/', flush=True)
    httpd.serve_forever()