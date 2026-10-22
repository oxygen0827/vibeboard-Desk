#!/usr/bin/env python3
"""Build an unsigned local macOS app with embedded Node runtime. No credentials bundled."""
import argparse, pathlib, shutil, subprocess, plistlib, os, json
p=argparse.ArgumentParser();p.add_argument('--node',required=True);p.add_argument('--output',default='atom/connect/dist/ATOM Connect.app');p.add_argument('--python-root',help='Portable Python prefix with cryptography; bundled for the simulator');p.add_argument('--sign-identity',help='Developer ID Application identity');p.add_argument('--notary-profile',help='Existing notarytool keychain profile');a=p.parse_args()
if a.notary_profile and not a.sign_identity:raise SystemExit('--notary-profile requires --sign-identity')
base=pathlib.Path(__file__).resolve().parent;app=pathlib.Path(a.output).resolve()
# The runtime is copied alone, so it must not link Homebrew/@rpath libraries (e.g. libnode.dylib).
links=[l.split()[0] for l in subprocess.run(['otool','-L',str(pathlib.Path(a.node).resolve())],capture_output=True,text=True,check=True).stdout.splitlines()[1:]]
foreign=[l for l in links if not l.startswith(('/usr/lib/','/System/'))]
if foreign:raise SystemExit('Node runtime is not self-contained (links '+', '.join(foreign[:3])+'); pass a standalone node, e.g. an official nodejs.org build')
if app.exists():shutil.rmtree(app)
mac=app/'Contents/MacOS';resources=app/'Contents/Resources';mac.mkdir(parents=True);(resources/'runtime').mkdir(parents=True)
node=pathlib.Path(a.node).resolve()
if not node.is_file():raise SystemExit('Node runtime missing')
shutil.copy2(node,resources/'runtime/node');os.chmod(resources/'runtime/node',0o755)
shutil.copytree(base.parent/'computer',resources/'computer',ignore=shutil.ignore_patterns('node_modules','test','state','*.sqlite*','state.json','*.log'))
# Bundle a relocatable Python without unrelated workspace libraries or credentials.
if a.python_root:
    prefix=pathlib.Path(a.python_root).resolve();py=prefix/'bin/python3';dest=resources/'runtime/python'
    probe=json.loads(subprocess.check_output([str(py),'-c','import sys,json,cryptography;print(json.dumps({"v":"%d.%d"%sys.version_info[:2]}))']))
    libs=subprocess.check_output(['otool','-L',str(py)],text=True).splitlines()[1:]
    if any(not row.split()[0].startswith(('/usr/lib/','/System/','@loader_path/','@executable_path/')) for row in libs):raise SystemExit('Python executable is not relocatable')
    (dest/'bin').mkdir(parents=True);shutil.copy2(py,dest/'bin/python3')
    source=prefix/'lib'/('python'+probe['v']);target=dest/'lib'/source.name
    shutil.copytree(source,target,ignore=shutil.ignore_patterns('site-packages','__pycache__','test','tests','idlelib','tkinter','turtledemo','ensurepip'))
    site=target/'site-packages';site.mkdir()
    for item in (source/'site-packages').iterdir():
        if item.name.startswith(('cryptography','cffi','_cffi_backend','pycparser')):
            if item.is_dir():shutil.copytree(item,site/item.name,ignore=shutil.ignore_patterns('__pycache__','tests'))
            else:shutil.copy2(item,site/item.name)
    subprocess.run([str(dest/'bin/python3'),'-B','-c','import ssl,sqlite3,cryptography.hazmat.primitives.ciphers.aead'],check=True)
# ATOM device simulator: the real device backend plus every repository app, prebuilt.
atom=base.parents[1];device=resources/'device';skip=shutil.ignore_patterns('__pycache__','*.pyc','.DS_Store')
device.mkdir()
for f in atom.glob('*.py'):shutil.copy2(f,device/f.name)
shutil.copy2(atom/'VERSION',device/'VERSION')
for d in ('static','templates'):shutil.copytree(atom/d,device/d,ignore=skip)
(device/'tools').mkdir()
for f in ('simulator.py','simulator.html'):shutil.copy2(atom/'tools'/f,device/'tools'/f)
subprocess.run(['python3',str(atom/'tools/simulator.py'),'--build-seed',str(device/'seed-apps')],check=True)
info=dict(CFBundleIdentifier='local.atom.connect',CFBundleName='ATOM Connect',CFBundleDisplayName='ATOM Connect',CFBundleExecutable='ATOMConnect',CFBundlePackageType='APPL',CFBundleShortVersionString='0.6.1',CFBundleVersion='20261022.7',LSMinimumSystemVersion='13.0',LSUIElement=True,NSHighResolutionCapable=True,NSAppTransportSecurity={'NSAllowsLocalNetworking':True},CFBundleIconFile='AppIcon')
(app/'Contents/Info.plist').write_bytes(plistlib.dumps(info))
subprocess.run(['swiftc','-O','-framework','AppKit','-framework','WebKit',str(base/'ATOMConnect.swift'),'-o',str(mac/'ATOMConnect')],check=True)
# Original AppKit vector icon; no Apple artwork or external assets.
subprocess.run(['swift',str(base/'Icon.swift'),str(resources)],check=True)
subprocess.run(['codesign','--force','--deep','--sign','-',str(app)],check=True,stdout=subprocess.DEVNULL)
if a.sign_identity:
    entitlements=base/'runtime.entitlements'
    # Sign nested native executables/libraries before the app. Private keys stay in Keychain.
    for item in resources.rglob('*'):
        if item.is_file() and not item.is_symlink() and (item.suffix in ('.so','.dylib') or item.name in ('node','python3')):
            if 'Mach-O' in subprocess.check_output(['file','-b',str(item)],text=True):
                subprocess.run(['codesign','--force','--options','runtime','--timestamp','--sign',a.sign_identity,'--entitlements',str(entitlements),str(item)],check=True)
    subprocess.run(['codesign','--force','--options','runtime','--timestamp','--sign',a.sign_identity,str(app)],check=True)
    subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True)
if a.notary_profile:
    archive=app.with_suffix('.zip')
    subprocess.run(['ditto','-c','-k','--keepParent',str(app),str(archive)],check=True)
    subprocess.run(['xcrun','notarytool','submit',str(archive),'--keychain-profile',a.notary_profile,'--wait'],check=True)
    subprocess.run(['xcrun','stapler','staple',str(app)],check=True)
print(app)
