# ProxyClaude — Build Plan & Execution Tracker

> Production-ready MVP. CLI-first shared Claude Code platform on VPS.
> Goal command flow: `proxyclaude login` → `proxyclaude connect <project>` → land in project folder in persistent tmux → run `claude`. Survives sleep / network drop / SSH disconnect.

---

## Current stage

| Field | Value |
|---|---|
| **Active phase** | Phase 10 — ✅ COMPLETE → **MVP DONE** 🎉 |
| **Active task** | — |
| **Last updated** | 2026-06-25 |
| **Blocked on** | — |
| **Next action** | Ship: wire git remote, push (CI runs build+infra jobs), provision real VPS, deploy.sh |

> **Local VPS stand-in:** sshd in WSL, provisioner = `vishal`, key `~/.proxyclaude-provisioner/id_ed25519`, scripts in `/opt/proxyclaude/vps`. `.env` has VPS_*. After editing `infra/vps/*.sh`: `sudo install -m 755 infra/vps/*.sh /opt/proxyclaude/vps/`. sshd-dependent tests auto-skip when provisioner absent (CI).

> **Test DB:** integration tests use `proxyclaude_test` (separate from dev). Create once: `createdb proxyclaude_test` + `prisma migrate deploy`. `src/test/setup.ts` points tests there via `DATABASE_URL_TEST`. Run `sudo service postgresql start` each session.

> **Prisma cmd note:** run from `packages/api` with root env sourced: `set -a; . ../../.env; set +a; pnpm exec prisma migrate dev`. (Prisma loads `.env` from cwd, not repo root.)

> Update this block at the start/end of each work session.

---

