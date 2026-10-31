#!/usr/bin/env python3
"""Read-only release gate: cloud works/library, bundled seed, and installed resources.

Never installs, overwrites forks, publishes drafts, or treats offline as success.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
from urllib.parse import urlsplit
from verify_market_release import fetch_json, verify

ROOT = Path(__file__).resolve().parents[1]
DOC_SUFFIXES = {'.md', '.txt'}


def inventory(root):
    result = {}
    for folder in sorted(Path(root).iterdir()):
        manifest = folder / 'manifest.json'
        if not folder.is_dir() or not manifest.is_file():
            continue
        value = json.loads(manifest.read_text())
        value.pop('_installed_at_ns', None)
        files = {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in folder.rglob('*') if p.is_file() and not p.is_symlink()
                 and p.name not in ('manifest.json', 'ATOM-SOURCE.json')}
        result[folder.name] = {'manifest': value, 'files': files}
    return result


def compare(expected, actual, installed=False):
    rows = []
    for aid, source in sorted(expected.items()):
        target = actual.get(aid)
        if target is None:
            rows.append({'id': aid, 'state': 'not_installed' if installed else 'missing'})
            continue
        manifest = dict(target['manifest'])
        manifest.pop('_installed_at_ns', None)
        different = [name for name, digest in source['files'].items()
                     if target['files'].get(name) != digest]
        # A valid user icon is preserved by the installer. Report it separately.
        icon = source['manifest'].get('icon', 'icon.svg')
        runtime = [n for n in different if n != icon and Path(n).suffix not in DOC_SUFFIXES
                   and Path(n).name not in ('LICENSE', 'SOURCE', 'NOTICE', 'COPYING')]
        rows.append({'id': aid, 'state': 'different' if runtime or manifest != source['manifest'] else 'current',
                     'runtime_files': runtime, 'manifest_differs': manifest != source['manifest'],
                     'other_files': [n for n in different if n not in runtime]})
    return rows


def cloud_official(market):
    config = json.loads((ROOT / 'official/catalog.json').read_text())
    paths = list((ROOT / 'official').glob('*/bundle.json'))
    paths += [(ROOT / 'official' / name).resolve() for name in config.get('extra_sources', [])]
    cache = {}
    def fetch(url):
        if url not in cache:
            cache[url] = fetch_json(url)
        return cache[url]
    rows = []
    for path in sorted(set(paths)):
        bundle = json.loads(path.read_text())
        aid = bundle['manifest']['id']
        if aid in config.get('retired', []):
            continue
        try:
            rows.append(verify(bundle, 'official-' + aid, market, fetch))
        except (ValueError, KeyError, OSError) as exc:
            rows.append({'app_id': aid, 'cloud_verified': False, 'error': str(exc)})
    return rows


def compare_library(expected, actual):
    rows = {a['id']: a for a in actual}
    return [{'id': a['id'], 'verified': all(rows.get(a['id'], {}).get(k) == a[k]
                                           for k in ('sha256', 'archive')),
             'sha256': a['sha256']} for a in expected]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--market', default='https://ldcx.tech/atom/market/v1')
    parser.add_argument('--seed', type=Path, required=True, help='Fresh strict seed build')
    parser.add_argument('--mac-seed', type=Path)
    parser.add_argument('--installed', type=Path, help='Local simulator apps directory')
    parser.add_argument('--device-inventory', type=Path, help='Read-only remote inventory JSON; same schema as --inventory')
    parser.add_argument('--library', type=Path, help='Fresh build_full_library catalog.json')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--require-all', action='store_true', help='Fail unless library, Mac seed, simulator and device evidence are supplied')
    parser.add_argument('--inventory', action='store_true', help='Only print a local inventory of --seed; no network')
    args = parser.parse_args()
    if args.require_all and not all([args.library, args.mac_seed, args.installed, args.device_inventory]):
        parser.error('--require-all needs --library, --mac-seed, --installed and --device-inventory')
    expected = inventory(args.seed)
    if args.inventory:
        print(json.dumps(expected, ensure_ascii=False))
        return
    url = urlsplit(args.market)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment:
        parser.error('Use an HTTPS marketplace without credentials or query parameters')
    result = {'official': cloud_official(args.market.rstrip('/'))}
    ok = all(r['cloud_verified'] for r in result['official'])
    for label, source, installed in [('mac_seed', args.mac_seed, False), ('simulator', args.installed, True),
                                      ('device', args.device_inventory, True)]:
        if source is None:
            continue
        actual = json.loads(source.read_text()) if label == 'device' else inventory(source)
        result[label] = compare(expected, actual, installed)
        ok = ok and all(r['state'] in ('current', 'not_installed') for r in result[label])
    if args.library:
        library = json.loads(args.library.read_text())['apps']
        actual = fetch_json(args.market.rstrip('/') + '/catalog').get('library', [])
        result['library'] = compare_library(library, actual)
        index = json.loads((ROOT / 'official/library-index.json').read_text())['apps']
        result['repository_library'] = compare_library(library, index)
        ok = ok and all(r['verified'] for r in result['library'])
        ok = ok and all(r['verified'] for r in result['repository_library'])
    result['ok'] = ok
    result['scope'] = 'Only supplied channels; not_installed does not authorize installation. UI/hardware need separate acceptance.'
    data = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        args.output.write_text(data)
    print(json.dumps({'ok': ok, 'official': len(result['official']), 'channels': list(result)}, ensure_ascii=False))
    if not ok:
        sys.exit(1)


if __name__ == '__main__':
    main()
