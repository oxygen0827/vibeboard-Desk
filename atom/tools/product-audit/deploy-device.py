"""Full-resource, hash-guarded app update. Run only with an explicitly prepared review package."""
from pathlib import Path
import json,hashlib,shutil,os,fcntl,time,sys
package=Path(sys.argv[1]).resolve();apps=Path('/home/linaro/atom/apps');release=Path('/home/linaro/atom/app-reviews/product-audit-2026-10-31')
changes=json.loads((package/'changes.json').read_text());catalog={a['id']:a for a in json.loads((package/'file-catalog.json').read_text())}
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def verify(id):
 root=apps/id;expected={f['path']:f['sha256'] for f in catalog[id]['files']}
 actual={p.relative_to(root).as_posix():digest(p) for p in root.rglob('*') if p.is_file()}
 if actual!=expected:raise RuntimeError('Installed source changed during review: '+id)
def safe(name):return not name.startswith('/') and all(x not in ('','..','.') for x in name.split('/'))
with open('/tmp/atom-product-review.lock','w') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 if release.exists():raise RuntimeError('Review release already exists; refusing to replace backup')
 for item in changes:verify(item['id'])
 release.mkdir(parents=True);(release/'original').mkdir();(release/'staging').mkdir();result=[];committed=[]
 try:
  for item in changes:
   id=item['id'];live=apps/id;stage=release/'staging'/id;shutil.copytree(live,stage,copy_function=shutil.copy2)
   for name in item['files']:
    if not safe(name):raise RuntimeError('Unsafe path')
    src=package/'patch'/id/name;dst=stage/name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
   before=json.loads((live/'manifest.json').read_text());after=json.loads((stage/'manifest.json').read_text());assert before['id']==after['id']
   assert before.get('_installed_at_ns')==after.get('_installed_at_ns')
   # All untouched assets must survive exactly, including binaries and complete upstream resources.
   for f in catalog[id]['files']:
    if f['path'] not in item['files']:assert digest(stage/f['path'])==f['sha256'],(id,f['path'])
   verify(id);os.rename(live,release/'original'/id)
   try:os.rename(stage,live)
   except BaseException:os.rename(release/'original'/id,live);raise
   committed.append(id);result.append({'id':id,'changed_files':len(item['files']),'total_files':sum(1 for p in live.rglob('*') if p.is_file()),'installed_at_preserved':True,'changed_sha256':{n:digest(live/n) for n in item['files']}})
 except BaseException:
  for id in reversed(committed):
   os.rename(apps/id,release/'staging'/id);os.rename(release/'original'/id,apps/id)
  raise
 (release/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'updated':result,'source_verified':True,'state_files_touched':False,'backup':str(release/'original')},ensure_ascii=False))
