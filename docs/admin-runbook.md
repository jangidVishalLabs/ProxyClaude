# Admin runbook

Operational procedures for running ProxyClaude in production. The MVP has no admin
dashboard — admins drive the API over HTTPS with `curl`.

> All admin endpoints require `ADMIN` role and a Bearer access token. Every action
> below is recorded in the append-only audit log.

## Get an admin token

```bash
export API=https://api.example.com

TOKEN=$(curl -fsS -X POST "$API/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"…"}' | jq -r .accessToken)

auth=(-H "authorization: Bearer $TOKEN")
```

Access tokens are short-lived (default 15m). Re-run login when calls start returning 401.

---

## Onboard a developer

```bash
# 1. Create the account
DEV=$(curl -fsS -X POST "$API/admin/users" "${auth[@]}" \
  -H 'content-type: application/json' \
  -d '{"email":"dev@example.com","password":"<temp-pass-min-12>","role":"DEVELOPER"}' | jq -r .id)

# 2. Provision their VPS workspace (allocates a no-sudo Linux user; async job)
curl -fsS -X POST "$API/admin/users/$DEV/provision" "${auth[@]}"   # → 202 Accepted

# 3. Assign them to a project
curl -fsS -X POST "$API/admin/assignments" "${auth[@]}" \
  -H 'content-type: application/json' \
  -d "{\"userId\":\"$DEV\",\"projectId\":\"<project-id>\"}"
```

The developer then follows [dev-quickstart.md](dev-quickstart.md): `login` → `connect`.
Key install into their `authorized_keys` happens automatically on first `connect`.

### Create a project

```bash
curl -fsS -X POST "$API/admin/projects" "${auth[@]}" \
  -H 'content-type: application/json' \
  -d '{"slug":"alpha","name":"Alpha","vpsPath":"/home/<user>/projects/alpha"}'
```

---

## Revoke a developer (target: < 2 minutes)

Two independent levers — use both for a full lockout.

```bash
# A. Disable the account: blocks login AND revokes all refresh tokens immediately.
curl -fsS -X PATCH "$API/admin/users/$DEV/disable" "${auth[@]}"

# B. Revoke their SSH key(s): removes the public key from workspace authorized_keys,
#    so existing/future SSH sessions can't re-authenticate.
#    Find the key id from the audit log or DB, then:
curl -fsS -X POST "$API/admin/ssh-keys/<key-id>/revoke" "${auth[@]}"
```

- Disable alone stops all new logins/connects and kills refresh-token rotation.
- Key revoke alone stops SSH access to the workspace.
- A developer already attached over SSH keeps that live TCP session until it drops;
  to force them off, also kill their workspace sessions on the VPS:
  `sudo pkill -KILL -u <vps-username>` (or stop sshd for that user).

Verify the lockout:

```bash
# login should now 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/auth/login" \
  -H 'content-type: application/json' -d '{"email":"dev@example.com","password":"…"}'
```

---

## Database backup & restore

Backups are custom-format `pg_dump` archives (compressed, integrity-checked).

```bash
# Nightly backup (cron, as the db user). Pass a timestamp.
infra/db/backup.sh "$(date +%Y%m%d-%H%M%S)"
#   → /var/backups/proxyclaude/proxyclaude-<stamp>.dump, prunes older than 14 days
```

Suggested crontab:

```
0 3 * * *  APP_DIR=/opt/proxyclaude/app /opt/proxyclaude/app/infra/db/backup.sh "$(date +\%Y\%m\%d-\%H\%M\%S)"
```

Restore (disaster recovery — **destructive**, recreates objects):

```bash
infra/db/restore.sh /var/backups/proxyclaude/proxyclaude-<stamp>.dump "$DATABASE_URL"
```

Both scripts strip Prisma's `?schema=public` from the URL before calling pg_dump/
pg_restore. Test restores into a scratch DB periodically — CI runs a backup→restore
round-trip on every push.

---

## Deploy / upgrade

The API runs under systemd (`proxyclaude-api`), fronted by Caddy (auto-TLS).

```bash
# On the VPS, from /opt/proxyclaude/app, after pulling new code:
sudo -u proxyclaude bash infra/deploy/deploy.sh
#   install (frozen) → prisma generate → prisma migrate deploy → build → restart → health check
```

First-time setup:

```bash
sudo cp infra/deploy/proxyclaude-api.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now proxyclaude-api
sudo cp infra/deploy/Caddyfile /etc/caddy/Caddyfile   # edit the FQDN first
sudo systemctl reload caddy
# apply audit-log immutability (run once, as a superuser, against the app DB):
psql "$DATABASE_URL" -f infra/db/append-only-audit.sql
```

---

## Observability & incidents

```bash
sudo systemctl status proxyclaude-api          # state
journalctl -u proxyclaude-api -n 100 -f        # live logs (journald)
sudo systemctl restart proxyclaude-api         # manual restart (auto-restarts on failure)
```

Audit trail (admin-only, append-only):

```bash
curl -fsS "$API/admin/audit?limit=100" "${auth[@]}" | jq .
curl -fsS "$API/admin/audit?action=LOGIN_FAILED" "${auth[@]}" | jq .
```

Workspace hardening can be re-verified any time (run as root on the VPS):

```bash
sudo bash infra/vps/security-check.sh <vps-username>
```

---

## Quick reference — admin endpoints

| Method | Path                         | Purpose                                 |
| ------ | ---------------------------- | --------------------------------------- |
| POST   | `/auth/login`                | obtain access + refresh tokens          |
| GET    | `/admin/users`               | list users                              |
| POST   | `/admin/users`               | create user                             |
| PATCH  | `/admin/users/:id/disable`   | disable account + revoke refresh tokens |
| POST   | `/admin/users/:id/provision` | provision VPS workspace (202)           |
| POST   | `/admin/projects`            | create project                          |
| POST   | `/admin/assignments`         | assign user → project                   |
| POST   | `/admin/ssh-keys/:id/revoke` | revoke an SSH key                       |
| GET    | `/admin/audit`               | read audit log (`?action=`, `?limit=`)  |
