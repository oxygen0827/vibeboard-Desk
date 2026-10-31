"""Convert a local Petdex 8-column sprite sheet (9 or 11 rows) to compact offline ATOM data.

Usage: python3 import-sprites.py --id boba --name Boba --author railly path.webp
Requires Pillow with WebP support. Does not fetch or execute public source.
"""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import re
from PIL import Image

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('image', type=Path)
p.add_argument('--id', required=True)
p.add_argument('--name', required=True)
p.add_argument('--author', required=True)
a = p.parse_args()
if not re.fullmatch('[a-z][a-z0-9-]{0,23}', a.id):
    p.error('invalid pet id')
raw = a.image.read_bytes()
if len(raw) > 8 * 1024 * 1024:
    p.error('image exceeds 8 MiB')
im = Image.open(io.BytesIO(raw)).convert('RGBA')
w = im.width // 8
h = w * 13 // 12
if im.width % 8 or w * 13 % 12 or im.height not in (h * 9, h * 11) or im.width * im.height > 16_000_000:
    p.error('expected an 8-column, 9- or 11-row Petdex sheet with 192:208 cells')
sheet = Image.new('RGBA', (96 * 8, 104 * 9))
counts = []
for row in range(9):
    count = 0
    for col in range(8):
        frame = im.crop((col*w, row*h, (col+1)*w, (row+1)*h))
        if frame.getchannel('A').getbbox():
            count = col + 1
        sheet.paste(frame.resize((96, 104), Image.Resampling.LANCZOS), (col*96, row*104))
    if not count:
        p.error('empty required animation row')
    counts.append(count)
out = io.BytesIO()
sheet.save(out, 'WEBP', quality=82, method=6)
entry = dict(id=a.id, name=a.name[:60], author=a.author[:60], width=96, height=104,
             frames=counts, source='https://petdex.dev/pets/'+a.id,
             original_sha256=hashlib.sha256(raw).hexdigest(),
             image='data:image/webp;base64,'+base64.b64encode(out.getvalue()).decode())
target = Path(__file__).with_name('pets.js')
pets = json.loads(target.read_text().removeprefix('window.ATOMPets=').strip().removesuffix(';')) if target.exists() else []
pets = [pet for pet in pets if pet['id'] != a.id] + [entry]
target.write_text('window.ATOMPets='+json.dumps(pets, ensure_ascii=False, separators=(',', ':'))+';\n')
print(a.id, len(out.getvalue()), 'bytes', counts)
