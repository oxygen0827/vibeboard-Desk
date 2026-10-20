#!/bin/sh
# Consistent SQLite snapshots of relay and marketplace, uploaded to a private OSS prefix; keeps 3 local copies.
set -eu
DATA=/var/lib/atom
OUT="$DATA/backups"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$OUT"
python3 /opt/atom/connect/marketplace/ops.py --db "$DATA/relay.marketplace.sqlite3" backup --output "$OUT/market-$STAMP.sqlite3"
python3 - "$DATA/relay.sqlite3" "$OUT/relay-$STAMP.sqlite3" <<'PY'
import sqlite3, sys
src = sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True)
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
assert dst.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
dst.close(); src.close()
PY
tar -C "$OUT" -czf "$OUT/atom-$STAMP.tar.gz" "market-$STAMP.sqlite3" "relay-$STAMP.sqlite3"
rm -f "$OUT/market-$STAMP.sqlite3" "$OUT/relay-$STAMP.sqlite3"
# ossutil 2 reads OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET from the environment, keeping secrets out of argv.
/usr/local/bin/ossutil cp "$OUT/atom-$STAMP.tar.gz" "oss://$OSS_BUCKET/${OSS_PREFIX:-atom/backups}/atom-$STAMP.tar.gz" \
  -e "$OSS_ENDPOINT" --region "${OSS_REGION:-cn-shanghai}"
ls -1t "$OUT"/atom-*.tar.gz | tail -n +4 | xargs -r rm -f
echo "backup ok: atom-$STAMP.tar.gz"
