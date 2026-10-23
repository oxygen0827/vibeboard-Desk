#!/bin/sh
# SQLite file backups only. No ECS snapshot API. Keep 3 local and 3 OSS archives.
set -eu
umask 077
DATA=/var/lib/atom
OUT="$DATA/backups"
SCRIPT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "$OUT"
exec 9>"$OUT/.backup.lock"
flock -n 9 || { echo 'backup already running; skipped'; exit 0; }
# Pruning does not create or upload a backup; safe to run during maintenance.
if [ "${1:-}" = --prune-only ]; then
    exec python3 "$SCRIPT/backup_retention.py" prune --local "$OUT"
fi
python3 "$SCRIPT/backup_retention.py" check
TODAY=$(date -u +%Y%m%d)
if [ -f "$OUT/last-success" ]; then
    LAST=$(cat "$OUT/last-success")
    case "$LAST" in ''|*[!0-9]*) echo 'invalid backup timestamp' >&2; exit 1;; esac
    if [ "$(date -u -d "@$LAST" +%Y%m%d)" = "$TODAY" ]; then
        python3 "$SCRIPT/backup_retention.py" prune --local "$OUT"
        echo 'backup already succeeded today; skipped'
        exit 0
    fi
fi
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=$(mktemp -d "$OUT/.backup-work-XXXXXX")
trap 'rm -rf -- "$WORK"' EXIT HUP INT TERM
python3 /opt/atom/connect/marketplace/ops.py --db "$DATA/relay.marketplace.sqlite3" backup --output "$WORK/market-$STAMP.sqlite3"
python3 - "$DATA/relay.sqlite3" "$WORK/relay-$STAMP.sqlite3" <<'PY'
import sqlite3, sys
src = sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True)
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
assert dst.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
dst.close(); src.close()
PY
tar -C "$WORK" -czf "$WORK/atom-$STAMP.tar.gz" "market-$STAMP.sqlite3" "relay-$STAMP.sqlite3"
# Never prune old recovery points before the new upload succeeds.
/usr/local/bin/ossutil cp "$WORK/atom-$STAMP.tar.gz" "oss://$OSS_BUCKET/${OSS_PREFIX:-atom/backups}/atom-$STAMP.tar.gz" \
  -e "$OSS_ENDPOINT" --region "${OSS_REGION:-cn-shanghai}"
mv "$WORK/atom-$STAMP.tar.gz" "$OUT/atom-$STAMP.tar.gz"
python3 "$SCRIPT/backup_retention.py" prune --local "$OUT"
date +%s > "$OUT/last-success"
echo "backup ok: atom-$STAMP.tar.gz (retention: 3 local, 3 OSS)"
