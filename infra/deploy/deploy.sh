#!/usr/bin/env bash
#
# deploy.sh — build + migrate + restart the ProxyClaude API (plan Phase 10).
# Run on the VPS from the app root (default /opt/proxyclaude/app), as a user that
# can read .env and run `sudo systemctl`. Idempotent and safe to re-run.
#
#   sudo -u proxyclaude bash infra/deploy/deploy.sh
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/proxyclaude/app}"
SERVICE="${SERVICE:-proxyclaude-api}"

cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "FATAL: $APP_DIR/.env missing (needs DATABASE_URL + JWT secrets)" >&2
  exit 1
fi

# Load DATABASE_URL etc. so prisma migrate deploy sees them.
set -a
# shellcheck disable=SC1091
. ./.env
set +a

echo "==> install deps (frozen lockfile)"
pnpm install --frozen-lockfile --prod=false

echo "==> prisma generate"
pnpm --filter @proxyclaude/api exec prisma generate

echo "==> prisma migrate deploy (applies pending migrations, never resets)"
pnpm --filter @proxyclaude/api exec prisma migrate deploy

echo "==> build"
pnpm build

echo "==> restart $SERVICE"
sudo systemctl restart "$SERVICE"
sleep 1
sudo systemctl --no-pager --lines=10 status "$SERVICE" || true

echo "==> health check"
for i in $(seq 1 10); do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null; then
    echo "OK: API healthy"
    exit 0
  fi
  sleep 1
done
echo "FATAL: API did not become healthy; see: journalctl -u $SERVICE -n 50" >&2
exit 1
