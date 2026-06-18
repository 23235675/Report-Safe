#!/usr/bin/env bash
# ============================================================================
# Back up the Report Safe PostgreSQL database (Azure Database for PostgreSQL).
#
# Timestamped, compressed custom-format dump + prune older than RETENTION_DAYS.
# Reads PG* env vars (or DATABASE_URL via pg_dump's own parsing).
#
# Cron example (daily 02:30, keep 14 days, off-box path):
#   30 2 * * *  PGPASSWORD=… /opt/report-safe/scripts/backup-db.sh /mnt/backups 14
#
# Store backups OFF the app host (Azure Blob, separate volume) — a backup that
# dies with the VM is not a backup.
# ============================================================================
set -euo pipefail

OUT_DIR="${1:-./backups}"
RETENTION_DAYS="${2:-14}"

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-reportsafe}"
PGDATABASE="${PGDATABASE:-reportsafe}"

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/reportsafe-$STAMP.dump"

echo "[backup] pg_dump ${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE} -> $FILE"
pg_dump --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" \
        --format=custom --no-owner --no-privileges --file="$FILE"

SIZE="$(du -h "$FILE" | cut -f1)"
echo "[backup] wrote $FILE ($SIZE)"

# Prune old backups.
find "$OUT_DIR" -name 'reportsafe-*.dump' -type f -mtime "+${RETENTION_DAYS}" -print -delete \
  | sed 's/^/[backup] pruned /' || true

echo "[backup] done."
