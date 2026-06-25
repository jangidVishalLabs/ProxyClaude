#!/usr/bin/env bash
#
# security-check.sh — verify a workspace + sshd are hardened (plan §11, §16).
# Run as root ON the VPS:  sudo security-check.sh <pc_user_name>
#
set -uo pipefail

U="${1:?usage: security-check.sh <pc_user_name>}"
H="/home/$U"
fail=0
report() { printf '%-42s %s\n' "$1" "$2"; }
chk() {
  if eval "$2" >/dev/null 2>&1; then report "$1" PASS; else report "$1" FAIL; fail=1; fi
}

SSHD="$(sshd -T 2>/dev/null || true)"
chk "sshd: password auth disabled" "echo \"\$SSHD\" | grep -qi '^passwordauthentication no'"
chk "sshd: root login disabled" "echo \"\$SSHD\" | grep -qiE '^permitrootlogin (no|prohibit-password)'"
chk "user not in privileged group" "! id -nG '$U' | grep -qwE 'sudo|admin|wheel|docker|adm'"
chk "user has no sudo rights" "! sudo -ln -U '$U' 2>/dev/null | grep -qi 'may run'"
chk "home dir is 750" "[ \"\$(stat -c %a '$H')\" = 750 ]"
chk ".ssh is 700" "[ \"\$(stat -c %a '$H/.ssh')\" = 700 ]"
chk "authorized_keys is 600" "[ \"\$(stat -c %a '$H/.ssh/authorized_keys')\" = 600 ]"

echo '---'
if [ "$fail" -eq 0 ]; then
  echo "OK: workspace hardened"
else
  echo "FAIL: hardening issues found"
  exit 1
fi
