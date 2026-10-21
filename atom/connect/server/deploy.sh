#!/bin/sh
# Upload the relay/marketplace service to the server and (re)start it. Does not touch nginx or OSS credentials.
# Usage: atom/connect/server/deploy.sh [user@host]   (SSH key auth; default root@47.102.197.71 with ~/.ssh/ldcx_ed25519)
set -eu
HOST=${1:-root@47.102.197.71}
KEY=${ATOM_SSH_KEY:-$HOME/.ssh/ldcx_ed25519}
ATOM=$(cd "$(dirname "$0")/../.." && pwd)
SSH="ssh -i $KEY -o BatchMode=yes"
RELEASE=$(date -u +%Y%m%dT%H%M%SZ)

COPYFILE_DISABLE=1 tar --no-xattrs -C "$ATOM" --exclude '__pycache__' --exclude 'test_*.py' -czf - connect/relay connect/marketplace connect/server official experiences \
  | $SSH "$HOST" "mkdir -p /opt/atom/releases/$RELEASE && tar -xzf - -C /opt/atom/releases/$RELEASE"

$SSH "$HOST" sh -s "$RELEASE" <<'REMOTE'
set -eu
RELEASE=$1
PYTHONPATH=/opt/atom/python-deps python3 -c 'from PIL import Image' || { echo "Install Pillow with connect/server/requirements.txt into /opt/atom/python-deps before deploying" >&2; exit 1; }
id atom >/dev/null 2>&1 || useradd --system --home-dir /var/lib/atom --shell /sbin/nologin atom
install -d -o atom -g atom -m 0700 /var/lib/atom /var/lib/atom/backups
install -d -o root -g root -m 0700 /etc/atom
chown -R root:root /opt/atom/releases/$RELEASE
chmod -R go-w /opt/atom/releases/$RELEASE
chmod 755 /opt/atom /opt/atom/releases
for d in connect official experiences; do ln -sfn releases/$RELEASE/$d /opt/atom/$d.new && mv -Tf /opt/atom/$d.new /opt/atom/$d; done
install -m 0644 /opt/atom/connect/server/atom-connect.service /opt/atom/connect/server/atom-connect-backup.service /opt/atom/connect/server/atom-connect-backup.timer /opt/atom/connect/server/atom-connect-monitor.service /opt/atom/connect/server/atom-connect-monitor.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable atom-connect.service >/dev/null
systemctl restart atom-connect.service
sleep 1
systemctl is-active atom-connect.service
curl -fsS http://172.17.0.1:9092/market/v1/health && echo
if [ -f /etc/atom/oss.env ]; then systemctl enable --now atom-connect-backup.timer >/dev/null; echo "backup timer on"; else echo "no /etc/atom/oss.env: backup timer not enabled"; fi
systemctl enable --now atom-connect-monitor.timer >/dev/null
if [ -f /etc/atom/smtp.env ]; then echo "monitor on, alerts by email"; else echo "monitor on; no /etc/atom/smtp.env: alerts and account email disabled"; fi
ls -1dt /opt/atom/releases/* | tail -n +4 | xargs -r rm -rf
echo "deployed $RELEASE"
REMOTE
