from pathlib import Path
import subprocess,shlex,zipfile,json,io
root=Path('/tmp/atom-product-audit');root.mkdir(exist_ok=True,mode=0o700)
if (root/'device-source').exists(): raise SystemExit('Existing audit baseline is immutable; archive it before collecting a new review.')
ssh=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=8','-o','UserKnownHostsFile=/tmp/atom-gray-pet-known-hosts','-o','ControlMaster=auto','-o','ControlPersist=600','-o','ControlPath=/tmp/atom-pet-motion-ssh','-p','6278','-i',str(Path.home()/'.ssh/atom_gray_friend'),'linaro@150.158.146.192']
remote='''from pathlib import Path
import json,hashlib,zipfile,io,sys
root=Path('/home/linaro/atom/apps');items=[];out=io.BytesIO()
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=3) as z:
 for folder in sorted(root.iterdir()):
  if not folder.is_dir() or folder.is_symlink() or not (folder/'manifest.json').exists():continue
  manifest=json.loads((folder/'manifest.json').read_text());files=[]
  for p in sorted(folder.rglob('*')):
   if not p.is_file() or p.is_symlink():continue
   rel=p.relative_to(folder).as_posix();data=p.read_bytes();included=p.suffix.lower() in ['.html','.js','.mjs','.css','.json','.svg'] and len(data)<400000
   files.append({'path':rel,'size':len(data),'sha256':hashlib.sha256(data).hexdigest(),'included':included})
   if included:z.writestr(folder.name+'/'+rel,data)
  items.append({'id':folder.name,'manifest':manifest,'files':files})
 z.writestr('file-catalog.json',json.dumps(items,ensure_ascii=False))
sys.stdout.buffer.write(out.getvalue())'''
r=subprocess.run(ssh+['python3 -c '+shlex.quote(remote)],capture_output=True,timeout=180)
if r.returncode:raise RuntimeError(r.stderr.decode(errors='replace'))
(root/'sources.zip').write_bytes(r.stdout)
with zipfile.ZipFile(io.BytesIO(r.stdout)) as z:z.extractall(root/'device-source')
items=json.loads((root/'device-source/file-catalog.json').read_text());print(json.dumps({'apps':len(items),'download_bytes':len(r.stdout),'files':sum(sum(x['included'] for x in a['files']) for a in items)},ensure_ascii=False))
