#!/usr/bin/env bash
#
# create-workspace.sh — idempotently create an isolated, NO-SUDO developer
# workspace on the VPS (plan §6, §11). Safe to re-run.
#
# Usage: sudo create-workspace.sh <username>
#   <username> must match: pc_user_<alnum>   (enforced below)
#
set -euo pipefail

USERNAME="${1:?usage: create-workspace.sh <username>}"

# Strict whitelist on the username — this value reaches adduser/chown.
if [[ ! "$USERNAME" =~ ^pc_user_[a-z0-9]+$ ]]; then
  echo "error: invalid username '$USERNAME' (must match ^pc_user_[a-z0-9]+\$)" >&2
  exit 2
fi

HOME_DIR="/home/$USERNAME"

# 1. Create the user if missing: no password (key-only), own primary group.
if ! id -u "$USERNAME" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$USERNAME" >/dev/null
fi

# 2. Defense in depth: ensure the user is NOT in any privilege group.
for grp in sudo admin adm wheel docker; do
  deluser "$USERNAME" "$grp" >/dev/null 2>&1 || true
done

# 3. Directory layout with strict ownership + permissions.
install -d -m 750 -o "$USERNAME" -g "$USERNAME" "$HOME_DIR"
install -d -m 700 -o "$USERNAME" -g "$USERNAME" "$HOME_DIR/.ssh"
install -d -m 750 -o "$USERNAME" -g "$USERNAME" "$HOME_DIR/projects"
install -d -m 750 -o "$USERNAME" -g "$USERNAME" "$HOME_DIR/.proxyclaude"

# 4. authorized_keys must exist with 600 so install-key.sh can append.
touch "$HOME_DIR/.ssh/authorized_keys"
chown "$USERNAME:$USERNAME" "$HOME_DIR/.ssh/authorized_keys"
chmod 600 "$HOME_DIR/.ssh/authorized_keys"

echo "workspace-ready user=$USERNAME home=$HOME_DIR"
