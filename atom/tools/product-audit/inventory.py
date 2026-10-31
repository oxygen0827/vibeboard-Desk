"""Read-only installed source inventory and candidate finding collection."""
import json,re,hashlib
from pathlib import Path
root=Path('/tmp/atom-product-audit/device-source')
out=Path('atom/artifacts/product-audit-2026-10-31')
items=json.loads((root/'file-catalog.json').read_text())
report=[]
for app in items:
    if app['id']=='photo-pet':continue
    own=[]
    for f in app['files']:
        name=f['path']
        if f['included'] and '/' not in name and name.endswith(('.html','.js','.mjs','.css')) and not any(w in name for w in ['min.js','three','vendor','bundle.js','astronomy']):
            own.append((name,(root/app['id']/name).read_text()))
    source='\n'.join(s for _,s in own)
    flags=[]
    if not app['manifest'].get('input'):flags.append('input-declaration-missing: requires individual dynamic adaptation')
    for flag,pattern in [('opaque-storage','localStorage'),('window-alert',r'\b(?:alert|confirm|prompt)\s*\('),('keyboard-ownership',r'keydown|keyup'),('timed-work',r'requestAnimationFrame|setInterval'),('persistence',r'AtomApp\.save')]:
        if re.search(pattern,source):flags.append(flag)
    candidates=[]
    for parent in [Path('atom/official')/app['id'],Path('atom/ports')/app['id']]:
        if parent.exists():candidates.append(str(parent))
    mappings={'my-computer':'atom/computer-app','market':'atom/market-app','quick-notes':'atom/notes-app','symbiotic-world':'atom/experiences/world','language-alchemy':'atom/experiences/visual','ai-duet':'atom/experiences/duet','agent-studio':'atom/experiences/agents'}
    if app['id'] in mappings:candidates.append(mappings[app['id']])
    item={'id':app['id'],'name':app['manifest']['name'],'manifest':app['manifest'],'files':app['files'],'own_files':[n for n,_ in own],'canonical_candidates':candidates,'candidate_flags':flags,'rounds':{'1':{'status':'in_progress'},'2':{'status':'pending'},'3':{'status':'pending'}}}
    report.append(item)
(out/'audit-ledger.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
for a in report:print(a['id'],','.join(a['candidate_flags']))
