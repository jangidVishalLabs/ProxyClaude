# ProxyClaude

CLI-first shared Claude Code platform. Developers run `claude` inside a persistent,
per-user workspace on a managed VPS instead of locally — sessions survive laptop
sleep, network drops, and SSH disconnects.

```
proxyclaude login → proxyclaude connect <project> → land in the project folder
in a persistent tmux session → run claude
```

## How it works

```
 developer laptop                    VPS
┌────────────────┐   HTTPS (Caddy)  ┌──────────────────────────────┐
│ proxyclaude    │ ───────────────▶ │ Fastify API  ──▶ PostgreSQL  │
│   CLI          │   auth/connect   │ (auth, RBAC, audit, provision)│
│                │                  │                              │
│                │   SSH + tmux     │ per-dev no-sudo Linux user   │
│  ssh -t ───────┼────────────────▶ │   ~/projects/<slug>          │
│                │   new-session -A │   tmux ── claude             │
└────────────────┘                  └──────────────────────────────┘
```

- **API** authenticates the dev, checks project assignment (RBAC), installs the
  dev's SSH key into their workspace `authorized_keys`, and returns SSH/tmux
  connect details. Every sensitive action is audited.
- **CLI** generates an ed25519 keypair, registers it, then `ssh -t` into the
  workspace and runs `tmux new-session -A` (attach-or-create) so one durable
  session persists across disconnects.
- **Workspaces** are no-sudo Linux users with hardened perms; the toolchain
  (claude, git, tmux) is baked into the VPS image.

## Tech stack

TypeScript (strict) · pnpm workspaces + Turborepo
Backend: Fastify 5 + Zod · Prisma 6 + PostgreSQL 16 · argon2id + JWT (rotating refresh)
CLI: Commander · ed25519 keys · 0600 file credential store
VPS: Ubuntu + OpenSSH + tmux · systemd · Caddy (auto-TLS)

## Repository layout

```
packages/
  shared/   zod schemas, error codes, audit-action enum (used by api + cli)
  api/      Fastify server, Prisma schema, modules (auth, projects, connect,
            admin, ssh-keys, sessions, events, audit)
  cli/      proxyclaude command (login/logout/status/projects/connect/reconnect/sync)
infra/
  vps/      idempotent workspace provisioning + key install/revoke + hardening checks
  db/       backup.sh / restore.sh / append-only-audit.sql
  deploy/   Caddyfile, systemd unit, deploy.sh
.github/workflows/ci.yml
```

## Documentation

- [docs/dev-quickstart.md](docs/dev-quickstart.md) — install the CLI and connect (developers)
- [docs/admin-runbook.md](docs/admin-runbook.md) — provision, revoke, backup/restore, deploy (admins)

## Local development

All toolchain runs under Node 22 + pnpm 9 with a local PostgreSQL 16.

```bash
cp .env.example .env          # fill in secrets: openssl rand -hex 32
pnpm install
pnpm --filter @proxyclaude/api exec prisma migrate dev
pnpm --filter @proxyclaude/api exec tsx prisma/seed.ts   # first admin
pnpm build
pnpm --filter @proxyclaude/api dev    # API on :3000
```

Quality gate (also enforced in CI): `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`.

> Integration tests use a separate `proxyclaude_test` database via `DATABASE_URL_TEST`.
> Tests that need a live sshd auto-skip when no provisioner is configured (e.g. CI).
# ProxyClaude
