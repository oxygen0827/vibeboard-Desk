"""Private, fixed-route marketplace proxy. No account bearer reaches app iframes."""
import json, os, tempfile, threading
from pathlib import Path
from urllib.request import Request, build_opener
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from relay_bridge import BridgeError, NoRedirect, relay_url, identifier

class MarketClient:
    def __init__(self, state_dir, connect):
        self.root=Path(state_dir);self.path=self.root/'market-account.json';self.connect=connect
        self.lock=threading.RLock();self.opener=build_opener(NoRedirect());self.account={}
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
        if body and len(body)>2*1024*1024:raise BridgeError('请求内容过大')
        try:
            with self.opener.open(Request(self.base()+'/market/v1/'+route,data=body,headers=headers),timeout=10) as response:
                raw=response.read(2*1024*1024+1)
                if len(raw)>2*1024*1024:raise BridgeError('市场响应过大',502)
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
        if action=='state':
            value=self.current();user=value.get('user') or {}
            return dict(configured=bool(self.connect.config.get('relay_url')),authenticated=bool(value.get('token')),user={k:user[k] for k in ('id','username') if k in user})
        if action in ('register','login'):
            username=data.get('username');password=data.get('password')
            if not isinstance(username,str) or not isinstance(password,str):raise BridgeError('请输入账号和密码')
            with self.lock:
                result=self.request(action,{'username':username,'password':password})
                if not isinstance(result.get('token'),str) or not isinstance(result.get('user'),dict):raise BridgeError('账号响应无效',502)
                self.save(dict(relay_url=self.base(),token=result['token'],user={k:result['user'][k] for k in ('id','username') if k in result['user']}))
            return self.execute('state',{})
        if action=='me':return self.request('me',authenticated=True)
        if action=='email-start':return self.request('email/start',{'email':str(data.get('email',''))[:254]},True)
        if action=='email-verify':return self.request('email/verify',{'code':str(data.get('code',''))[:12]},True)
        if action=='password-forgot':return self.request('password/forgot',{'username':str(data.get('username',''))[:32]})
        if action=='password-change':
            if not isinstance(data.get('old_password'),str) or not isinstance(data.get('new_password'),str):raise BridgeError('请输入当前密码和新密码')
            return self.request('password/change',{'old_password':data['old_password'],'new_password':data['new_password']},True)
        if action=='password-reset':
            values={k:data.get(k) for k in ('username','code','new_password')}
            if not all(isinstance(v,str) and v for v in values.values()):raise BridgeError('请输入账号、验证码和新密码')
            with self.lock:
                result=self.request('password/reset',values)
                if not isinstance(result.get('token'),str) or not isinstance(result.get('user'),dict):raise BridgeError('账号响应无效',502)
                self.save(dict(relay_url=self.base(),token=result['token'],user={k:result['user'][k] for k in ('id','username') if k in result['user']}))
            return self.execute('state',{})
        if action=='logout':
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

    def private(self,route,payload,request):
        with self.lock:
            expected=request.get('expected_user_id')
            if expected is not None and expected != self.current().get('user',{}).get('id'):
                raise BridgeError('账号已切换，请重新打开应用并授权',401,'market_account_changed')
            return self.request(route,payload,True)
