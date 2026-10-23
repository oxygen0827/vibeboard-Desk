"""Run on the ATOM server after upload: verify then atomically expose complete archives."""
from pathlib import Path
import fcntl,hashlib,json,os,re,shutil,zipfile
incoming=Path('/opt/atom/.library-incoming')
private=Path('/opt/atom/app-library')
public=Path('/home/lincaigui/nginx/static/atom/assets/library')
private.mkdir(exist_ok=True)
with open(private/'.sync.lock','w') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 payload=json.loads((incoming/'catalog.json').read_text());rows=payload['apps']
 assert 1<=len(rows)<=200
 old_index=private/'catalog.json'
 if old_index.exists():
  previous=json.loads(old_index.read_text()).get('apps',[])
  assert len(rows)>=len(previous), 'Library unexpectedly shrank; verify inventory before replacing it'
 current=set()
 for app in rows:
  aid=app['id'];assert re.fullmatch(r'[a-z][a-z0-9_-]{0,47}',aid)
  name=app['archive'].rsplit('/',1)[-1];assert name==aid+'-'+app['sha256'][:16]+'.zip'
  archive=incoming/name;assert archive.is_file() and not archive.is_symlink()
  assert hashlib.sha256(archive.read_bytes()).hexdigest()==app['sha256']
  with zipfile.ZipFile(archive) as z:
   assert z.testzip() is None
   assert len(z.infolist())==app['files']
   for item in z.infolist():
    parts=Path(item.filename).parts
    assert parts[0]==aid and not Path(item.filename).is_absolute() and all(p not in ('.','..') for p in parts)
  current.add(name)
 public.mkdir(parents=True,exist_ok=True)
 # Move verified archives before switching catalogs. Readers keep seeing a complete set.
 for p in incoming.iterdir():
  if p.name=='catalog.json':continue
  assert p.is_file() and not p.is_symlink()
  assert re.fullmatch(r'[a-z][a-z0-9_-]{0,47}(?:-[a-f0-9]{16}\.zip|\.svg|\.png)',p.name)
  os.replace(str(p),str(public/p.name))
 shutil.copy2(str(incoming/'catalog.json'),str(private/'.catalog.next'))
 os.replace(str(private/'.catalog.next'),str(private/'catalog.json'))
 os.replace(str(incoming/'catalog.json'),str(public/'catalog.json'))
 # Retire the previous raw mirror only when its content exactly matches the new ZIP.
 # Unexpected files or edits remain untouched, rather than being discarded as duplicates.
 reclaimed=0
 for app in rows:
  aid=app['id'];old=private/aid
  if not old.is_dir() or old.is_symlink():continue
  files=[p for p in old.rglob('*') if p.is_file()]
  if any(p.is_symlink() for p in old.rglob('*')):continue
  archive=public/(aid+'-'+app['sha256'][:16]+'.zip')
  with zipfile.ZipFile(archive) as z:
   if {p.relative_to(old).as_posix() for p in files}!={str(Path(n).relative_to(aid)) for n in z.namelist()}:continue
   match=True
   for p in files:
    rel=p.relative_to(old).as_posix();a=p.read_bytes();b=z.read(aid+'/'+rel)
    if rel=='manifest.json':
     a=json.loads(a);b=json.loads(b);a.pop('_installed_at_ns',None);b.pop('_installed_at_ns',None)
    if a!=b:match=False;break
   if match:
    reclaimed+=sum(p.stat().st_size for p in files);shutil.rmtree(str(old))
 # Keep a single completed full-library archive per app; never touch unrelated objects.
 for p in public.iterdir():
  if p.is_file() and not p.is_symlink() and re.fullmatch(r'[a-z][a-z0-9_-]{0,47}-[a-f0-9]{16}\.zip',p.name) and p.name not in current:p.unlink()
 print(json.dumps(dict(apps=len(rows),verified_archives=len(current),reclaimed_duplicate_bytes=reclaimed)))
