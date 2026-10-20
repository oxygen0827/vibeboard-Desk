#!/usr/bin/env python3
"""Deploy an ATOM Web bundle through a localhost SSH tunnel (Python 3.7+)."""
import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit


def request(base, path, data=None):
    body = None if data is None else json.dumps(data, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(base + path, data=body, headers={
        'Origin': base, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        try:
            reason = json.loads(exc.read().decode('utf-8')).get('error', 'request rejected')
        except (ValueError, UnicodeError):
            reason = 'request rejected'
        raise ValueError('HTTP {}: {}'.format(exc.code, reason))
    except urllib.error.URLError:
        raise ValueError('无法连接 ATOM；请检查服务或 SSH 隧道。')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', default='http://127.0.0.1:8770')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('list')
    for name in ('install', 'update'):
        commands.add_parser(name).add_argument('bundle')
    commands.add_parser('uninstall').add_argument('id')
    args = parser.parse_args()
    try:
        parsed = urlsplit(args.target)
        if (parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost')
                or parsed.username or parsed.password or parsed.path not in ('', '/')
                or parsed.query or parsed.fragment or parsed.port != 8770):
            raise ValueError('target 必须为 http://127.0.0.1:8770 或 http://localhost:8770；使用同端口 SSH 隧道。')
        base = args.target.rstrip('/')
        if args.command == 'list':
            result = request(base, '/api/apps')
        else:
            if args.command in ('install', 'update') and not request(base, '/api/developer').get('enabled'):
                raise ValueError('开发模式已关闭。请在设备设置中手动开启；CLI 不会自动开启。')
            if args.command == 'uninstall':
                data = {'id': args.id}
            else:
                data = json.loads(Path(args.bundle).read_text(encoding='utf-8'))
                if not isinstance(data, dict):
                    raise ValueError('bundle 必须为 JSON 对象。')
            if args.command in ('install', 'update') and data.get('manifest', {}).get('id') in {'my-computer', 'market', 'quick-notes', 'today', 'task-pal', 'app-library'}:
                result = request(base, '/api/connect/client-update', {'bundle': data, 'update': args.command == 'update'})
            else:
                result = request(base, '/api/apps/' + args.command, data)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, OSError, UnicodeError) as exc:
        print('错误：{}'.format(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
