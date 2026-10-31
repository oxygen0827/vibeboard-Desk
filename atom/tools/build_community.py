"""Package the same creator UI and five-way preview runtime for Mac and device."""
import json
from pathlib import Path
root = Path(__file__).resolve().parents[1]
computer = root / 'connect/computer'
(computer/'community-input.json').write_text(json.dumps((root/'static/input-navigation.js').read_text(),ensure_ascii=False))
source = (computer / 'preview.mjs').read_text()
source = source[:source.index('export const previewCSP')].replace('export function previewHTML', 'function previewHTML')
source = source.replace("Buffer.from(files[key]).toString('base64')", "btoa(Array.from(new TextEncoder().encode(files[key]),n=>String.fromCharCode(n)).join(''))")
source += '''\nwindow.AtomCommunityPreview=function(bundle){
 const csp="default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
 const prefix='<meta http-equiv="Content-Security-Policy" content="'+csp+'"><script>'+INPUT.replace(/<\\/script/gi,'<\\\\/script')+'</script>';
 return '<!doctype html>'+prefix+previewHTML(bundle);
};\n})();\n'''
(computer / 'community-preview.js').write_text('(function(){\nconst INPUT='+json.dumps((root/'static/input-navigation.js').read_text(),ensure_ascii=False)+';\n'+source)
for name in ('community.js','community.css','community-preview.js'):
    (root/'market-app'/name).write_text((computer/name).read_text())
