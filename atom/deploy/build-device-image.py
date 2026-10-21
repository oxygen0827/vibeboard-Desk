#!/usr/bin/env python3
"""Build a fresh ATOM application tree, with public sources and no device identity.

The destination must not exist. This never copies state, browser profiles, model
credentials, or a developer's installed apps. It does not flash Debian/drivers.
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server

PORTS = ['water-pool', 'volume-flow', 'moon-ocean', 'planetarium', 'robo-face',
         'pocket-studio', 'music-vision', 'rhythm-orbits', 'physics-playground',
         'model-viewer', 'math-playground', 'clay-studio', 'parametric-maker',
         'circuit-lab', 'material-world']
NEW_PORTS = ['photon-chip', 'photon-runner', 'finger-fireworks', 'mini-piano']


def build(destination):
    destination = destination.resolve()
    destination.mkdir()  # refuse to merge into an existing device tree
    for source in ROOT.glob('*.py'):
        shutil.copy2(str(source), str(destination / source.name))
    for name in ('static', 'deploy', 'templates'):
        shutil.copytree(str(ROOT / name), str(destination / name),
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.DS_Store'))
    apps = destination / 'apps'
    order = []

    def install(bundle, source=None):
        aid = bundle['manifest']['id']
        server.install_app(apps, bundle, trusted_connect=aid in server.TRUSTED_CLIENT_IDS)
        # The entry-only port bundles are NOT the whole application.
        if source:
            for item in source.iterdir():
                if item.name in ('manifest.json', 'bundle.json', '__pycache__', '.DS_Store'):
                    continue
                target = apps / aid / item.name
                if item.is_dir():
                    shutil.copytree(str(item), str(target), dirs_exist_ok=True,
                                    ignore=shutil.ignore_patterns('__pycache__', '.DS_Store'))
                else:
                    shutil.copy2(str(item), str(target))
        order.append(aid)

    for name in ('computer-app', 'market-app', 'notes-app', 'robot-app'):
        source = ROOT / name
        manifest = json.loads((source / 'manifest.json').read_text())
        files = {p.name: p.read_text() for p in source.iterdir()
                 if p.is_file() and p.name != 'manifest.json' and p.suffix in ('.html', '.js', '.css', '.svg')}
        install(dict(manifest=manifest, files=files), source)
    catalog = json.loads((ROOT / 'official/catalog.json').read_text())
    for source in sorted((ROOT / 'official').glob('*/bundle.json')) + [ROOT / 'official' / p for p in catalog['extra_sources']]:
        bundle = json.loads(source.read_text())
        if bundle['manifest']['id'] not in catalog['retired'] + NEW_PORTS:
            install(bundle, source.parent)
    for aid in PORTS:
        source = ROOT / 'ports' / aid
        install(json.loads((source / 'bundle.json').read_text()), source)
    for aid in ('particle-lab', 'local-music'):
        install(json.loads((ROOT / 'apps' / (aid + '.json')).read_text()))
    install(json.loads((ROOT / 'examples/mic-test.json').read_text()))
    # New apps are appended after the current curated applications.
    for aid in NEW_PORTS:
        source = ROOT / 'official' / aid
        install(json.loads((source / 'bundle.json').read_text()), source)
    (destination / 'image-manifest.json').write_text(json.dumps(dict(
        format=1, applications=order, credentials=False,
        note='Fresh application image; configure identity and graphics per device.'), ensure_ascii=False, indent=2) + '\n')
    print('Built %s with %d applications' % (destination, len(order)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    build(parser.parse_args().destination)
