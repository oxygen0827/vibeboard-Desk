#!/usr/bin/env python3
"""Verify a reviewed bundle against its published, downloadable cloud version."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import quote, urlsplit
from urllib.request import urlopen

DEFAULT_MARKET = 'https://ldcx.tech/atom/market/v1'
MAX_RESPONSE = 4 * 1024 * 1024


def canonical(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')


def fetch_json(url):
    with urlopen(url, timeout=30) as response:
        data = response.read(MAX_RESPONSE + 1)
    if len(data) > MAX_RESPONSE:
        raise ValueError('Market response exceeds 4 MiB')
    return json.loads(data)


def verify(bundle, work_id, market=DEFAULT_MARKET, fetch=fetch_json):
    market = market.rstrip('/')
    parsed = urlsplit(market)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Use an HTTPS marketplace URL without credentials or query parameters')
    works = fetch(market + '/catalog')['works']
    work = next((item for item in works if item['id'] == work_id), None)
    if not work:
        raise ValueError('Work is not published in the cloud catalog')
    version_id = work['latest_version_id']
    source = fetch(market + '/versions/' + quote(version_id, safe=''))
    version = source['version']
    if version['id'] != version_id or version['work_id'] != work_id:
        raise ValueError('Downloaded version does not belong to the selected work')
    digest = hashlib.sha256(canonical(source['bundle'])).hexdigest()
    if digest != version['sha256']:
        raise ValueError('Downloaded source digest does not match the published version')
    if source['bundle'] != bundle:
        raise ValueError('Published source differs from the reviewed local bundle; publish a new version first')
    cover_id = work.get('cover_id')
    if not cover_id:
        raise ValueError('Published work has no home-screen cover')
    cover = fetch(market + '/covers/' + quote(cover_id, safe=''))
    if not isinstance(cover.get('image'), str) or not cover['image'].startswith('data:image/'):
        raise ValueError('Published home-screen cover is unavailable')
    return dict(app_id=bundle['manifest']['id'], work_id=work_id, version_id=version_id,
                sha256=digest, cover_id=cover_id, cloud_verified=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    parser.add_argument('--work-id', help='Defaults to official-<app ID>; specify for community works')
    parser.add_argument('--market', default=DEFAULT_MARKET)
    args = parser.parse_args()
    try:
        bundle = json.loads(args.bundle.read_text(encoding='utf-8'))
        result = verify(bundle, args.work_id or 'official-' + bundle['manifest']['id'], args.market)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, 'Release verification failed: {}\n'.format(error))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
