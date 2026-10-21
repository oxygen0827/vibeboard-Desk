#!/usr/bin/env python3
"""Run the ATOM device on this computer.

Installs every application in the repository into a private simulator folder,
serves them with the real device backend (atom/server.py) and opens a 480x360
device window. Simulator state never touches atom/state or atom/apps.

    python3 atom/tools/simulator.py            # sync apps, start, open window
    python3 atom/tools/simulator.py --no-open  # just serve http://127.0.0.1:8790/simulator

The ATOM Connect Mac app ships a prebuilt copy (--build-seed) and starts it with --seed.
On first start the simulator registers itself with the same relay as ATOM Connect,
so market login, notes/agenda sync and computer pairing work like on a real device.
"""
import argparse, filecmp, json, os, shutil, subprocess, sys, threading, time, webbrowser
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ATOM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ATOM))
import server  # noqa: E402  the real device backend

PAGE = Path(__file__).with_name('simulator.html')
CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
# Install order decides desktop order (the device sorts by install time).
SOURCES = ['official/*/bundle.json', 'experiences/*/bundle.json', 'ports/*/bundle.json', 'examples/*.json', 'apps/*.json']
CLIENT_DIRS = ['computer-app', 'market-app', 'notes-app', 'robot-app']
SKIP = {'bundle.json', '.DS_Store', '__pycache__'}


def copy_assets(source, target):
    """Ported engines ship only an entry in bundle.json; the rest of the folder is runtime assets."""
    for item in source.iterdir():
        if item.name in SKIP or item.name in ('manifest.json', 'index.html', 'icon.svg') or item.suffix in ('.cjs', '.py'):
            continue
        dest = target / item.name
        if item.is_dir():
            shutil.copytree(item, dest, dirs_exist_ok=True, ignore=shutil.ignore_patterns(*SKIP))
        elif not dest.exists() or dest.stat().st_mtime < item.stat().st_mtime:
            shutil.copy2(item, dest)


