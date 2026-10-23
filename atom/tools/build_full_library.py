#!/usr/bin/env python3
"""Build deterministic, complete source archives of existing apps, without app data or credentials."""
import argparse,base64,hashlib,io,json,re,sys,zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'connect/marketplace'))
from service import scan_publish
ROOT=Path(__file__).resolve().parents[1]
RETIRED={'official-companion','task-pal'}
p=argparse.ArgumentParser();p.add_argument('--seed',required=True);p.add_argument('--out',required=True);a=p.parse_args()
seed=Path(a.seed);out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
site=json.loads((ROOT/'site/assets/apps/catalog.json').read_text());known={x['id']:x for x in site['apps']};apps=[]
for aid in json.loads((seed/'order.json').read_text()):
 if aid in RETIRED:continue
 if not re.fullmatch(r'[a-z][a-z0-9_-]{0,47}',aid):raise ValueError('Invalid app ID')
 folder=seed/aid;manifest=json.loads((folder/'manifest.json').read_text());manifest.pop('_installed_at_ns',None)
 if manifest.get('id')!=aid:raise ValueError('Manifest ID mismatch: '+aid)
 content={};text={};size=0
 for path in sorted(folder.rglob('*')):
  if path.is_symlink():raise ValueError('Symlink in '+aid)
  if not path.is_file():continue
  rel=path.relative_to(folder).as_posix()
  if any(part.startswith('.') or part in ('__pycache__','node_modules') for part in path.relative_to(folder).parts):continue
  if path.suffix in ('.sqlite','.sqlite3','.log','.pyc','.pem','.key') or path.name in ('state.json','model.json','connect.json'):raise ValueError('Private file in '+aid)
  data=json.dumps(manifest,ensure_ascii=False,sort_keys=True,indent=2).encode() if rel=='manifest.json' else path.read_bytes()
  content[rel]=data;size+=len(data)
  try:text[rel]=data.decode('utf-8')
  except UnicodeDecodeError:pass
 if size>180*1024*1024 or len(content)>12000:raise ValueError('Source archive limit: '+aid)
 # HTML autocomplete ternary is not a password value; leave exported bytes unchanged.
 audited={k:v.replace("'new-password':'current-password'","'NEW':'CURRENT'") for k,v in text.items()}
 try:scan_publish({'manifest':manifest,'files':audited})
 except Exception:raise ValueError('Possible embedded credential; review '+aid+' before export')
 buf=io.BytesIO()
 with zipfile.ZipFile(buf,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
  for rel,data in sorted(content.items()):
   info=zipfile.ZipInfo(aid+'/'+rel,date_time=(2020,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16;z.writestr(info,data)
 data=buf.getvalue();sha=hashlib.sha256(data).hexdigest();name=aid+'-'+sha[:16]+'.zip';(out/name).write_bytes(data)
 icon=folder/manifest.get('icon','icon.svg');(out/(aid+'.svg')).write_bytes(icon.read_bytes())
 old=known.get(aid,{})
 image=old.get('image');capture='existing reviewed homepage'
 if not image:
  local=ROOT/'artifacts/full-library-covers'/(aid+'.png')
  if local.is_file():image='/atom/assets/library/'+aid+'.png';(out/(aid+'.png')).write_bytes(local.read_bytes());capture='actual rendered UI; isolated empty/demo state'
 cover=None
 if image:
  path=out/(aid+'.png') if image.startswith('/atom/assets/library/') else ROOT/'site'/image.removeprefix('/atom/')
  if path.is_file():
   from PIL import Image
   b=io.BytesIO()
   with Image.open(path) as im:im.convert('RGB').resize((360,270)).save(b,'JPEG',quality=65,optimize=True)
   cover='data:image/jpeg;base64,'+base64.b64encode(b.getvalue()).decode()
 apps.append(dict(id=aid,name=manifest['name'],description=manifest.get('description',''),category=old.get('category','life'),kind=old.get('kind','port'),icon='/atom/assets/library/'+aid+'.svg',image=image,cover_image=cover,archive='/atom/assets/library/'+name,sha256=sha,archive_bytes=len(data),files=len(content),expanded_bytes=size,input_status='declared' if manifest.get('input') else 'legacy',license_note='保留完整包中的上游与素材许可',capture=capture))
(out/'catalog.json').write_text(json.dumps({'version':1,'apps':apps,'count':len(apps)},ensure_ascii=False,separators=(',',':'))+'\n')
print(json.dumps({'apps':len(apps),'archives_bytes':sum(x['archive_bytes'] for x in apps),'covers':sum(bool(x['cover_image']) for x in apps)}))
