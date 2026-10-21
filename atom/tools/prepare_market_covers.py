"""Build reviewed official cover seeds from public gallery screenshots, without app data."""
import json
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parents[1]
out=root/'official/covers';out.mkdir(exist_ok=True)
apps=json.loads((root/'site/assets/apps/catalog.json').read_text())['apps']
sources={}
for app in apps:
    if not app['market_id'] or not app['image']:
        continue
    path=root/'site'/app['image'].removeprefix('/atom/')
    with Image.open(path) as image:
        image=image.convert('RGB')
        if image.size==(508,360):image=image.crop((0,0,480,360))
        image.thumbnail((1280,960))
        image.save(out/(app['id']+'.jpg'),'JPEG',quality=88,optimize=True)
    sources[app['id']]={'source':str(path.relative_to(root)),'capture':'Reviewed application UI; empty/demo state for private-data applications'}
(out/'sources.json').write_text(json.dumps(sources,ensure_ascii=False,indent=2)+'\n')
print('Prepared',len(sources),'official screenshot covers')
