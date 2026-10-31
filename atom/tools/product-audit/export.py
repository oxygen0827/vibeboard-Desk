"""Export reviewed changes with source-concurrency checks. Does not deploy anything."""
from pathlib import Path
import json,hashlib,shutil
BASE=Path('/tmp/atom-product-audit/device-source');WORK=BASE.parent/'working'
changed=[]
for p in sorted(WORK.iterdir()):
 if not p.is_dir():continue
 diffs=[f.relative_to(p).as_posix() for f in p.rglob('*') if f.is_file() and (not (BASE/p.name/f.relative_to(p)).exists() or f.read_bytes()!=(BASE/p.name/f.relative_to(p)).read_bytes())]
 if diffs:changed.append((p.name,diffs))
patch=BASE.parent/'patch';patch.mkdir(exist_ok=True)
records=[]
for id,diffs in changed:
 source=Path('atom/notes-app') if id=='quick-notes' else Path('atom/ports')/id
 if not source.is_dir():source=Path('atom/legacy-seeds')/id
 if not source.is_dir():source=Path('atom/reviewed-apps')/id
 source.mkdir(parents=True,exist_ok=True)
 bundlepath=source/'bundle.json';bundle=json.loads(bundlepath.read_text()) if bundlepath.exists() else {'files':{}}
 manifest=json.loads((WORK/id/'manifest.json').read_text());manifest={k:v for k,v in manifest.items() if not k.startswith('_')}
 # Preserve source fields unless this reviewed change intentionally touched them.
 original=json.loads((BASE/id/'manifest.json').read_text());bmanifest=bundle.get('manifest',manifest)
 for k,v in manifest.items():
  if original.get(k)!=v or k not in bmanifest:bmanifest[k]=v
 bundle['manifest']=bmanifest
 # Complete source folder for newly adopted legacy/generated apps.
 if not (source/'index.html').exists():
  for f in (WORK/id).iterdir():
   if f.is_file() and f.name!='manifest.json':shutil.copyfile(f,source/f.name)
 for name in diffs:
  if name=='manifest.json':continue
  f=WORK/id/name;t=source/name;b=BASE/id/name
  prior=patch/id/name
  if id=='quick-notes' and name=='app.js':
   bundle['files'][name]=t.read_text();continue
  if t.exists() and b.exists() and t.read_bytes() not in (b.read_bytes(),f.read_bytes(),prior.read_bytes() if prior.exists() else b''):raise SystemExit('Concurrent source change: '+str(t))
  t.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(f,t)
  if name in bundle['files'] or name in ['scene-session.js','scene-controls.js','main.js']:bundle['files'][name]=f.read_text()
 bundle['files']['index.html']=(WORK/id/'index.html').read_text();bundle['files']['icon.svg']=(WORK/id/'icon.svg').read_text();bundle['manifest']['icon']='icon.svg'
 bundlepath.write_text(json.dumps(bundle,ensure_ascii=False,indent=2)+'\n');(source/'manifest.json').write_text(json.dumps(bmanifest,ensure_ascii=False,indent=2)+'\n')
 for name in diffs:
  dest=patch/id/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(WORK/id/name,dest)
 records.append({'id':id,'source':str(source.resolve()),'files':diffs})
 if source.parts[1]=='reviewed-apps':(source/'README.md').write_text('从灰色 ATOM 已安装应用导入的维护版本，保留原有标识与图标。2026-10-31 产品复查修正返回按钮与生命周期；不是另一次新建应用。\n')
Path('atom/artifacts/product-audit-2026-10-31/changes.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
print(json.dumps([{'id':x['id'],'files':len(x['files'])} for x in records],ensure_ascii=False))
