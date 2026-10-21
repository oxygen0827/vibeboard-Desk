#!/bin/sh
# Publish only the public ATOM website; backend API proxy routes remain unchanged.
set -eu
HOST=${1:-root@47.102.197.71}
KEY=${ATOM_SSH_KEY:-$HOME/.ssh/ldcx_ed25519}
SITE=$(cd "$(dirname "$0")/.." && pwd)
RELEASE=$(date -u +%Y%m%dT%H%M%SZ)
COPYFILE_DISABLE=1 tar --no-xattrs -C "$SITE" -czf - index.html guide/index.html assets | ssh -i "$KEY" -o BatchMode=yes "$HOST" "mkdir -p /home/lincaigui/nginx/static/atom-releases/$RELEASE && tar -xzf - -C /home/lincaigui/nginx/static/atom-releases/$RELEASE"
ssh -i "$KEY" -o BatchMode=yes "$HOST" python3 - "$RELEASE" <<'PY'
import pathlib,sys,subprocess,shutil
release=sys.argv[1]
root=pathlib.Path('/home/lincaigui/nginx/static')
link=root/'atom';tmp=root/'atom.new'
if tmp.is_symlink(): tmp.unlink()
tmp.symlink_to('atom-releases/'+release)
tmp.replace(link)
p=pathlib.Path('/home/lincaigui/nginx/nginx.conf');old=p.read_text()
marker='        # ATOM public product website (API routes retain the proxy below)'
block='''        # ATOM public product website (API routes retain the proxy below)
        location = /atom/ { root /static; try_files /atom/index.html =404; add_header Cache-Control "no-cache"; }
        location = /atom/guide { return 308 /atom/guide/; }
        location = /atom/guide/ { root /static; try_files /atom/guide/index.html =404; add_header Cache-Control "no-cache"; }
        location ^~ /atom/assets/ { alias /static/atom/assets/; add_header X-Content-Type-Options "nosniff" always; }
'''
if marker not in old:
    shutil.copy2(str(p),str(p)+'.atom-site-'+release+'.bak')
    # Write in place: the nginx container bind-mounts this exact inode.
    p.write_text(old.replace('        location = /atom {',block+'        location = /atom {',1))
try:
    subprocess.run(['docker','exec','nginx','nginx','-t'],check=True)
except Exception:
    p.write_text(old)
    raise
subprocess.run(['docker','exec','nginx','nginx','-s','reload'],check=True)
print('Published website release '+release)
PY