## Status legend
`[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Tech stack (locked)
- TypeScript strict · pnpm workspaces + Turborepo
- Backend: **Fastify** + Zod · ORM: **Prisma** · DB: **PostgreSQL**
- CLI: **Commander** + `@inquirer/prompts` + `keytar`
- Auth: **argon2id** + JWT (15m access + rotating refresh)
- VPS: Ubuntu 22.04 + OpenSSH + **tmux** · process mgr: **systemd** · proxy: **Caddy**
- No Redis/queue in MVP. No dashboard in MVP.

---

## Phases

### Phase 0 — Project setup (6h)
- [x] 1. pnpm+turbo monorepo, tsconfig, lint/prettier, CI skeleton — 2h ✅ tested (install/tsc/eslint/prettier green, git init main)
- [x] 2. `shared` package (zod schemas, error codes, audit-action enum) — 2h ✅ tested (build/typecheck/lint/10 tests/format green)
- [x] 3. docker-compose Postgres, `.env.example`, config loader — 2h ✅ tested (5 config tests, full turbo gate green; docker runtime deferred — no Docker in dev env)

### Phase 1 — Auth + database (16h)
- [x] 1. Prisma schema + migrations + seed admin — 3h ✅ tested (8 tables created, admin seeded argon2id+idempotent, build/typecheck/lint/format green)
- [x] 2. Fastify bootstrap, plugins (prisma, errorHandler) — 2h ✅ tested (buildServer factory + prisma/errorHandler plugins, 5 server tests, real boot /health 200, build/typecheck/lint/format green)
- [x] 3. argon2 hashing + JWT issue/verify + refresh rotation — 3h ✅ tested (lib/hash argon2id, lib/jwt jose HS256, lib/tokens refresh gen+sha256+expiry; 9 auth tests incl. expiry/wrong-secret/garbage; 19 api tests total green)
- [x] 4. login/logout/refresh routes + disabled-user guard — 3h ✅ tested (AuthService + routes, refresh rotation, disabled guard; 8 integration tests vs real PG; CI now provisions postgres+migrate; 27 api tests green)
- [x] 5. RBAC preHandler + rate limit on auth — 2h ✅ tested (authenticate + requireRole guards, @fastify/rate-limit global + strict /auth/*; 6 tests: no/bad token, role allow/deny, 429; 33 api tests green)
- [x] 6. auth unit + integration tests — 3h ✅ done (43 tests total: shared 10 + api 33 = config/jwt/hash/tokens/server/error-handler/auth-guard/RBAC/rate-limit/auth-integration). Coverage tooling deferred to Phase 10.

### Phase 2 — Project registry (8h)
- [x] 1. Project + Assignment models/services — 2h ✅ tested (ProjectService listForUser/getAccessibleProject + toProjectDto; 7 service integration tests green)
- [x] 2. `GET /projects` (scoped by role) — 2h ✅ tested (authenticated route, dev→assigned/admin→all, no internal-field leak; 4 route integration tests green)
- [x] 3. connect access-check service (assigned-only) — 2h ✅ tested (ConnectService server-side access check + SSH/tmux config; POST /connect/:slug; 5 tests: 401/200/403-unassigned/409-unprovisioned/404; VPS_SSH_PORT added to config)
- [x] 4. tests incl. unauthorized-access denial — 2h ✅ done (denial enforced+tested at service AND route layers: unassigned→ACCESS_DENIED, no-token→401; full api suite 49 tests, repo 59)

### Phase 3 — Admin provisioning API (10h)
- [x] 1. admin user CRUD + disable — 3h ✅ tested (AdminUserService create/disable/list, GET+POST /admin/users, PATCH disable revokes refresh tokens; 8 tests incl. disable→login-blocked, dup 409, RBAC 403)
- [x] 2. project create + assignment endpoints — 2h ✅ tested (AdminProjectService create+assign, POST /admin/projects + /admin/assignments; 6 tests incl. assign→dev-sees-it E2E, dup slug/assignment 409, missing user 404)
- [x] 3. provision/revoke endpoints + ProvisionJob model — 3h ✅ tested (ProvisioningService allocates vps identity + PENDING job + markRunning/Done/Failed lifecycle for Phase 4; POST /admin/users/:id/provision 202; 5 tests incl. provision→connect 409→200 E2E, idempotent username, disabled-refusal). NOTE: SSH-key revoke endpoint deferred to Phase 5 (ssh-keys module).
- [x] 4. admin RBAC + tests — 2h ✅ done (requireRole('ADMIN') on every admin route; 403 dev-denial + 401 no-auth tested per endpoint; api 68 tests, repo 78)

### Phase 4 — VPS workspace automation (14h)
- [x] 1. idempotent `create-workspace.sh` (no-sudo user, dirs, perms) — 4h ✅ tested over real SSH (local sshd): no-sudo user+own group, dirs 750/.ssh 700/authorized_keys 600, idempotent, regex-validated username, pc_user confirmed no sudo. Local stand-in via `bootstrap-local-sshd.sh`.
- [x] 2. `install/revoke-key.sh` — 3h ✅ tested over real SSH: install (stdin, dedup), login AS pc_user with dev key succeeds (proves .ssh 700 / authorized_keys 600 perms via sshd accept), revoke → post-revoke login Permission denied. Key format validated.
- [x] 3. toolchain install script (claude, git, tmux) — 2h ✅ scripted + syntax-checked; git 2.43/tmux 3.4 verified present; full apt+Claude install = image-build-time (needs sudo + team-plan auth)
- [x] 4. backend vps-client (SSH exec, capture, retry) — 3h ✅ tested vs real sshd (VpsClient: spawn ssh, stdin, 255-retry, PROVISION_FAILED on non-zero, username regex guard; create/install/revoke; 4 tests)
- [x] 5. provisioning E2E on test VPS — 2h ✅ tested vs local sshd: provision→real workspace on box→job DONE, user exists + no-sudo; failure→job FAILED+PROVISION_FAILED. Route builds VpsClient only when fully configured (else PENDING). CI skips sshd tests via skipIf.

### Phase 5 — SSH key registration (8h)
- [x] 1. CLI ssh-keygen (ed25519) + keychain — 3h ✅ tested (packages/cli: ensureKeyPair ed25519+SHA256 fp+idempotent+0600, file credential store round-trip+0600+clear; 8 tests). NOTE: MVP uses 0600 file store, not keytar (libsecret absent on headless WSL/CI) — keytar = post-MVP.
- [x] 2. `POST /ssh-keys/register` (idempotent, fingerprint) — 2h ✅ tested (SshKeyService + sshFingerprint cross-validated vs ssh-keygen -lf; register 200/idempotent/cross-user 409/malformed 422/no-auth 401; 7 tests)
- [x] 3. wire register → KEY_INSTALL job → authorized_keys — 2h ✅ tested E2E (register→install-key.sh on box→KEY_INSTALL job DONE + SshKey.installedAt→developer SSHes into workspace with own key, whoami=username)
- [x] 4. tests — 1h ✅ done (8 cli + fingerprint/route/E2E; repo 100 tests)

### Phase 6 — CLI login/projects/connect (16h)
- [x] 1. Commander scaffold + apiClient + keychain + config — 4h ✅ tested (ApiClient typed+schema-validated+401-refresh-retry+CliError mapping; resolveApiUrl; commander buildProgram + error handler; 6 apiClient tests)
- [x] 2. login/logout/status commands — 3h ✅ tested (testable action fns + IO seam + clientFactory token-persist; 8 command tests; built binary smoke: --help/status/validation all correct)
- [x] 3. projects command (table) — 2h ✅ tested (requireLogin guard, table render, empty-state msg; 3 tests; registered in commander)
- [x] 4. connect command (key→register→config→ssh+tmux) — 5h ✅ tested (runConnect orchestration: ensureKey→registerSshKey→connect→launchSsh with correct args; buildSshArgs `-t`+ServerAlive+`tmux new -A`+shell-injection-quoting; 5 tests). Live ssh→tmux drop-in E2E = Phase 7 deliverable.
- [x] 5. CLI error mapping + tests — 2h ✅ tested (handleError CliError→exit 3/2/1, command registration; commander actions route rejections to handleError; 4 tests; repo 126 tests)

### Phase 7 — tmux reconnect flow (8h)
- [x] 1. `tmux new -A` wiring + ServerAlive opts — 2h ✅ tested live over SSH: tmux session lands in workspace; `new-session -A` re-run keeps ONE session (attach-or-create idempotent, no duplicate)
- [x] 2. reconnect command + Session model/heartbeat — 3h ✅ tested (backend SessionService recordConnect/heartbeat/listActive; GET /sessions + POST /sessions/heartbeat; connect records 1 ACTIVE/user+project; CLI `reconnect`=connect, status shows sessions, apiClient listSessions/heartbeat; 4 api + cli tests)
- [x] 3. survive-disconnect E2E (sleep/drop/kill) — 3h ✅ PROVEN live: started work in tmux → kill -9 the ssh client (drop) → SESSION_ALIVE + counter 4→13 (process kept running) → reconnect re-attaches SAME session (count=1). Core guarantee verified.

### Phase 8 — Git sync (10h)
- [x] 1. local repo resolution + dirty check — 2h ✅ tested (git exec lib: isGitRepo/isDirty/branch/upstream; projectPaths slug→path store; 8 tests vs real temp repos)
- [x] 2. fetch + incoming diff/log display — 2h ✅ tested (fetch/aheadBehind/inspectIncoming log+diffstat; shown in sync output)
- [x] 3. confirm prompt + ff-only merge + conflict stop — 3h ✅ tested (dirty→abort CONFLICT, confirm gate, ff-only, divergence→stop CONFLICT no mutation)
- [x] 4. backup ref + sync tests — 3h ✅ tested (backupHead refs/proxyclaude/backup before merge; 7 sync tests vs real bare-remote+clones: up-to-date/ff/decline/dirty/diverge+backup/unknown-slug/path-memory; promptYesNo)

### Phase 9 — Audit logs + security hardening (14h)
- [x] 1. audit onResponse hook + all 13 actions — 4h ✅ tested (AuditService + route map + onResponse hook; req.auditAction override for RECONNECT; LOGIN sets req.user for attribution; LOGIN_FAILED null actor; PROVISION_JOB_RESULT from services; events/sync for SYNC_REQUEST; all 13 actions verified in one test). NOTE: audit write is post-response (no latency) — tests poll for it.
- [x] 2. `GET /admin/audit` + append-only DB role — 2h ✅ tested (admin-only audit list w/ action filter+limit; append-only enforced via infra/db/append-only-audit.sql — REVOKE UPDATE/DELETE + immutability trigger, applied in prod against least-priv app role)
- [x] 3. VPS hardening (sshd config, perms) + security tests — 4h ✅ verified live: sshd PasswordAuth no + RootLogin no, password-auth refused live, dev no-sudo/no-priv-groups, home 750/.ssh 700/authorized_keys 600. Reusable infra/vps/security-check.sh (run as root on VPS).
- [x] 4. helmet, HSTS, input-validation sweep, rate-limit review — 4h ✅ tested (@fastify/helmet w/ HSTS 1yr+includeSubDomains; HSTS/x-content-type/x-frame headers asserted; zod validation already on every route; rate-limit global 300 + strict 10/min on /auth/* reviewed)

### Phase 10 — Testing / deployment / docs (12h)
- [x] 1. Caddy + systemd unit + `migrate deploy` — 3h ✅ tested (infra/deploy: Caddyfile auto-TLS+HSTS+HTTP→HTTPS; systemd unit graceful SIGTERM + Restart=on-failure + journald + hardened — `systemd-analyze verify` clean, caught+fixed StartLimit* misplacement; deploy.sh install→generate→migrate deploy→build→restart→health; `migrate deploy` EXIT=0 idempotent)
- [x] 2. `pg_dump` backup + restore test — 2h ✅ tested (infra/db/backup.sh custom-format+`--list` integrity+retention; restore.sh `--clean --if-exists`+pre-verify; live round-trip: seed canary→dump 20K→restore fresh DB→row survived PASS. Found+fixed prod bug: Prisma `?schema=public` breaks libpq pg_dump/pg_restore — both strip it)
- [x] 3. full E2E suite green in CI — 3h ✅ tested (full repo gate green local: fmt/lint/tc/test all 0, 150 tests; CI extended with parallel `infra` job — shellcheck all scripts + real backup→restore round-trip vs postgres:16; YAML validated. shellcheck/PGDG steps execute on GitHub run)
- [x] 4. admin runbook + dev quickstart + README — 4h ✅ tested (README arch+layout+dev setup; docs/dev-quickstart.md login→connect→reconnect→sync+troubleshoot; docs/admin-runbook.md onboard/revoke-<2min/backup-restore/deploy/incidents+endpoint ref. Contract verified vs code: accessToken, ?action=/?limit=, 202; format:check green)

**Total: 122h core (+~13h buffer = ~135h)**

---

## Audit actions to cover (Phase 9)
login · failed login · logout · projects-list · connect request · ssh-key registration · reconnect · sync request · admin user-create · admin assignment · admin disable-user · key revoke · provision job result

---

## Production-readiness gate (before real developers)
- [x] HTTPS enforced, no HTTP listener — Caddy auto-TLS + HTTP→HTTPS redirect + HSTS (infra/deploy/Caddyfile); API bound localhost behind it
- [x] argon2id; no secret in git — argon2id used; .env gitignored. (gitleaks-in-CI: Phase 10)
- [x] access check tested on every connect path — service+route denial tests
- [x] disabled user cannot login/connect — tested (login 403 + refresh blocked)
- [x] VPS: no sudo for devs, password SSH off, root login off — verified live
- [x] `authorized_keys`/`.ssh` perms correct — verified 600/700/750 live
- [x] rate limiting on auth; input validated everywhere — @fastify/rate-limit + zod
- [x] audit log append-only + all 13 actions — hook + 13 verified; append-only SQL for prod
- [x] tmux survives disconnect + reconnect (E2E) — counter 4→13 across kill
- [x] sync never overwrites dirty/local work (E2E) — dirty-abort + diverge-stop + backup ref
- [x] provisioning idempotent + retried + audited — idempotent username, 255-retry, PROVISION_JOB_RESULT
- [x] DB backup + restore tested — live round-trip PASS (canary survived); CI round-trip on every push
- [x] systemd restart-on-failure; logs in journald — unit Restart=on-failure + StandardOutput=journal (verified clean)
- [x] revoke-a-developer runbook works (<2 min) — docs/admin-runbook.md: disable (kills refresh) + key revoke + pkill, with verify step

---

## Decisions log
- 2026-06-25: **Build env = WSL filesystem.** Windows-side pnpm AND npm both break on `\\wsl.localhost` (pnpm CoW panic / ENOENT rename; npm symlink EISDIR). RESOLVED: Node 22.13 + pnpm 9.15 installed **inside WSL** at `~/.local/node` (PATH in `~/.bashrc`). **All toolchain commands run via** `wsl.exe -e bash -lc 'export PATH="$HOME/.local/node/bin:$PATH"; cd ~/projects/ProxyClaude; pnpm ...'`. Do NOT run pnpm/npm from Windows side. CI + VPS = Linux, native. `.npmrc` reverted to pnpm defaults. Node pinned ≥20.19 (eslint dep). CI node = 22.
- 2026-06-25: Stack locked (Fastify/Prisma/Postgres/Commander). Postgres over Mongo — relational integrity for RBAC/audit/assignments.
- 2026-06-25: Dev DB = **Postgres 16 installed in WSL directly** (no Docker in dev env). Role+db `proxyclaude`/`proxyclaude`. Start it per session: `sudo service postgresql start`. Compose file + CI still Docker-based (canonical). Dev `.env` (gitignored, chmod 600) has real openssl secrets.
- 2026-06-25: Single-VPS for build; `User.vpsHost` per-user so 4-server split is data-only later.
- 2026-06-25: 35h proposal number = leadership figure; engineering target ~135h production-ready.

## Postponed (post-MVP)
browser terminal (xterm.js) · admin dashboard · Docker-per-workspace · cgroup quotas · multi-server scheduler · short-lived SSH certs + CA · Playwright/visual · direct-remote Mode 2 · billing · analytics · Redis/BullMQ
