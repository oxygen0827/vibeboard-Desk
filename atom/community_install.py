"""Local receiver for explicit same-account installs from ATOM Connect."""
import json
import threading
import time


class CommunityInstaller:
    def __init__(self, service, validate, install):
        self.service, self.validate, self.install = service, validate, install
        self.lock = threading.Lock()
        self.next_poll = 0

    def apply(self, source, account, receipt=''):
        bundle = source.get('bundle')
        trusted = source.get('official') is True and isinstance(bundle, dict) and bundle.get('manifest', {}).get('id') in ('today', 'task-pal')
        bundle = self.validate(bundle, trusted_connect=trusted, maximum=2*1024*1024)
        aid = bundle['manifest']['id']
        origin = 'draft:' + account + ':' + source['draft']['id'] if source.get('draft') else 'work:' + source['version']['work_id']
        folder = self.service.apps_root / aid
        updating = folder.exists()
        record = folder / 'ATOM-SOURCE.json'
        if updating:
            if record.is_symlink() or not record.is_file():
                raise ValueError('桌面已有同名标识的其他应用，未覆盖。请先检查来源。')
            old = json.loads(record.read_text())
            previous = old.get('community_origin') or ('work:' + old.get('version', {}).get('work_id', ''))
            if previous != origin and previous not in source.get('install_aliases', []):
                raise ValueError('已有应用来自其他作品，不能覆盖。')
            if receipt and old.get('community_receipt') == receipt:
                return {'status': 'installed', 'app': {'id': aid, 'name': bundle['manifest']['name']}}
            self.service.releases.capture(self.service.apps_root, aid)
        bundle['files']['ATOM-SOURCE.json'] = json.dumps(dict(community_origin=origin, community_receipt=receipt,
            **{k:source.get(k) for k in ('version', 'license', 'author', 'parent_id', 'parent_version_id', 'official')}), ensure_ascii=False)
        app = self.install(self.service.apps_root, bundle, update=updating, trusted_connect=trusted)
        return {'status': 'installed', 'app': app}

    def local(self, reference):
        if reference.get('confirm') is not True:
            raise ValueError('请明确确认安装')
        with self.lock, self.service.market.lock:
            market = self.service.market
            if reference.get('expected_user_id') and reference['expected_user_id'] != market.current().get('user', {}).get('id'):
                raise ValueError('账号已切换，请重新打开创作')
            source = market.request('community/installation', reference, True)
            account = market.current().get('user', {}).get('id', '')
            return self.apply(source, account)

    def poll(self):
        if time.monotonic() < self.next_poll or not self.lock.acquire(blocking=False):
            return
        self.next_poll = time.monotonic() + 10
        try:
            threading.Thread(target=self.receive, daemon=True).start()
        except RuntimeError:
            self.lock.release()

    def receive(self):
        try:
            market, bridge = self.service.market, self.service.connect
            with market.lock:
                account = market.current().get('user', {}).get('id')
                if not account or not bridge.config.get('token'):
                    return
                item = bridge._request('/v1/apps/pending').get('delivery')
                if not item or item.get('account') != account:
                    return
                try:
                    self.apply(item['source'], account, item['id'])
                    result = dict(id=item['id'], status='installed')
                except (ValueError, OSError, KeyError, TypeError):
                    result = dict(id=item['id'], status='failed', error='安装检查未通过，原应用保留；请在小电脑应用市场检查来源或重试。')
                bridge._request('/v1/apps/ack', result)
        except (ValueError, OSError):
            pass  # No acknowledgement means still queued, never falsely installed.
        finally:
            self.lock.release()
