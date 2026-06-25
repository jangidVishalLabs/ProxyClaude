#!/usr/bin/env bash
#
# install-key.sh — append a developer's SSH public key to their workspace's
# authorized_keys (plan §7). Idempotent (dedup). Key is read from STDIN to
# avoid argv injection / length limits.
#
# Usage: sudo install-key.sh <username> < pubkey
#
set -euo pipefail

USERNAME="${1:?usage: install-key.sh <username> < pubkey}"
if [[ ! "$USERNAME" =~ ^pc_user_[a-z0-9]+$ ]]; then
  echo "error: invalid username '$USERNAME'" >&2
  exit 2
fi

PUBKEY="$(cat)"
PUBKEY="${PUBKEY//$'\n'/}" # single line
if [[ ! "$PUBKEY" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-[a-z0-9-]+)\  ]]; then
  echo "error: not a valid OpenSSH public key" >&2
  exit 2
fi

HOME_DIR="/home/$USERNAME"
SSH_DIR="$HOME_DIR/.ssh"
AK="$SSH_DIR/authorized_keys"

if ! id -u "$USERNAME" >/dev/null 2>&1; then
  echo "error: user '$USERNAME' does not exist (run create-workspace.sh first)" >&2
  exit 3
fi

install -d -m 700 -o "$USERNAME" -g "$USERNAME" "$SSH_DIR"
touch "$AK"

# Dedup on the full key string.
if ! grep -qxF "$PUBKEY" "$AK" 2>/dev/null; then
  printf '%s\n' "$PUBKEY" >>"$AK"
fi

chown "$USERNAME:$USERNAME" "$AK"
chmod 600 "$AK"

echo "key-installed user=$USERNAME keys=$(wc -l <"$AK")"
