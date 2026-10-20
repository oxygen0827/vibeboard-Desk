#!/bin/sh
# One-time move of the Mac test relay databases (accounts, pairings, notes, works) to the ldcx server.
# Stop the local relay first. The server's current databases are moved aside, not deleted.
# Usage: atom/connect/server/import-db.sh [user@host]
set -eu
HOST=${1:-root@47.102.197.71}
KEY=${ATOM_SSH_KEY:-$HOME/.ssh/ldcx_ed25519}
SRC="$HOME/Library/Application Support/ATOMConnect"
WORK=$(mktemp -d)
trap 'rm -rf "${WORK:?}"' EXIT

if pgrep -f "connect/relay/server.py" >/dev/null; then
  echo "local relay still running; stop it first" >&2
  exit 1
fi
for n in relay relay.marketplace; do
  python3 - "$SRC/$n.sqlite3" "$WORK/$n.sqlite3" <<'PY'
import sqlite3, sys
src = sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True)
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
assert dst.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
dst.execute('PRAGMA journal_mode=DELETE')
dst.close()
src.close()
print('snapshot ok', sys.argv[2].rsplit('/', 1)[-1])
PY
done

COPYFILE_DISABLE=1 tar --no-xattrs -C "$WORK" -czf - relay.sqlite3 relay.marketplace.sqlite3 \
  | ssh -i "$KEY" -o BatchMode=yes "$HOST" 'set -eu
STAMP=$(date +%Y%m%dT%H%M%S)
IN=/var/lib/atom/import-$STAMP
OLD=/var/lib/atom/pre-import-$STAMP
install -d -o atom -g atom -m 700 "$IN" "$OLD"
tar -xzf - -C "$IN"
chown atom:atom "$IN"/*
chmod 600 "$IN"/*
systemctl stop atom-connect
for f in /var/lib/atom/relay.sqlite3* /var/lib/atom/relay.marketplace.sqlite3*; do [ -e "$f" ] && mv "$f" "$OLD/"; done
cp -p "$IN/relay.sqlite3" "$IN/relay.marketplace.sqlite3" /var/lib/atom/
systemctl start atom-connect
sleep 2
systemctl is-active atom-connect
sudo -u atom python3 /opt/atom/connect/marketplace/ops.py --db /var/lib/atom/relay.marketplace.sqlite3 stats
echo "previous server databases kept in $OLD"'
