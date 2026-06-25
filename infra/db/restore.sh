#!/usr/bin/env bash
#
# restore.sh — restore a ProxyClaude dump into a target database (plan Phase 10).
# DESTRUCTIVE: --clean drops existing objects before recreating. Confirm the
# target before running in production.
#
#   infra/db/restore.sh <dump-file> <target-db-url>
#
# Example (disaster recovery into the live DB):
#   infra/db/restore.sh /var/backups/proxyclaude/proxyclaude-20260625-030000.dump "$DATABASE_URL"
#
set -euo pipefail

DUMP="${1:?usage: restore.sh <dump-file> <target-db-url>}"
TARGET="${2:?usage: restore.sh <dump-file> <target-db-url>}"

[ -f "$DUMP" ] || { echo "FATAL: dump not found: $DUMP" >&2; exit 1; }

# Verify the archive is readable before touching the target.
pg_restore --list "$DUMP" >/dev/null

# Prisma's DATABASE_URL carries ?schema=public, which libpq rejects — strip it.
PG_TARGET="${TARGET%%\?*}"

# --clean --if-exists: idempotent recreate. --no-owner: don't require original roles.
# Exit code is non-zero on hard failure; benign "already exists" notices are ignored
# by --if-exists.
pg_restore --clean --if-exists --no-owner --dbname="$PG_TARGET" "$DUMP"

echo "OK: restored $DUMP -> $TARGET"
