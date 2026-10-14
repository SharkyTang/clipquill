#!/usr/bin/env python3
"""Isolated UI preview. Serves the real extension files with test-only API shims.
Never connects to Chrome, Douyin, Native Messaging, or the transcription service.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse

ROOT = Path(__file__).resolve().parents[2]
EXTENSION = ROOT / 'outputs/douyin-independent-extension'
FIXTURE = Path(__file__).resolve().parent

class Preview(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path in ('/', '/tool.html'):
            body = (EXTENSION / 'tool.html').read_text().replace('<script src="theme-init.js">', '<script src="fixture.js"></script><script src="theme-init.js">')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Security-Policy', "script-src 'self'; object-src 'none'; connect-src 'self'")
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body.encode())
            return
        if path in ('/fixture.js', '/fixture.css'):
            target = FIXTURE / path.lstrip('/')
        else:
            target = (EXTENSION / path.lstrip('/')).resolve()
            if not target.is_relative_to(EXTENSION):
                self.send_error(403)
                return
        if not target.is_file():
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', self.guess_type(str(target)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(target.read_bytes())

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=4176)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Preview)
    print(f'Isolated UI fixture: http://127.0.0.1:{args.port}/tool.html', flush=True)
    server.serve_forever()
