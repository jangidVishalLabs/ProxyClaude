#!/usr/bin/env bash
#
# install-toolchain.sh — ensure the VPS has the developer toolchain (plan §5).
# Intended to run ONCE at VPS image-build time (not per developer), as root.
# Idempotent.
#
#   git, tmux  -> required for persistent sessions + the Git bridge
#   Claude Code -> the whole point; installed here if Node/npm is present,
#                  otherwise install it during image build with team-plan auth.
#
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "==> system packages (git, tmux, curl)"
apt-get update -qq
apt-get install -y git tmux curl ca-certificates >/dev/null

echo "toolchain: git=$(git --version) tmux=$(tmux -V)"

echo "==> Claude Code CLI"
if command -v npm >/dev/null 2>&1; then
  if npm install -g @anthropic-ai/claude-code >/dev/null 2>&1; then
    echo "claude: $(claude --version 2>/dev/null || echo installed)"
  else
    echo "claude: npm install failed — install Claude Code during image build" >&2
  fi
else
  echo "claude: skipped (no npm on PATH) — install Node + Claude Code at image build" >&2
fi
