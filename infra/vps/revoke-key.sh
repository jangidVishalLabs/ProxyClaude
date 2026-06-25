#!/usr/bin/env bash
#
# revoke-key.sh — remove a developer's SSH public key from their workspace's
# authorized_keys (plan §7, §11). Idempotent (no-op if absent). Key read from STDIN.
#
# Usage: sudo revoke-key.sh <username> < pubkey
#
set -euo pipefail

USERNAME="${1:?usage: revoke-key.sh <username> < pubkey}"
if [[ ! "$USERNAME" =~ ^pc_user_[a-z0-9]+$ ]]; then
  echo "error: invalid username '$USERNAME'" >&2
  exit 2
fi

PUBKEY="$(cat)"
PUBKEY="${PUBKEY//$'\n'/}"
if [[ -z "$PUBKEY" ]]; then
  echo "error: empty key" >&2
  exit 2
fi

AK="/home/$USERNAME/.ssh/authorized_keys"
if [[ ! -f "$AK" ]]; then
  echo "key-revoked user=$USERNAME keys=0"
  exit 0
fi

# Drop exact-match lines; keep everything else.
TMP="$(mktemp)"
grep -vxF "$PUBKEY" "$AK" >"$TMP" || true
mv "$TMP" "$AK"
chown "$USERNAME:$USERNAME" "$AK"
chmod 600 "$AK"

echo "key-revoked user=$USERNAME keys=$(wc -l <"$AK")"
