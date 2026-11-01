#!/bin/sh
# Deploy 像素办公室 + office-control shell bridge to the gray ATOM over SSH.
# Run from the repository root on the Mac:  sh atom/tools/deploy_office.sh
# Backs up app.js/server.py, patches idempotently, restarts only the backend and kiosk browser
# (never LightDM), installs or updates the app through the device's own installer.
set -eu
KEY="${ATOM_SSH_KEY:-$HOME/.ssh/atom_gray_friend}"
TARGET="${ATOM_SSH_TARGET:-linaro@150.158.146.192}"
PORT="${ATOM_SSH_PORT:-6278}"
# One multiplexed connection: the FRP tunnel drops rapid back-to-back SSH handshakes.
OPTS="-i $KEY -o BatchMode=yes -o ConnectTimeout=20 -o ControlMaster=auto -o ControlPersist=300 -o ControlPath=${TMPDIR:-/tmp}/atom-office-%C"
SSH="ssh -p $PORT $OPTS"
cd "$(dirname "$0")/../.."
python3 atom/official/agent-office/build.py
echo '== copy'
$SSH "$TARGET" 'rm -rf /tmp/agent-office && mkdir -p /tmp/agent-office'
scp -q -P "$PORT" $OPTS atom/official/agent-office/bundle.json atom/tools/patch_office_shell.py "$TARGET":/tmp/agent-office/
echo '== device'
$SSH "$TARGET" 'sh -s' <<'REMOTE'
set -eu
cd /home/linaro/atom
H='Origin: http://127.0.0.1:8770'; J='Content-Type: application/json'
echo "hostname: $(hostname)  core: $(curl -fsS http://127.0.0.1:8770/api/health)"
DEV=$(curl -fsS http://127.0.0.1:8770/api/developer)
echo "developer: $DEV"
case "$DEV" in *'"enabled": true'*|*'"enabled":true'*) ;; *) echo 'STOP: 开发模式未开启。请在小电脑「设置 → 系统工具 → 开发模式」手动打开后重试。'; exit 3;; esac
STAMP=$(date +%Y%m%d-%H%M%S)
if ! grep -q 'office-control bridge v2' static/app.js; then
  cp -p static/app.js "static/app.js.before-office-$STAMP"; cp -p server.py "server.py.before-office-$STAMP"
  echo "backup: *.before-office-$STAMP"
fi
python3 /tmp/agent-office/patch_office_shell.py /home/linaro/atom
python3 -m py_compile server.py
# Restart only the backend (systemd Restart=always, runs as linaro).
pkill -f '/home/linaro/atom/server.py' || true
i=0; until curl -fsS http://127.0.0.1:8770/api/health >/dev/null 2>&1; do i=$((i+1)); [ $i -lt 30 ] || { echo 'backend did not come back'; exit 4; }; sleep 1; done
echo 'backend: up'
if curl -fsS http://127.0.0.1:8770/api/apps | grep -q '"agent-office"'; then ACTION=update; else ACTION=install; fi
curl -fsS -H "$H" -H "$J" --data-binary @/tmp/agent-office/bundle.json "http://127.0.0.1:8770/api/apps/$ACTION" | head -c 200; echo " ($ACTION)"
# Reload the kiosk page so the new shell bridge is loaded; the session loop restarts the browser.
pkill -f chromium-bin || true
sleep 6
pgrep -f chromium-bin >/dev/null && echo 'kiosk: restarted' || echo 'kiosk: not running yet (session restarts it)'
REMOTE
echo '== done'
