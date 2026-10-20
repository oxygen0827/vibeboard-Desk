"""Private installed-resource snapshots. Does not roll back user application data."""
import hashlib,json,os,re,tempfile,time
from pathlib import Path
ID=re.compile(r'^[a-z][a-z0-9_-]{0,47}$');HASH=re.compile(r'^[a-f0-9]{64}$')
class ReleaseStore:
    def __init__(self,root):self.root=Path(root)
    def folder(self,app_id,create=False):
        if not isinstance(app_id,str) or not ID.fullmatch(app_id):raise ValueError('应用标识无效')
        path=self.root/app_id
        if any(p.is_symlink() for p in [path,self.root,*self.root.parents]):raise ValueError('恢复目录不可用')
        if create:path.mkdir(parents=True,exist_ok=True,mode=0o700)
        return path
    def capture(self,apps_root,app_id):
        target=Path(apps_root)/app_id
        self.folder(app_id)
        if not target.is_dir():return
        if target.is_symlink():raise ValueError('应用路径无效')
        if (target/'manifest.json').is_symlink():raise ValueError('应用清单路径无效')
        manifest=json.loads((target/'manifest.json').read_text(encoding='utf-8'))
        files={};size=0
        for file in target.rglob('*'):
            if file.is_symlink():raise ValueError('恢复不支持符号链接')
            if not file.is_file() or file.name=='manifest.json':continue
            if len(files)>=100:raise ValueError('应用文件过多')
            size+=file.stat().st_size
            if size>2*1024*1024:raise ValueError('应用资源过大，无法保留恢复副本')
            files[file.relative_to(target).as_posix()]=file.read_text(encoding='utf-8')
        bundle={'manifest':manifest,'files':files};raw=json.dumps(bundle,ensure_ascii=False,sort_keys=True).encode('utf-8');digest=hashlib.sha256(raw).hexdigest();folder=self.folder(app_id,True);path=folder/(digest+'.json')
        if not path.exists():
            record={'release_id':digest,'created_at':time.time(),'name':manifest.get('name',app_id),'bundle':bundle};fd,tmp=tempfile.mkstemp(prefix='.release-',dir=str(folder))
            try:
                os.fchmod(fd,0o600)
                with os.fdopen(fd,'w',encoding='utf-8')as f:json.dump(record,f,ensure_ascii=False);f.flush();os.fsync(f.fileno())
                os.replace(tmp,str(path))
            finally:
                if os.path.exists(tmp):os.unlink(tmp)
        for item in self.history(app_id)[3:]:
            old=folder/(item['release_id']+'.json')
            if not old.is_symlink():old.unlink()
    def history(self,app_id):
        folder=self.folder(app_id);out=[]
        if not folder.exists():return out
        for path in folder.glob('*.json'):
            if path.is_symlink() or not HASH.fullmatch(path.stem) or path.stat().st_size>3*1024*1024:continue
            try:
                value=json.loads(path.read_text(encoding='utf-8'));out.append({k:value[k] for k in ('release_id','created_at','name')})
            except (OSError,ValueError,KeyError):continue
        return sorted(out,key=lambda v:v['created_at'],reverse=True)
    def read(self,app_id,release_id):
        if not isinstance(release_id,str) or not HASH.fullmatch(release_id):raise ValueError('恢复版本无效')
        path=self.folder(app_id)/(release_id+'.json')
        if path.is_symlink() or not path.is_file() or path.stat().st_size>3*1024*1024:raise ValueError('恢复副本不存在')
        return json.loads(path.read_text(encoding='utf-8'))['bundle']
