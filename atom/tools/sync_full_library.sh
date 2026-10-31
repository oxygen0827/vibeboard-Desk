#!/bin/sh
# Complete source-library sync; no database backups, cloud snapshots or private app state.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
HOST=${1:-root@47.102.197.71}
KEY=${ATOM_SSH_KEY:-$HOME/.ssh/ldcx_ed25519}
PYTHON=${ATOM_PYTHON:-python3}
WORK=$(mktemp -d /private/tmp/atom-library-XXXXXX)
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
"$PYTHON" "$ROOT/tools/simulator.py" --build-seed "$WORK/seed" --strict-seed
"$PYTHON" "$ROOT/tools/build_full_library.py" --seed "$WORK/seed" --out "$WORK/public" --index "$ROOT/official/library-index.json"
BYTES=$(du -sk "$WORK/public" | awk '{print $1+65536}')
# Staging needs only one temporary transfer copy, never a fresh release/snapshot.
ssh -i "$KEY" -o BatchMode=yes "$HOST" sh -s "$BYTES" <<'REMOTE'
set -eu
FREE=$(df -Pk /opt | awk 'NR==2 {print $4}')
[ "$FREE" -ge "$1" ] || { echo 'Insufficient space for library staging' >&2; exit 1; }
mkdir -p /opt/atom/.library-incoming
chmod 700 /opt/atom/.library-incoming
REMOTE
COPYFILE_DISABLE=1 tar --no-xattrs -czf - -C "$WORK/public" . | ssh -i "$KEY" -o BatchMode=yes "$HOST" 'tar -xzf - -C /opt/atom/.library-incoming'
ssh -i "$KEY" -o BatchMode=yes "$HOST" python3 - < "$ROOT/tools/promote_full_library.py"
"$PYTHON" "$ROOT/site/build_apps.py"
echo 'Cloud library verified; repository index and website catalog rebuilt. Publish the reviewed website catalog and run the multi-device audit before delivery.'
