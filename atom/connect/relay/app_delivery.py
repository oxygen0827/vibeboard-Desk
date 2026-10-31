"""Account-scoped app installation requests. A device acknowledgement is success."""
import hashlib
import json


def handle(relay, client, method, path, body, require):
    account, cid, role = client['account'], client['id'], client['role']
    require(account, '请先在两端登录同一 ATOM 账号', 401)
    if path == '/v1/apps/install' and method == 'POST':
        require(role == 'computer' and body.get('confirm') is True, '请明确确认安装到小电脑', 403)
        target = relay.one("SELECT * FROM clients WHERE id=? AND role='device' AND account=?", (str(body.get('device_id')), account))
        require(target, '这台设备不属于当前账号', 404)
        key = str(body.get('request_id', ''))
        require(8 <= len(key) <= 100 and all(c.isalnum() or c in '-_' for c in key), '安装请求标识无效')
        ident = hashlib.sha256((cid + ':' + key).encode()).hexdigest()[:32]
        reference = {k: body[k] for k in ('draft_id', 'version_id') if k in body}
        require(len(reference) == 1, '请选择一个作品或草稿')
        digest = hashlib.sha256(json.dumps([target['id'], reference], sort_keys=True).encode()).hexdigest()
        old = relay.one('SELECT data FROM app_deliveries WHERE id=?', (ident,))
        if old:
            item = json.loads(old['data'])
            require(item['request_digest'] == digest, '安装请求已改变', 409)
            return {'delivery': item}
        with relay.marketplace.lock:
            user = relay.marketplace.row('SELECT * FROM users WHERE id=?', (account,))
            source = relay.marketplace.community.installation(user, reference)
            from marketplace.service import validate_bundle
            from app_input import validate_input_bundle
            source['bundle'] = validate_bundle(source['bundle'], official=source.get('official', False))
            validate_input_bundle(source['bundle'])
        require(relay.one("SELECT COUNT(*) n FROM app_deliveries WHERE device=? AND status='queued'", (target['id'],))['n'] < 20, '这台设备待安装任务过多', 409)
        item = dict(id=ident, name=source['bundle']['manifest']['name'], device_id=target['id'], device_name=target['name'],
                    status='queued', request_digest=digest, reference=reference, created_at=relay.clock(), account=account)
        relay.db.execute('INSERT INTO app_deliveries VALUES(?,?,?,?,?,?,?)', (ident, account, cid, target['id'], 'queued', json.dumps(item), json.dumps(source)))
        return {'delivery': item}
    if path == '/v1/apps/deliveries' and method == 'GET':
        require(role == 'computer', '仅电脑可以读取安装记录', 403)
        return {'deliveries': [json.loads(r['data']) for r in relay.rows('SELECT data FROM app_deliveries WHERE user=? AND computer=? ORDER BY rowid DESC LIMIT 100', (account, cid))]}
    if path == '/v1/apps/pending' and method == 'GET':
        require(role == 'device', '仅设备可以领取安装', 403)
        row = relay.one("SELECT * FROM app_deliveries WHERE user=? AND device=? AND status='queued' ORDER BY rowid LIMIT 1", (account, cid))
        return {'delivery': dict(json.loads(row['data']), source=json.loads(row['bundle'])) if row else None}
    if path == '/v1/apps/ack' and method == 'POST':
        require(role == 'device' and body.get('status') in ('installed', 'failed'), '设备回执无效', 403)
        row = relay.one('SELECT * FROM app_deliveries WHERE id=? AND user=? AND device=?', (str(body.get('id')), account, cid))
        require(row, '安装请求不存在', 404)
        item = json.loads(row['data'])
        if row['status'] != 'queued':
            return {'delivery': item}
        item.update(status=body['status'], error=str(body.get('error', ''))[:300], finished_at=relay.clock())
        relay.db.execute('UPDATE app_deliveries SET status=?,data=?,bundle=? WHERE id=?', (item['status'], json.dumps(item), '{}', row['id']))
        relay.db.execute("DELETE FROM app_deliveries WHERE device=? AND status!='queued' AND id NOT IN (SELECT id FROM app_deliveries WHERE device=? ORDER BY rowid DESC LIMIT 100)", (cid, cid))
        return {'delivery': item}
    require(False, '安装接口不存在', 404)
