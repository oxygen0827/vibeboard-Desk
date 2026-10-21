"""ATOM system releases for devices: the signed manifest and the package, public and read-only.

publish_release.sh puts latest.json and <version>.tar.gz into the `system` folder next to the relay
database. Devices verify the Ed25519 signature themselves; this service only serves the files.
"""
import base64
import json
import re
from pathlib import Path

from .service import MarketError

VERSION = re.compile(r'^[0-9A-Za-z.\-]{1,40}$')


class Releases:
    def __init__(self, folder):
        self.folder = Path(folder)

    def handle(self, method, path):
        if method != 'GET':
            raise MarketError(405, 'Method not allowed', 'method')
        if path == '/market/v1/system/latest':
            try:
                return json.loads((self.folder / 'latest.json').read_text(encoding='utf-8'))
            except (OSError, ValueError):
                return {}
        version = path.rsplit('/', 1)[-1]
        if path.startswith('/market/v1/system/package/') and VERSION.match(version):
            try:
                return {'version': version, 'data': base64.b64encode((self.folder / (version + '.tar.gz')).read_bytes()).decode()}
            except OSError:
                pass
        raise MarketError(404, 'Release not found', 'not_found')
