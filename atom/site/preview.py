#!/usr/bin/env python3
"""Local preview matching production's /atom/ base path; no backend proxy."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
ROOT = Path(__file__).resolve().parent
class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        from urllib.parse import urlsplit, unquote
        clean = unquote(urlsplit(path).path)
        if clean == '/atom': clean = '/atom/'
        if not clean.startswith('/atom/'): return str(ROOT / '__404__')
        relative = clean[len('/atom/'):]
        target = (ROOT / relative).resolve()
        if ROOT not in target.parents and target != ROOT: return str(ROOT / '__404__')
        return str(target)
if __name__ == '__main__':
    p = argparse.ArgumentParser();p.add_argument('--port',type=int,default=18943);args=p.parse_args()
    ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
