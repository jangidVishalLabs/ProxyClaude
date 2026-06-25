#!/usr/bin/env bash
#
# backup.sh — nightly logical backup of the ProxyClaude database (plan Phase 10).
# Custom-format dump (pg_restore-able, compressed). Run from cron as the db user:
#
#   0 3 * * *  /opt/proxyclaude/app/infra/db/backup.sh
#
# Reads DATABASE_URL from the env (or sources $APP_DIR/.env). Keeps RETENTION_DAYS
# of dumps in BACKUP_DIR.
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/proxyclaude/app}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/proxyclaude}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="${1:?usage: backup.sh <timestamp>  (e.g. backup.sh \"\$(date +%Y%m%d-%H%M%S)\")}"

if [ -z "${DATABASE_URL:-}" ] && [ -f "$APP_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$APP_DIR/.env"
  set +a
fi
: "${DATABASE_URL:?DATABASE_URL not set}"

mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/proxyclaude-$STAMP.dump"

# Prisma's DATABASE_URL carries ?schema=public, which libpq (pg_dump) rejects.
# Strip the query string before handing the URL to pg_dump.
PG_URL="${DATABASE_URL%%\?*}"

# -Fc = custom format (compressed, selective restore). --no-owner for portable restore.
pg_dump --format=custom --no-owner --dbname="$PG_URL" --file="$OUT"

# Fail loudly if the dump is empty/corrupt.
pg_restore --list "$OUT" >/dev/null

echo "OK: $OUT ($(du -h "$OUT" | cut -f1))"

# Prune old dumps.
find "$BACKUP_DIR" -name 'proxyclaude-*.dump' -mtime "+$RETENTION_DAYS" -delete
