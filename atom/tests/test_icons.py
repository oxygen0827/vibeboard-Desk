import sys,json,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app_icons import generate_icon,validate_svg,ensure_icon,theme_glyph
import server
class Icons(unittest.TestCase):
 def bundle(self):return dict(manifest=dict(id='icon-test',name='Icon Test',entry='index.html',input={'version':1,'profile':'five-way','back':'root'}),files={'index.html':'<button>OK</button>'})
 def test_old_bundle_gains_icon_and_api_exposes_path(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t).resolve()/'apps';m=server.install_app(root,self.bundle());self.assertEqual(m['icon'],'icon.svg');validate_svg((root/'icon-test/icon.svg').read_text());self.assertEqual(server.apps(root)[-1]['icon'],'/user-apps/icon-test/icon.svg')
 def test_update_preserves_custom_icon_and_order(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t).resolve()/'apps';b=self.bundle();icon='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="12"/></svg>';b['manifest']['icon']='icon.svg';b['files']['icon.svg']=icon;m=server.install_app(root,b);n=server.install_app(root,self.bundle(),update=True);self.assertEqual(m['_installed_at_ns'],n['_installed_at_ns']);self.assertEqual((root/'icon-test/icon.svg').read_text(),theme_glyph(icon))
 def test_active_and_external_svg_rejected(self):
  for content in ['<script>alert(1)</script>','<rect onclick="x()"/>','<image href="https://x/a"/>','<path fill="url(https://x)"/>','<foreignObject/>']:
   with self.assertRaises(ValueError):validate_svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'+content+'</svg>')
 def test_all_curated_icons_are_valid_and_distinct(self):
  from app_icons import GLYPHS
  icons=[generate_icon(dict(id=k,name=k)) for k in GLYPHS];self.assertEqual(len(icons),len(set(icons)))
  for i in icons:validate_svg(i)