def seed(apps_root, seed_root):
    """Install or refresh prebuilt apps; app data lives in the shell, not in these folders."""
    apps_root.mkdir(parents=True, exist_ok=True)
    count = 0
    try:
        order = json.loads((seed_root / 'order.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        order = sorted(p.name for p in seed_root.iterdir())
    for name in order:
        source = seed_root / name
        if not source.is_dir() or not server.ID.fullmatch(source.name):
            continue
        target = apps_root / source.name
        fresh = not (target / 'manifest.json').is_file()
        if fresh or not filecmp.cmp(source / 'manifest.json', target / 'manifest.json', shallow=False) \
                or not filecmp.cmp(source / 'index.html', target / 'index.html', shallow=False):
            shutil.copytree(source, target, dirs_exist_ok=True)
            if fresh:  # keep the seed order on first install; updates keep their desktop position
                os.utime(target / 'manifest.json')
                time.sleep(0.002)
        count += 1
    return count


def default_relay():
    state = Path.home() / 'Library/Application Support/ATOMConnect/state.json'
    try:
        return json.loads(state.read_text(encoding='utf-8'))['config']['relay_url']
    except (OSError, ValueError, KeyError, TypeError):
        return 'https://ldcx.tech/atom'


def connect(httpd, relay, name):
    """Register the simulator as its own device once; later starts reuse the saved identity."""
    try:
        bridge = server.features(httpd).connect
        if bridge.config.get('token'):
            return
        bridge.configure({'relay_url': relay, 'name': name})
        print('Registered with ' + relay + ' as "' + name + '"', flush=True)
    except Exception as exc:
        print('Relay not connected (' + str(exc) + '); connect later in Settings', flush=True)


def sync(apps_root):
    apps_root.mkdir(parents=True, exist_ok=True)
    seen, failed = [], []
    for pattern in SOURCES:
        for path in sorted(ATOM.glob(pattern)):
            try:
                bundle = json.loads(path.read_text(encoding='utf-8'))
                app_id = bundle['manifest']['id']
                if app_id in seen:
                    continue
                exists = (apps_root / app_id).is_dir()
                server.install_app(apps_root, bundle, update=exists, trusted_connect=app_id in server.TRUSTED_CLIENT_IDS)
                if path.name == 'bundle.json':
                    copy_assets(path.parent, apps_root / app_id)
                seen.append(app_id)
            except Exception as exc:  # report and keep going; one bad bundle must not hide the rest
                failed.append((str(path.relative_to(ATOM)), str(exc)))
    for name in CLIENT_DIRS:
        folder = ATOM / name
        manifest = folder / 'manifest.json'
        if not manifest.is_file():
            continue
        app_id = json.loads(manifest.read_text(encoding='utf-8'))['id']
        target = apps_root / app_id
        target.mkdir(exist_ok=True)
        copy_assets(folder, target)
        for fixed in ('manifest.json', 'index.html', 'icon.svg'):
            if (folder / fixed).is_file():
                shutil.copy2(folder / fixed, target / fixed)
        if app_id not in seen:
            seen.append(app_id)
    return seen, failed


class SimulatorHandler(server.Handler):
    def do_GET(self):
        if urlsplit(self.path).path in ('/simulator', '/simulator/'):
            body = PAGE.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


def open_window(url, home):
    if CHROME.exists():
        # A dedicated profile keeps the simulator's storage apart from the user's browser.
        subprocess.Popen([str(CHROME), '--app=' + url, '--user-data-dir=' + str(home / 'chrome'),
                          '--window-size=760,600', '--autoplay-policy=no-user-gesture-required',
                          '--no-first-run', '--no-default-browser-check'],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        webbrowser.open(url)


def main():
    parser = argparse.ArgumentParser(description='Run ATOM apps on this computer')
    parser.add_argument('--port', type=int, default=8790)
    parser.add_argument('--home', default=str(Path.home() / '.atom-simulator'))
    parser.add_argument('--no-sync', action='store_true', help='keep the installed apps as they are')
    parser.add_argument('--no-open', action='store_true', help='do not open a window')
    parser.add_argument('--seed', help='install prebuilt apps from this folder instead of the repository')
    parser.add_argument('--build-seed', metavar='DIR', help='write prebuilt apps to DIR and exit')
    parser.add_argument('--relay', help='relay to register with (default: the one ATOM Connect uses)')
    parser.add_argument('--name', default='Mac 模拟器', help='device name shown when pairing')
    parser.add_argument('--offline', action='store_true', help='do not register with a relay')
    args = parser.parse_args()
    if args.build_seed:
        target = Path(args.build_seed).absolute()
        if target.exists():
            shutil.rmtree(target)
        installed, failed = sync(target)
        (target / 'order.json').write_text(json.dumps(installed), encoding='utf-8')
        print('Built %d apps into %s' % (len(installed), target), flush=True)
        for path, error in failed:
            print('  skipped %s: %s' % (path, error), flush=True)
        return
    home = Path(args.home).expanduser().absolute()
    apps_root = home / 'apps'
    if args.seed:
        print('Installed %d apps from %s' % (seed(apps_root, Path(args.seed)), args.seed), flush=True)
    elif not args.no_sync:
        started = time.time()
        installed, failed = sync(apps_root)
        print('Installed %d apps into %s (%.1fs)' % (len(installed), apps_root, time.time() - started), flush=True)
        for path, error in failed:
            print('  skipped %s: %s' % (path, error), flush=True)
    ThreadingHTTPServer.request_queue_size = 128
    httpd = ThreadingHTTPServer(('127.0.0.1', args.port), SimulatorHandler)
    httpd.apps_root = apps_root
    httpd.is_simulator = True
    httpd.settings_path = home / 'state' / 'settings.json'
    httpd.settings_path.parent.mkdir(parents=True, exist_ok=True)
    url = 'http://127.0.0.1:%d/simulator' % args.port
    if not args.offline:
        threading.Thread(target=connect, args=(httpd, args.relay or default_relay(), args.name), daemon=True).start()
    print('ATOM simulator running at ' + url + '  (Ctrl+C to stop)', flush=True)
    if not args.no_open:
        open_window(url, home)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
