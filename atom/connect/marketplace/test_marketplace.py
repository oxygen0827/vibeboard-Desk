import copy
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest

spec=importlib.util.spec_from_file_location('market_under_test',Path(__file__).with_name('service.py'))
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
ICON='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M8 8H56V56H8Z" stroke="currentColor" fill="none"/></svg>'

def bundle(aid='my-sample'):
    return {'manifest':{'id':aid,'name':'Sample','entry':'index.html','icon':'icon.svg','theme_ui':'controls'},'files':{'index.html':'<!doctype html><html><body><button>Hello</button></body></html>','icon.svg':ICON,'logic.js':'console.log("Hello");','LICENSE':'Original MIT copyright'}}

class MarketplaceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.now=[1000]
        self.path=str(Path(self.tmp.name)/'market.sqlite3')
        self.seeds=Path(self.tmp.name)/'seeds'
        self.market=m.Marketplace(self.path,clock=lambda:self.now[0],seeds=self.seeds)
        self.a=self.call('/register',{'username':'alice','password':'long-test-password-a'})
        self.b=self.call('/register',{'username':'bobby','password':'long-test-password-b'})

    def tearDown(self):
        self.market.close()
        self.tmp.cleanup()

    def call(self,path,body=None,who=None):
        return self.market.handle('GET' if body is None else 'POST','/market/v1'+path,(who or {}).get('token',''),body)

    def denied(self,code,fn):
        with self.assertRaises(m.MarketError) as caught:fn()
        self.assertEqual(caught.exception.status,code)
        return caught.exception

    def draft(self,who=None,source=None):
        return self.call('/drafts',dict(title='My app',description='Private unpublished description',category='life',license='MIT',bundle=source or bundle()),who or self.a)['draft']

    def publish(self,draft,who=None):
        return self.call('/drafts/'+draft['id']+'/publish',dict(revision=draft['revision'],confirm=True,changelog='Initial snapshot'),who or self.a)

    def test_account_password_hash_session_logout_expiry(self):
        user=self.market.row('SELECT * FROM users WHERE username=?',('alice',))
        self.assertNotEqual(user['password_hash'],'long-test-password-a')
        self.assertNotIn(self.a['token'],str([tuple(r) for r in self.market.rows('SELECT * FROM sessions')]))
        logged=self.call('/login',dict(username='ALICE',password='long-test-password-a'))
        self.assertEqual(logged['user'],self.a['user'])
        self.denied(401,lambda:self.call('/login',dict(username='alice',password='incorrect-password')))
        self.call('/logout',{},logged)
        self.denied(401,lambda:self.call('/me',who=logged))
        self.now[0]+=31*86400
        self.denied(401,lambda:self.call('/me',who=self.a))
        self.assertEqual(os.stat(self.path).st_mode&0o777,0o600)

    def test_private_drafts_cross_account_and_source(self):
        draft=self.draft()
        self.assertEqual(self.call('/drafts',who=self.b)['drafts'],[])
        self.denied(404,lambda:self.call('/drafts/'+draft['id'],who=self.b))
        self.denied(404,lambda:self.call('/drafts/'+draft['id']+'/save',dict(revision=1,bundle=bundle()),self.b))
        self.denied(404,lambda:self.publish(draft,self.b))
        self.assertEqual(self.call('/catalog')['works'],[])
        self.denied(404,lambda:self.call('/versions/'+draft['id']))
        self.denied(401,lambda:self.call('/drafts'))

    def test_revision_conflict_and_immutable_published_versions(self):
        draft=self.draft()
        first=self.publish(draft)
        version=self.call('/versions/'+first['version']['id'])
        original=copy.deepcopy(version['bundle'])
        self.assertEqual(version['version']['sha256'],hashlib.sha256(m.packed(original).encode()).hexdigest())
        current=self.call('/drafts/'+draft['id'],who=self.a)['draft']
        changed=bundle();changed['files']['index.html']='<html>Modified source</html>'
        error=self.denied(409,lambda:self.call('/drafts/'+draft['id']+'/save',dict(revision=1,bundle=changed),self.a))
        self.assertEqual(error.extra['current']['revision'],current['revision'])
        saved=self.call('/drafts/'+draft['id']+'/save',dict(revision=current['revision'],bundle=changed),self.a)['draft']
        second=self.publish(saved)
        self.assertEqual(second['version']['number'],2)
        self.assertEqual(second['work']['id'],first['work']['id'])
        self.assertEqual(self.call('/versions/'+first['version']['id'])['bundle'],original)
        self.assertEqual(self.call('/versions/'+second['version']['id'])['bundle'],changed)

    def test_fork_provenance_and_new_app_identity(self):
        first=self.publish(self.draft())
        fork=self.call('/forks',dict(version_id=first['version']['id'],title='Bobby fork'),self.b)['draft']
        fsource=self.call('/drafts/'+fork['id'],who=self.b)['bundle']
        self.assertNotEqual(fsource['manifest']['id'],'my-sample')
        self.assertEqual(fsource['files']['logic.js'],bundle()['files']['logic.js'])
        self.assertEqual(fork['parent_version_id'],first['version']['id'])
        self.assertEqual(fork['license'],'MIT')
        second=self.publish(fork,self.b)
        self.assertEqual(second['work']['parent_id'],first['work']['id'])
        self.assertEqual(second['work']['attribution'],'alice')
        detail=self.call('/works/'+first['work']['id'])
        self.assertEqual(detail['derivatives'][0]['id'],second['work']['id'])
        changed=copy.deepcopy(fsource);changed['manifest']['id']='another-id'
        current=self.call('/drafts/'+fork['id'],who=self.b)['draft']
        self.denied(400,lambda:self.call('/drafts/'+fork['id']+'/save',dict(revision=current['revision'],bundle=changed),self.b))

    def test_publish_explicit_confirm_secret_scan_and_nonexecution(self):
        draft=self.draft()
        self.denied(400,lambda:self.call('/drafts/'+draft['id']+'/publish',dict(revision=1,changelog='No confirmation'),self.a))
        changed=bundle();changed['files']['logic.js']='const api_key="sk-abcdefghijklmnopqrstuv012345";'
        saved=self.call('/drafts/'+draft['id']+'/save',dict(revision=1,bundle=changed),self.a)['draft']
        error=self.denied(400,lambda:self.publish(saved))
        self.assertEqual(error.code,'publish_secret_detected')
        self.assertEqual(self.call('/catalog')['works'],[])
        self.assertIn('sk-',self.call('/drafts/'+draft['id'],who=self.a)['bundle']['files']['logic.js'])

    def test_bundle_paths_active_svg_limits_and_reserved_ids(self):
        for name in ('../evil','/absolute','http://example.com/a','safe/../evil','.hidden','a\\b','manifest.json'):
            bad=bundle();bad['files'][name]='bad'
            self.denied(400,lambda:self.draft(source=bad))
        for aid in ('my-computer','market','quick-notes','app-library','../path','A-bad'):
            self.denied(400,lambda:self.draft(source=bundle(aid)))
        bad=bundle();bad['files']['icon.svg']=ICON.replace('<path','<script')
        self.denied(400,lambda:self.draft(source=bad))
        bad=bundle();bad['files']['icon.svg']=ICON.replace('currentColor','#ff0000')
        self.denied(400,lambda:self.draft(source=bad))
        bad=bundle();bad['files']['big.txt']='x'*(1024*1024)
        self.denied(400,lambda:self.draft(source=bad))

    def test_notes_isolation_conflict_delete_restore(self):
        note=self.call('/notes',dict(id='offline-local-1',revision=0,text='First note',pinned=True),self.a)['note']
        self.assertEqual(self.call('/notes',who=self.b)['notes'],[])
        self.denied(404,lambda:self.call('/notes',dict(id=note['id'],revision=1,text='Steal'),self.b))
        error=self.denied(409,lambda:self.call('/notes',dict(id=note['id'],revision=0,text='Old offline'),self.a))
        self.assertEqual(error.extra['current']['text'],'First note')
        deleted=self.call('/notes',dict(id=note['id'],revision=1,text='First note',deleted=True),self.a)['note']
        self.assertTrue(deleted['deleted'])
        restored=self.call('/notes',dict(id=note['id'],revision=deleted['revision'],text='Restored',deleted=False),self.a)['note']
        self.assertEqual(restored['revision'],3)
        self.assertFalse(restored['deleted'])
        self.denied(400,lambda:self.call('/notes',dict(text='x'*4001),self.a))

    def test_agenda_revision_and_validation(self):
        item=self.call('/agenda',dict(id='offline-task-1',title='Prepare demo',kind='event',starts_at='2026-10-20T10:00:00+08:00'),self.a)['item']
        self.assertEqual(self.call('/agenda',who=self.b)['items'],[])
        self.denied(404,lambda:self.call('/agenda',dict(id=item['id'],revision=1,title='Unauthorized'),self.b))
        error=self.denied(409,lambda:self.call('/agenda',dict(id=item['id'],revision=0,title='Stale'),self.a))
        self.assertEqual(error.extra['current']['title'],'Prepare demo')
        self.denied(400,lambda:self.call('/agenda',dict(title='Bad date',kind='event',starts_at='not-a-date'),self.a))
        done=self.call('/agenda',dict(id=item['id'],revision=1,title='Prepare demo',kind='event',starts_at=item['starts_at'],done=True,deleted=True),self.a)['item']
        self.assertTrue(done['done'] and done['deleted'])

    def test_official_seed_immutable_hash_and_restart(self):
        source=self.seeds/'official-companion'
        source.mkdir(parents=True)
        (source/'bundle.json').write_text(json.dumps(bundle('official-companion')))
        self.market.import_official()
        first=self.call('/catalog')['works'][0]
        self.assertTrue(first['official'])
        self.market.import_official()
        self.assertEqual(len(self.call('/works/'+first['id'])['versions']),1)
        self.market.close()
        self.market=m.Marketplace(self.path,clock=lambda:self.now[0],seeds=self.seeds)
        self.assertEqual(self.call('/me',who=self.a)['user']['username'],'alice')
        self.assertEqual(self.call('/versions/'+first['latest_version_id'])['bundle']['files']['logic.js'],bundle()['files']['logic.js'])

    def test_fork_license_files_cannot_be_removed(self):
        first=self.publish(self.draft())
        fork=self.call('/forks',dict(version_id=first['version']['id']),self.b)['draft']
        content=self.call('/drafts/'+fork['id'],who=self.b)['bundle']
        content['files'].pop('LICENSE')
        self.denied(400,lambda:self.call('/drafts/'+fork['id']+'/save',dict(revision=fork['revision'],bundle=content),self.b))
        content=self.call('/drafts/'+fork['id'],who=self.b)['bundle']
        content['files']['LICENSE']='Changed copyright'
        self.denied(400,lambda:self.call('/drafts/'+fork['id']+'/save',dict(revision=fork['revision'],bundle=content),self.b))

    def test_official_privileged_ids_cannot_be_forged(self):
        self.denied(400,lambda:self.draft(source=bundle('task-pal')))
        self.seeds.mkdir()
        (self.seeds/'task-pal.json').write_text(json.dumps(bundle('task-pal')))
        self.market.import_official()
        work=self.call('/catalog')['works'][0]
        source=self.call('/versions/'+work['latest_version_id'])
        self.assertTrue(source['official'])
        fork=self.call('/forks',dict(version_id=source['version']['id']),self.a)['draft']
        public=self.publish(fork)
        self.assertFalse(self.call('/versions/'+public['version']['id'])['official'])
        self.assertTrue(self.call('/drafts/'+fork['id'],who=self.a)['bundle']['manifest']['id'].startswith('fork-'))

    def test_http_mount_before_client_auth_body_origin_and_safe_errors(self):
        rs=importlib.util.spec_from_file_location('market_relay_http_test',Path(__file__).parents[1]/'relay'/'server.py')
        r=importlib.util.module_from_spec(rs);rs.loader.exec_module(r)
        relay=r.Relay(str(Path(self.tmp.name)/'http-relay.db'))
        server=r.ThreadingHTTPServer(('127.0.0.1',0),r.Handler);server.relay=relay
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        def request(method,path,data=None,headers=None):
            conn=http.client.HTTPConnection(*server.server_address,timeout=5)
            payload=json.dumps(data) if data is not None else None
            h={'Content-Type':'application/json'};h.update(headers or {})
            conn.request(method,path,payload,h);response=conn.getresponse()
            result=(response.status,json.loads(response.read()));conn.close();return result
        try:
            self.assertEqual(request('GET','/market/v1/health'),(200,{'ok':True}))
            self.assertEqual(request('GET','/market/v1/me')[0],401)
            self.assertEqual(request('POST','/market/v1/register',{'username':'httpuser','password':'strong-test-password'}, {'Origin':'https://attacker.example'})[0],403)
            status,account=request('POST','/market/v1/register',{'username':'httpuser','password':'strong-test-password'})
            self.assertEqual(status,200)
            auth={'Authorization':'Bearer '+account['token']}
            self.assertEqual(request('GET','/market/v1/me',headers=auth)[1]['user']['username'],'httpuser')
            self.assertEqual(request('GET','/v1/state',headers=auth)[0],401)
            source=bundle();source['files']['large.txt']='x'*150000
            self.assertEqual(request('POST','/market/v1/drafts',dict(title='Large source',description='',category='life',license='MIT',bundle=source),auth)[0],200)
            self.assertEqual(request('POST','/v1/clients/register',{'x':'x'*150000})[0],413)
            # Market writes retain the larger two-MiB transport bound.
            self.assertEqual(request('POST','/market/v1/notes',{},dict(auth, **{'Content-Length':str(2*1024*1024+1)}))[0],413)
            status,note=request('POST','/market/v1/notes',{'id':'note-1','text':'original'},auth)
            status,conflict=request('POST','/market/v1/notes',{'id':'note-1','revision':0,'text':'stale'},auth)
            self.assertEqual(status,409);self.assertEqual(conflict['current']['text'],'original')
            self.assertEqual(conflict['code'],'revision_conflict')
            self.assertNotIn(account['token'],json.dumps(conflict))
        finally:
            server.shutdown();server.server_close();thread.join();relay.close()

    def test_capabilities_are_narrow_unique_and_survive_fork(self):
        source=bundle();source['manifest']['capabilities']=['notes','agenda','task-state']
        draft=self.draft(source=source)
        published=self.publish(draft)
        fork=self.call('/forks',dict(version_id=published['version']['id']),self.b)['draft']
        self.assertEqual(self.call('/drafts/'+fork['id'],who=self.b)['bundle']['manifest']['capabilities'],['notes','agenda','task-state'])
        for caps in (['market-login'],['connect'],['admin'],['notes','notes'],['notes','agenda','task-state','notes'],'notes',[{}],[['notes']]):
            source=bundle();source['manifest']['capabilities']=caps
            self.denied(400,lambda:self.draft(source=source))

    def test_seed_metadata_ignored_but_invalid_bundle_rejected(self):
        self.seeds.mkdir(parents=True, exist_ok=True)
        (self.seeds/'verification.json').write_text(json.dumps({'updated':['today'],'order_preserved':True}))
        (self.seeds/'sample.json').write_text(json.dumps(bundle()))
        self.market.import_official()
        self.assertEqual(len(self.call('/catalog')['works']),1)
        invalid=self.seeds/'broken';invalid.mkdir()
        (invalid/'bundle.json').write_text('{}')
        with self.assertRaises(m.MarketError):self.market.import_official()

    def test_current_official_sources_cover_five_categories(self):
        source_root=Path(__file__).resolve().parents[2]/'official'
        current=m.Marketplace(str(Path(self.tmp.name)/'official-live.db'),seeds=source_root)
        try:
            works=current.handle('GET','/market/v1/catalog')['works']
            self.assertEqual({w['category'] for w in works},{'life','companion','sound','play','connect'})
            self.assertEqual(len(works),5)
            self.assertTrue(all(current.version(w['latest_version_id'])['official'] for w in works))
        finally:current.close()

    def test_seed_changed_source_appends_new_immutable_version(self):
        root=self.seeds/'official-companion';root.mkdir(parents=True)
        original=bundle('official-companion')
        (root/'bundle.json').write_text(json.dumps(original))
        self.market.import_official()
        work=self.call('/catalog')['works'][0]
        first=self.call('/versions/'+work['latest_version_id'])
        changed=copy.deepcopy(original);changed['files']['logic.js']='window.version=2;'
        (root/'bundle.json').write_text(json.dumps(changed))
        self.market.close()
        self.market=m.Marketplace(self.path,clock=lambda:self.now[0],seeds=self.seeds)
        latest=self.call('/works/'+work['id'])
        self.assertEqual(len(latest['versions']),2)
        self.assertEqual(latest['versions'][0]['number'],2)
        self.assertNotEqual(latest['work']['latest_version_id'],first['version']['id'])
        self.assertEqual(self.call('/versions/'+first['version']['id'])['bundle'],original)

    def test_ops_backup_stats_health_unlist_restore(self):
        spec=importlib.util.spec_from_file_location('market_ops_test',Path(__file__).with_name('ops.py'))
        ops=importlib.util.module_from_spec(spec);spec.loader.exec_module(ops)
        published=self.publish(self.draft())
        self.call('/notes',dict(text='Private note, must never occur in stats'),self.a)
        summary=ops.stats(self.path)
        self.assertEqual(summary['users'],2)
        self.assertEqual(summary['notes'],1)
        self.assertNotIn('Private',json.dumps(summary))
        self.assertNotIn(self.a['token'],json.dumps(summary))
        self.assertEqual(ops.health(self.path),{'ok':True,'database':True})
        dest=str(Path(self.tmp.name)/'backup.sqlite3')
        self.assertTrue(ops.backup(self.path,dest)['ok'])
        self.assertEqual(ops.stats(dest)['versions'],1)
        self.assertEqual(os.stat(dest).st_mode&0o777,0o600)
        with self.assertRaises(ops.OpsError):ops.backup(self.path,dest)
        wid=published['work']['id']
        with self.assertRaises(ops.OpsError):ops.visibility(self.path,wid,True,'wrong-confirmation')
        ops.visibility(self.path,wid,True,wid)
        self.assertEqual(self.call('/catalog')['works'],[])
        self.assertEqual(ops.stats(self.path)['unlisted_works'],1)
        # Unlisting affects discovery, not already-published immutable source access.
        self.assertEqual(self.call('/versions/'+published['version']['id'])['bundle'],bundle())
        current=self.call('/drafts/'+self.call('/drafts',who=self.a)['drafts'][0]['id'],who=self.a)['draft']
        self.publish(current)
        self.assertEqual(self.call('/catalog')['works'],[])
        ops.visibility(self.path,wid,False,wid)
        self.assertEqual(len(self.call('/catalog')['works']),1)

    def test_draft_and_personal_data_quotas_preserve_existing(self):
        drafts=[self.draft() for unused in range(50)]
        error=self.denied(409,lambda:self.draft())
        self.assertEqual(error.code,'quota_exceeded')
        self.assertEqual(len(self.call('/drafts',who=self.a)['drafts']),50)
        for index in range(200):
            self.call('/notes',dict(id='quota-note-'+str(index),text='Keep'),self.a)
        self.denied(409,lambda:self.call('/notes',dict(text='One too many'),self.a))
        current=self.call('/notes',dict(id='quota-note-0',revision=1,text='Still updateable',deleted=True),self.a)['note']
        self.assertEqual(current['text'],'Still updateable')
        self.assertEqual(len(self.call('/notes',who=self.a)['notes']),200)

    def test_login_rate_limit(self):
        for unused in range(29):
            self.denied(401,lambda:self.call('/login',dict(username='alice',password='incorrect-password')))
        self.denied(429,lambda:self.call('/login',dict(username='alice',password='incorrect-password')))


if __name__=='__main__':unittest.main()
