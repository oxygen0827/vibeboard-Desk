"""Private, fixed-route marketplace proxy. No account bearer reaches app iframes."""
import base64, json, os, secrets, tempfile, threading
from pathlib import Path
from urllib.request import Request, build_opener
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from relay_bridge import BridgeError, NoRedirect, relay_url, identifier
try:
    import e2e
except ImportError:  # python3-cryptography not installed
    e2e = None

LOCKED = '随手记和今日已加密，请在「应用市场」账号页输入密码解锁'

class MarketClient:
    def __init__(self, state_dir, connect):
        self.root=Path(state_dir);self.path=self.root/'market-account.json';self.connect=connect
        self.lock=threading.RLock();self.opener=build_opener(NoRedirect());self.account={}
        # Memory only: a recovery code waiting to be shown, and the password while recovery is pending.
        self.recovery_code=None;self.pending=None
        try:
            if self.path.is_symlink():raise ValueError('symlink')
            value=json.loads(self.path.read_text(encoding='utf-8'))
            relay_url(value['relay_url'])
            if not isinstance(value.get('token'),str) or not 16<=len(value['token'])<=4096:raise ValueError('token')
            if not isinstance(value.get('user'),dict):raise ValueError('user')
            self.account=value
        except (OSError,ValueError,KeyError,TypeError):pass
    def base(self):
        return relay_url(self.connect.config.get('relay_url'))
    def current(self):
        return self.account if self.account.get('relay_url')==self.connect.config.get('relay_url') else {}
    def save(self, value):
        if self.root.is_symlink() or any(p.is_symlink() for p in self.root.parents) or self.path.is_symlink():raise BridgeError('账号路径不可用')
        self.root.mkdir(parents=True,exist_ok=True)
        fd,name=tempfile.mkstemp(prefix='.market-',dir=str(self.root))
        try:
            os.fchmod(fd,0o600)
            with os.fdopen(fd,'w',encoding='utf-8') as f:
                json.dump(value,f,ensure_ascii=False);f.flush();os.fsync(f.fileno())
            os.replace(name,str(self.path))
        finally:
            if os.path.exists(name):os.unlink(name)
        self.account=value
    def request(self, route, data=None, authenticated=False):
        headers={'Content-Type':'application/json','Accept':'application/json'}
        if authenticated:
            token=self.current().get('token')
            if not token:raise BridgeError('请先登录应用市场账号',401,'market_login_required')
            headers['Authorization']='Bearer '+token
        body=None if data is None else json.dumps(data,ensure_ascii=False).encode('utf-8')
        limit=28*1024*1024 if route=='photos' or route.startswith('photos/') or route.startswith('photos?') else 2*1024*1024
        if body and len(body)>limit:raise BridgeError('请求内容过大')
        try:
            with self.opener.open(Request(self.base()+'/market/v1/'+route,data=body,headers=headers),timeout=10) as response:
                raw=response.read(limit+1)
                if len(raw)>limit:raise BridgeError('市场响应过大',502)
                result=json.loads(raw.decode('utf-8'))
                if not isinstance(result,dict):raise BridgeError('市场响应无效',502)
                return result
        except HTTPError as exc:
            try:detail=json.loads(exc.read(8192).decode('utf-8'))
            except (ValueError,UnicodeError):detail={}
            message=detail.get('error','市场服务暂不可用')
            if not isinstance(message,str):message='市场请求失败'
            error=BridgeError(message[:400],exc.code if exc.code in (400,401,403,404,409,413,429,503) else 502,'market_http_'+str(exc.code))
            if isinstance(detail.get('current'),dict):error.current=detail['current']
            raise error
        except (URLError,OSError,TimeoutError):raise BridgeError('暂时无法连接市场，未同步内容会留在本机',503,'market_unreachable')
        except (ValueError,UnicodeError) as exc:
            if isinstance(exc,BridgeError):raise
            raise BridgeError('市场返回格式无效',502)
    def execute(self, action, data):
        if not isinstance(data,dict):raise BridgeError('请求格式无效')
        if action.startswith('photo-'):
            with self.lock:
                expected=data.get('expected_user_id')
                if expected is not None and expected!=self.current().get('user',{}).get('id'):
                    raise BridgeError('账号已切换，请重新打开相册',401)
                name=action[6:]
                if name=='state':return self.request('photos/state',authenticated=True)
                if name=='list':return self.request('photos?'+urlencode({k:data[k] for k in ('page','filter','limit') if k in data}),authenticated=True)
                if name=='jobs':return self.request('photos/jobs',authenticated=True)
                if name=='job':return self.request('photos/jobs/'+identifier(data.get('id'),'任务'),authenticated=True)
                if name=='generate':return self.request('photos/generate',{k:data[k] for k in ('request_id','prompt','style','source_id') if k in data},True)
                if name in ('get','update','delete'):
                    route='photos/'+identifier(data.get('id'),'照片')
                    if name=='get':return self.request(route,authenticated=True)
                    return self.request(route+'/'+name,{k:data[k] for k in ('revision','name','favorite','confirm') if k in data},True)
                raise BridgeError('相册操作不支持')
        if action=='state':
            value=self.current();user=value.get('user') or {}
            return dict(configured=bool(self.connect.config.get('relay_url')),authenticated=bool(value.get('token')),user={k:user[k] for k in ('id','username') if k in user},
                        encryption=self.encryption(),**({'recovery_code':self.recovery_code} if self.recovery_code else {}))
        if action in ('register','login'):
            username=data.get('username');password=data.get('password')
            if not isinstance(username,str) or not isinstance(password,str):raise BridgeError('请输入账号和密码')
            with self.lock:
                result=self.request(action,{'username':username,'password':password})
                if not isinstance(result.get('token'),str) or not isinstance(result.get('user'),dict):raise BridgeError('账号响应无效',502)
                self.save(dict(relay_url=self.base(),token=result['token'],user={k:result['user'][k] for k in ('id','username') if k in result['user']}))
                self.recovery_code=self.pending=None
                try:self.after_sign_in(password)
                except BridgeError:pass  # stays locked; the account page offers unlock again
            return self.execute('state',{})
        if action=='unlock':
            password=data.get('password')
            if not isinstance(password,str) or not password:raise BridgeError('请输入密码')
            return self.execute('login',{'username':self.current().get('user',{}).get('username',''),'password':password})
        if action=='recover':
            with self.lock:
                if not self.pending:raise BridgeError('请先输入新密码登录')
                try:key=e2e.unlock_with_recovery(self.pending['keys'],str(data.get('code','')))
                except e2e.E2EError:raise BridgeError('恢复密钥不正确')
                record=e2e.rewrap_password(self.pending['keys'],key,self.pending['password'])
                self.request('keys',{'keys':record},True)
                self.store_key(key,record['key_id'])
            return self.execute('state',{})
        if action=='reset-keys':
            with self.lock:
                if not self.pending or data.get('confirm') is not True:raise BridgeError('请确认放弃无法解密的旧内容')
                key,code,record=e2e.new_account_keys(self.pending['password'])
                self.request('keys',{'keys':record,'reset':True,'confirm':True},True)
                self.store_key(key,record['key_id']);self.recovery_code=code
            return self.execute('state',{})
        if action=='recovery-ack':
            self.recovery_code=None
            return self.execute('state',{})
        if action=='me':return self.request('me',authenticated=True)
        if action=='email-start':return self.request('email/start',{'email':str(data.get('email',''))[:254]},True)
        if action=='email-verify':return self.request('email/verify',{'code':str(data.get('code',''))[:12]},True)
        if action=='password-forgot':return self.request('password/forgot',{'username':str(data.get('username',''))[:32]})
        if action=='password-change':
            if not isinstance(data.get('old_password'),str) or not isinstance(data.get('new_password'),str):raise BridgeError('请输入当前密码和新密码')
            body={'old_password':data['old_password'],'new_password':data['new_password']}
            key=self.data_key() if e2e else None
            if key is not None:
                keys=self.request('keys',authenticated=True).get('keys')
                if keys:body['keys']=e2e.rewrap_password(keys,key,data['new_password'])
            return self.request('password/change',body,True)
        if action=='password-reset':
            values={k:data.get(k) for k in ('username','code','new_password')}
            if not all(isinstance(v,str) and v for v in values.values()):raise BridgeError('请输入账号、验证码和新密码')
            with self.lock:
                result=self.request('password/reset',values)
                if not isinstance(result.get('token'),str) or not isinstance(result.get('user'),dict):raise BridgeError('账号响应无效',502)
                self.save(dict(relay_url=self.base(),token=result['token'],user={k:result['user'][k] for k in ('id','username') if k in result['user']}))
                self.recovery_code=self.pending=None
                try:self.after_sign_in(values['new_password'])
                except BridgeError:pass
            return self.execute('state',{})
        if action=='logout':
            self.recovery_code=self.pending=None
            revoked=True
            with self.lock:
                try:
                    if self.current().get('token'):self.request('logout',{},True)
                except BridgeError:revoked=False
                self.save({})
            return {'ok':True,'local_cleared':True,'remote_revoked':revoked}

        if action=='catalog':
            query={k:str(data[k])[:120] for k in ('q','category') if data.get(k)}
            return self.request('catalog'+('?' + urlencode(query) if query else ''))
        if action=='work':return self.request('works/'+identifier(data.get('work_id'),'作品'))
        if action=='source':return self.request('versions/'+identifier(data.get('version_id'),'版本'))
        if action=='fork':return self.request('forks',{'version_id':identifier(data.get('version_id'),'版本'),**({'title':data['title']} if 'title' in data else {})},True)
        if action=='drafts':return self.request('drafts',authenticated=True)
        if action=='draft':return self.request('drafts/'+identifier(data.get('draft_id'),'创作'),authenticated=True)
        if action=='notes':return self.private('notes',None,data)
        if action=='save-note':
            payload={k:data[k] for k in ('id','revision','text','pinned','deleted') if k in data}
            if 'id' in payload:identifier(payload['id'],'记录')
            return self.private('notes',payload,data)
        if action=='agenda':return self.private('agenda',None,data)
        if action=='save-agenda':
            payload={k:data[k] for k in ('id','revision','title','kind','starts_at','done','deleted') if k in data}
            if 'id' in payload:identifier(payload['id'],'日程')
            return self.private('agenda',payload,data)
        raise BridgeError('不支持的市场操作')

    def encryption(self):
        if not self.current().get('token'):return 'none'
        if e2e is None:return 'unsupported'
        if self.current().get('data_key'):return 'on'
        return 'recovery' if self.pending else 'locked'

    def data_key(self):
        value=self.current().get('data_key')
        return base64.urlsafe_b64decode(value+'='*(-len(value)%4)) if value else None

    def store_key(self,key,key_id):
        self.save(dict(self.current(),data_key=e2e.b64(key),key_id=key_id));self.pending=None

    def after_sign_in(self,password):
        """Unlock (or first set up) the account data key while the password is at hand."""
        if e2e is None:return
        keys=self.request('keys',authenticated=True).get('keys')
        if keys is None:
            key,code,record=e2e.new_account_keys(password)
            self.request('keys',{'keys':record},True)
            self.store_key(key,record['key_id']);self.recovery_code=code
            self.migrate(key,record['key_id'])
            return
        try:self.store_key(e2e.unlock_with_password(keys,password),keys['key_id'])
        except e2e.E2EError:self.pending=dict(password=password,keys=keys)  # e.g. after an email reset

    def migrate(self,key,key_id):
        # Re-save remaining plaintext items encrypted; conflicts are left for the next edit.
        uid=self.current()['user']['id']
        for n in self.request('notes',authenticated=True).get('notes',[]):
            if 'text' in n:
                try:self.request('notes',{'id':n['id'],'revision':n['revision'],'pinned':n.get('pinned',False),'deleted':n.get('deleted',False),'key_id':key_id,'enc':e2e.seal_json(key,{'text':n['text']},'note|'+uid+'|'+n['id'])},True)
                except BridgeError:pass
        for a in self.request('agenda',authenticated=True).get('items',[]):
            if 'title' in a:
                try:self.request('agenda',{'id':a['id'],'revision':a['revision'],'kind':a.get('kind','todo'),'done':a.get('done',False),'deleted':a.get('deleted',False),'key_id':key_id,'enc':e2e.seal_json(key,{'title':a['title'],'starts_at':a.get('starts_at','')},'agenda|'+uid+'|'+a['id'])},True)
                except BridgeError:pass

    def reveal(self,route,item,key,uid):
        if not isinstance(item,dict) or 'enc' not in item:return item
        if key is None:raise BridgeError(LOCKED,423,'notes_locked')
        try:value=e2e.open_json(key,item.pop('enc'),('note|' if route=='notes' else 'agenda|')+uid+'|'+str(item.get('id')))
        except e2e.E2EError:value={'text':'[无法解密]'} if route=='notes' else {'title':'[无法解密]','starts_at':''}
        item.pop('key_id',None);item.update(value)
        return item

    def private(self,route,payload,request):
        with self.lock:
            expected=request.get('expected_user_id')
            if expected is not None and expected != self.current().get('user',{}).get('id'):
                raise BridgeError('账号已切换，请重新打开应用并授权',401,'market_account_changed')
            key,uid=(self.data_key() if e2e else None),self.current().get('user',{}).get('id','')
            if payload is not None and key is not None:
                payload=dict(payload);payload.setdefault('id',secrets.token_hex(16))
                fields=('text',) if route=='notes' else ('title','starts_at')
                if any(f in payload for f in fields):
                    payload['enc']=e2e.seal_json(key,{f:payload.pop(f,'') for f in fields},('note|' if route=='notes' else 'agenda|')+uid+'|'+payload['id'])
                payload['key_id']=self.current().get('key_id')
            try:result=self.request(route,payload,True)
            except BridgeError as exc:
                if getattr(exc,'code','')=='market_http_400' and key is None and payload is not None:raise BridgeError(LOCKED,423,'notes_locked')
                if isinstance(getattr(exc,'current',None),dict):self.reveal(route,exc.current,key,uid)
                raise
            for name in ('notes','items'):
                for item in result.get(name,[]):self.reveal(route,item,key,uid)
            for name in ('note','item'):
                if name in result:self.reveal(route,result[name],key,uid)
            return result
