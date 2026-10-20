#!/usr/bin/env python3
"""Build an unsigned local macOS app with embedded Node runtime. No credentials bundled."""
import argparse, pathlib, shutil, subprocess, plistlib, os
p=argparse.ArgumentParser();p.add_argument('--node',required=True);p.add_argument('--output',default='atom/connect/dist/ATOM Connect.app');a=p.parse_args()
base=pathlib.Path(__file__).resolve().parent;app=pathlib.Path(a.output).resolve()
if app.exists():shutil.rmtree(app)
mac=app/'Contents/MacOS';resources=app/'Contents/Resources';mac.mkdir(parents=True);(resources/'runtime').mkdir(parents=True)
node=pathlib.Path(a.node).resolve()
if not node.is_file():raise SystemExit('Node runtime missing')
shutil.copy2(node,resources/'runtime/node');os.chmod(resources/'runtime/node',0o755)
shutil.copytree(base.parent/'computer',resources/'computer',ignore=shutil.ignore_patterns('node_modules','test','state','*.sqlite*','state.json','*.log'))
info=dict(CFBundleIdentifier='local.atom.connect',CFBundleName='ATOM Connect',CFBundleDisplayName='ATOM Connect',CFBundleExecutable='ATOMConnect',CFBundlePackageType='APPL',CFBundleShortVersionString='0.1.0',CFBundleVersion='1',LSMinimumSystemVersion='13.0',LSUIElement=True,NSHighResolutionCapable=True,NSAppTransportSecurity={'NSAllowsLocalNetworking':True},CFBundleIconFile='AppIcon')
(app/'Contents/Info.plist').write_bytes(plistlib.dumps(info))
subprocess.run(['swiftc','-O','-framework','AppKit','-framework','WebKit',str(base/'ATOMConnect.swift'),'-o',str(mac/'ATOMConnect')],check=True)
# Original AppKit vector icon; no Apple artwork or external assets.
subprocess.run(['swift',str(base/'Icon.swift'),str(resources)],check=True)
subprocess.run(['codesign','--force','--deep','--sign','-',str(app)],check=True,stdout=subprocess.DEVNULL)
print(app)
