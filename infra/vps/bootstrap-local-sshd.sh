#!/usr/bin/env bash
#
# bootstrap-local-sshd.sh — DEV ONLY. Turns this WSL box into a local stand-in
# for the production VPS so Phase 4 provisioning can be tested end-to-end.
#
# Run from the repo root:   sudo bash infra/vps/bootstrap-local-sshd.sh
#
# It: installs openssh-server (key-only), installs the provisioning scripts to
# /opt/proxyclaude/vps, grants the provisioner NOPASSWD sudo for ONLY those
# scripts, and creates a provisioner SSH key the backend uses to connect.
#
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "run with sudo: sudo bash infra/vps/bootstrap-local-sshd.sh" >&2
  exit 1
fi

PROVISIONER_USER="${SUDO_USER:-$(whoami)}"
REPO_DIR="$(pwd)"

echo "==> installing openssh-server"
apt-get update -qq
apt-get install -y openssh-server >/dev/null

echo "==> configuring sshd (key-only, no root)"
mkdir -p /etc/ssh/sshd_config.d
cat >/etc/ssh/sshd_config.d/proxyclaude.conf <<'EOF'
PasswordAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
EOF
ssh-keygen -A >/dev/null 2>&1 || true
service ssh restart 2>/dev/null || service ssh start

echo "==> installing provisioning scripts to /opt/proxyclaude/vps"
install -d -m 755 /opt/proxyclaude/vps
install -m 755 "$REPO_DIR"/infra/vps/create-workspace.sh /opt/proxyclaude/vps/
install -m 755 "$REPO_DIR"/infra/vps/install-key.sh /opt/proxyclaude/vps/ 2>/dev/null || true
install -m 755 "$REPO_DIR"/infra/vps/revoke-key.sh /opt/proxyclaude/vps/ 2>/dev/null || true

echo "==> granting $PROVISIONER_USER NOPASSWD sudo for the vps scripts only"
cat >/etc/sudoers.d/proxyclaude <<EOF
$PROVISIONER_USER ALL=(root) NOPASSWD: /opt/proxyclaude/vps/create-workspace.sh, /opt/proxyclaude/vps/install-key.sh, /opt/proxyclaude/vps/revoke-key.sh
EOF
chmod 440 /etc/sudoers.d/proxyclaude
visudo -cf /etc/sudoers.d/proxyclaude >/dev/null

echo "==> creating provisioner SSH key for the backend"
KEYDIR="/home/$PROVISIONER_USER/.proxyclaude-provisioner"
install -d -m 700 -o "$PROVISIONER_USER" -g "$PROVISIONER_USER" "$KEYDIR"
if [[ ! -f "$KEYDIR/id_ed25519" ]]; then
  sudo -u "$PROVISIONER_USER" ssh-keygen -t ed25519 -N "" -f "$KEYDIR/id_ed25519" -C proxyclaude-provisioner >/dev/null
fi

echo "==> authorizing the provisioner key for $PROVISIONER_USER@localhost"
SSH_DIR="/home/$PROVISIONER_USER/.ssh"
install -d -m 700 -o "$PROVISIONER_USER" -g "$PROVISIONER_USER" "$SSH_DIR"
touch "$SSH_DIR/authorized_keys"
if ! grep -qFf "$KEYDIR/id_ed25519.pub" "$SSH_DIR/authorized_keys"; then
  cat "$KEYDIR/id_ed25519.pub" >>"$SSH_DIR/authorized_keys"
fi
chown "$PROVISIONER_USER:$PROVISIONER_USER" "$SSH_DIR/authorized_keys"
chmod 600 "$SSH_DIR/authorized_keys"

echo
echo "DONE. Add these to your .env:"
echo "  VPS_HOST=127.0.0.1"
echo "  VPS_SSH_PORT=22"
echo "  VPS_PROVISIONER_USER=$PROVISIONER_USER"
echo "  VPS_PROVISIONER_KEY_PATH=$KEYDIR/id_ed25519"
echo
echo "NOTE: after editing infra/vps/*.sh, re-copy them:"
echo "  sudo install -m 755 infra/vps/*.sh /opt/proxyclaude/vps/"
