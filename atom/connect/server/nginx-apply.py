"""Run on the ldcx host as root: add the /atom/ proxy to the dockerized nginx, test, reload; restores on failure.
Usage from the Mac: ssh -i ~/.ssh/ldcx_ed25519 root@47.102.197.71 python3 - < atom/connect/server/nginx-apply.py"""
import shutil, subprocess, time

C = '/home/lincaigui/nginx/nginx.conf'
ZONE = '    default_type application/octet-stream;\n'
ANCHOR = '        # ===== schedule 团队管理 (9091, teamflow 应用) =====\n'
BLOCK = '''        # ===== ATOM Connect 中继与市场 (9092) =====
        location = /atom { return 308 /atom/; }
        location /atom/ {
            limit_req zone=atom_api burst=40 nodelay;
            limit_req_status 429;
            client_max_body_size 3m;
            proxy_pass http://host.docker.internal:9092/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_connect_timeout 5s;
            proxy_read_timeout 30s;
        }

'''

orig = open(C).read()
if '/atom/' in orig:
    raise SystemExit('already configured, nothing changed')
if orig.count(ZONE) != 1 or orig.count(ANCHOR) != 1:
    raise SystemExit('anchors not unique, nothing changed: %d %d' % (orig.count(ZONE), orig.count(ANCHOR)))
bak = C + '.bak.atom-' + time.strftime('%Y%m%dT%H%M%S')
shutil.copy2(C, bak)
print('backup', bak)
new = orig.replace(ZONE, ZONE + '    limit_req_zone $binary_remote_addr zone=atom_api:10m rate=10r/s;\n', 1).replace(ANCHOR, BLOCK + ANCHOR, 1)


def write(text):
    # Single-file bind mount: rewrite in place so the container keeps seeing the same inode.
    with open(C, 'r+') as f:
        f.seek(0)
        f.write(text)
        f.truncate()


write(new)
test = subprocess.run(['docker', 'exec', 'nginx', 'nginx', '-t'], capture_output=True, text=True)
print(test.stderr.strip())
if test.returncode:
    write(orig)
    raise SystemExit('nginx -t failed: original restored, not reloaded')
reload = subprocess.run(['docker', 'exec', 'nginx', 'nginx', '-s', 'reload'], capture_output=True, text=True)
print('reloaded' if reload.returncode == 0 else 'reload failed: ' + reload.stderr.strip())
