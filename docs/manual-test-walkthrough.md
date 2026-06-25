# Manual test walkthrough — test every feature locally

This proves the whole product on your WSL box, using the **local sshd as the VPS
stand-in** (already set up in Phase 4). Each section maps to a feature. Run top to
bottom — later steps depend on earlier ones.

Two terminals help: **T1** = API + admin (`pc admin …` or raw curl), **T2** = developer
CLI (and a kill window).

> **Admin via CLI.** Admin work is now driven by `pc admin …` subcommands — no raw
> curl or psql needed. The raw-curl recipes are kept below as a reference / fallback.
> The CLI is the recommended path; pick one column per step, don't run both.

---

## 0. One-time session setup (T1)

```bash
# every WSL session needs Postgres up
sudo service postgresql start

cd ~/projects/ProxyClaude
export PATH="$HOME/.local/node/bin:$PATH"

# confirm sshd stand-in is listening on :22
ss -tlnp | grep ':22 ' || echo "START SSHD: sudo service ssh start"

# helpers
export API=http://localhost:3000
source .env                       # gives $ADMIN_EMAIL, $ADMIN_PASSWORD
command -v jq >/dev/null || sudo apt-get install -y jq   # needed for curl parsing
```

Start the API (leave it running in T1, or use `&`):

```bash
node packages/api/dist/index.js
#  → listens on :3000. Logs every request. Ctrl-C to stop.
```

In **T2**, make the CLI callable and start from a clean credential store:

```bash
export PATH="$HOME/.local/node/bin:$PATH"
alias pc='node ~/projects/ProxyClaude/packages/cli/dist/index.js'
rm -rf ~/.proxyclaude          # wipe any prior login/keys for a clean test
pc --help                      # lists: login logout status projects connect reconnect sync admin
pc admin --help                # lists: user project assign key audit onboard
```

> The admin already exists (seeded as `admin@example.com`). Re-seed any time:
> `node --import tsx packages/api/prisma/seed.ts` (run from repo root).

---

## 1. AUTH — login / status / logout / wrong password / refresh

**Admin gets a token** (T1):

```bash
TOKEN=$(curl -fsS -X POST "$API/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | jq -r .accessToken)
auth=(-H "authorization: Bearer $TOKEN")
echo "${TOKEN:0:20}…"          # non-empty = login works
```

**Wrong password is rejected** (expect `401`/`403`, logged as LOGIN_FAILED):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"wrong-password\"}"
```

You'll log in as the **developer via the CLI** later (section 4).

---

## 2. ADMIN — create project, create developer, provision, assign

### 2A. CLI path (recommended)

The admin logs in with the same `pc login` the developers use, then drives everything
with `pc admin …`. Do this in **T1** (or any terminal with `pc` aliased):

```bash
pc login                       # email: $ADMIN_EMAIL  password: $ADMIN_PASSWORD
```

**One-shot onboard** — collapses this whole section into a single command. It creates
the developer, provisions the workspace, creates the project (if missing), points its
`vpsPath` at the new workspace, and assigns the dev:

```bash
pc admin onboard dev@example.com --project demo --create-project --name "Demo Project"
# → prints: temp password, allocated vpsUser (pc_user_xxxxxxxx), project, next steps.
#   Copy the temp password — the developer uses it for `pc login` in section 4.
```

Confirm the OS user really exists, and read the allocated name back any time:

```bash
pc admin user list                       # EMAIL / ROLE / STATUS / VPS USER columns
getent passwd "$(pc admin user list --email dev@example.com | awk 'NR==2{print $NF}')"
```

> Prefer step-by-step? The same result without `onboard`:
> ```bash
> pc admin user create dev@example.com          # auto-generates + prints a temp password
> pc admin user provision dev@example.com       # prints the allocated vpsUser
> pc admin project create demo --name "Demo Project"
> # point the project at the workspace (vpsUser from the provision output):
> pc admin project update demo --vps-path /home/<vpsUser>/projects
> pc admin assign dev@example.com demo
> ```

For sections 5–8 below you'll need the workspace username in a shell var. Grab it:

```bash
VPSUSER=$(pc admin user list --email dev@example.com | awk 'NR==2{print $NF}')
echo "vpsUser=$VPSUSER"
```

### 2B. Raw curl path (reference / fallback)

All in T1 with the `auth` header from section 1.

```bash
# create a project (slug "demo")
PROJECT=$(curl -fsS -X POST "$API/admin/projects" "${auth[@]}" \
  -H 'content-type: application/json' \
  -d '{"slug":"demo","name":"Demo Project","vpsPath":"/tmp/placeholder"}' | jq -r .id)
echo "project=$PROJECT"

# create a developer account
DEV=$(curl -fsS -X POST "$API/admin/users" "${auth[@]}" \
  -H 'content-type: application/json' \
  -d '{"email":"dev@example.com","password":"dev-temp-pass-123","role":"DEVELOPER"}' | jq -r .id)
echo "dev=$DEV"

# provision the developer's VPS workspace (creates a real no-sudo Linux user)
curl -fsS -X POST "$API/admin/users/$DEV/provision" "${auth[@]}" ; echo   # → 202

# read back the allocated VPS username (now also returned in the provision response)
VPSUSER=$(psql "postgresql://proxyclaude:proxyclaude@localhost:5432/proxyclaude" \
  -tAc "SELECT \"vpsUsername\" FROM \"User\" WHERE email='dev@example.com';" | tr -d '[:space:]')
echo "vpsUser=$VPSUSER"        # e.g. pc_user_xxxxxxxx
getent passwd "$VPSUSER"        # confirms the OS user really exists
```

Point the project at the dev's real workspace, then assign:

```bash
# update vpsPath to the dev's projects dir — now a real endpoint (no psql needed)
curl -fsS -X PATCH "$API/admin/projects/$PROJECT" "${auth[@]}" \
  -H 'content-type: application/json' \
  -d "{\"vpsPath\":\"/home/$VPSUSER/projects\"}" ; echo

# assign the dev to the project
curl -fsS -X POST "$API/admin/assignments" "${auth[@]}" \
  -H 'content-type: application/json' \
  -d "{\"userId\":\"$DEV\",\"projectId\":\"$PROJECT\"}" ; echo

# list users (admin view)
curl -fsS "$API/admin/users" "${auth[@]}" | jq '.users[] | {email,role,status,vpsUsername}'
```

> Note: the CLI auto-generates the dev's temp password. If you used the curl path
> (fixed password `dev-temp-pass-123`), use that in section 4 instead.

---

## 3. RBAC — developer cannot hit admin endpoints

```bash
# log the dev in via the API to get a dev token
DTOK=$(curl -fsS -X POST "$API/auth/login" -H 'content-type: application/json' \
  -d '{"email":"dev@example.com","password":"dev-temp-pass-123"}' | jq -r .accessToken)

# dev hitting an admin route must be 403
curl -s -o /dev/null -w 'admin route as dev = %{http_code}\n' \
  "$API/admin/users" -H "authorization: Bearer $DTOK"
```

---

## 4. DEVELOPER CLI — login, projects, scoped visibility

In **T2**:

```bash
pc login                 # email: dev@example.com  password: dev-temp-pass-123
pc status                # shows you + (no sessions yet)
pc projects              # shows ONLY "demo" (scoped to assignments)
```

---

## 5. CONNECT — key gen + register + SSH + tmux landing

Negative cases first:

```bash
# unassigned project → access denied (try a slug you're not assigned to)
pc connect does-not-exist            # → not found / access denied, non-zero exit
```

Now the real connect (T2):

```bash
pc connect demo
```

What happens automatically: ed25519 keypair generated (`~/.ssh/proxyclaude_ed25519`),
public key registered, installed into `$VPSUSER`'s `authorized_keys`, then `ssh -t`
+ `tmux new-session -A -s demo` drops you into a tmux session in
`/home/$VPSUSER/projects`.

Inside the tmux session, verify you're the workspace user:

```bash
whoami            # → pc_user_xxxxxxxx (NOT vishal)
pwd               # → /home/pc_user_xxxxxxxx/projects
id                # confirm NOT in sudo/docker/adm groups
sudo -n true; echo "exit=$?"   # should fail — no sudo for devs
```

Re-run `pc connect demo` in a second T2 — it **attaches the same** session (no
duplicate). That's `new-session -A` (attach-or-create).

---

## 6. PERSISTENCE — survive disconnect (the headline feature)

Inside the tmux session (from section 5), start a counter so you can prove it kept
running:

```bash
i=0; while true; do i=$((i+1)); echo "tick $i"; sleep 1; done
```

Now **simulate a network drop** — from a THIRD terminal (T3), kill the SSH client:

```bash
pkill -f 'ssh -t -i'        # hard-kills your laptop's SSH connection
```

Your T2 session dies. The counter keeps running on the VPS. Re-attach:

```bash
pc reconnect demo
```

You land back in the **same** session — the counter has advanced past where it was
(e.g. you left at tick 5, you're now at tick 20+). Stop it with `Ctrl-C`. Detach
cleanly with `Ctrl-b` then `d` (session keeps running). Confirm one session only:

```bash
pc status        # shows 1 active session for demo
```

---

## 7. SYNC — pull latest, never overwrite local work

Sync operates on a **local clone** on your machine. Build a tiny remote + clone to
test against (T2 or T3):

```bash
# a "remote" and a working clone
rm -rf /tmp/pcsync && mkdir -p /tmp/pcsync && cd /tmp/pcsync
git init -q --bare origin.git
git clone -q origin.git work && cd work
git config user.email t@t; git config user.name t
echo v1 > file.txt && git add -A && git commit -qm init && git branch -M main && git push -q origin main

# push an upstream change from a second clone (simulates a teammate)
cd /tmp/pcsync && git clone -q origin.git other && cd other
git config user.email t@t; git config user.name t
echo v2 >> file.txt && git commit -qam upstream && git push -q
```

**7a. Fast-forward pull** (clean tree, behind upstream):

```bash
pc sync demo --path /tmp/pcsync/work    # first time pass --path; remembered after
# → shows incoming commit + diffstat, asks y/N, ff-only merges. file.txt now has v2.
cat /tmp/pcsync/work/file.txt
```

**7b. Dirty tree aborts** (never clobbers your work):

```bash
echo "uncommitted local edit" >> /tmp/pcsync/work/file.txt
pc sync demo            # → aborts: working tree dirty. Your edit is untouched.
cat /tmp/pcsync/work/file.txt
git -C /tmp/pcsync/work checkout -- file.txt    # clean up
```

**7c. Decline the prompt** (answer N) — nothing changes.

**7d. Divergence stops + leaves a backup ref**:

```bash
# make local and remote diverge
cd /tmp/pcsync/work && echo local-only >> file.txt && git commit -qam local
cd /tmp/pcsync/other && echo remote-only >> file.txt && git commit -qam remote && git push -q
pc sync demo            # → diverged: stops, no mutation
git -C /tmp/pcsync/work show-ref | grep proxyclaude/backup   # backup ref exists
```

---

## 8. REVOKE A DEVELOPER (< 2 min) — disable + key revoke

### 8A. CLI path (recommended)

```bash
pc admin user disable dev@example.com          # blocks login + kills refresh tokens
pc admin key list dev@example.com              # see the key id(s)
pc admin key revoke --user dev@example.com      # revokes their sole active key
#   (or target one explicitly: pc admin key revoke <keyId>)
```

Prove SSH is now refused with that key:

```bash
ssh -i ~/.ssh/proxyclaude_ed25519 -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
  "$VPSUSER@127.0.0.1" whoami 2>&1 | tail -1     # → Permission denied
```

### 8B. Raw curl path (reference / fallback)

Back in T1 (admin):

```bash
# A. disable the account → blocks login + kills refresh tokens
curl -fsS -X PATCH "$API/admin/users/$DEV/disable" "${auth[@]}" ; echo

# login now fails (403)
curl -s -o /dev/null -w 'disabled login = %{http_code}\n' -X POST "$API/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"dev@example.com","password":"dev-temp-pass-123"}'

# B. revoke the dev's SSH key → removed from authorized_keys
KEYID=$(psql "postgresql://proxyclaude:proxyclaude@localhost:5432/proxyclaude" \
  -tAc "SELECT id FROM \"SshKey\" WHERE \"userId\"='$DEV' LIMIT 1;" | tr -d '[:space:]')
curl -fsS -X POST "$API/admin/ssh-keys/$KEYID/revoke" "${auth[@]}" ; echo

# prove SSH is now refused with that key
ssh -i ~/.ssh/proxyclaude_ed25519 -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
  "$VPSUSER@127.0.0.1" whoami 2>&1 | tail -1     # → Permission denied
```

(Re-enabling: there's no un-disable endpoint in the MVP — re-create or flip the DB
field for testing: `UPDATE "User" SET status='ACTIVE' WHERE id='$DEV';`)

---

## 9. AUDIT — every sensitive action is recorded

CLI path:

```bash
pc admin audit --limit 50                 # CREATED_AT  ACTION  RESULT
pc admin audit --action LOGIN_FAILED       # filter one action
```

Raw curl path:

```bash
# re-login as admin if your token expired (15m), then:
curl -fsS "$API/admin/audit?limit=50" "${auth[@]}" \
  | jq -r '.logs[] | "\(.createdAt)  \(.action)  \(.result)"'

# filter one action
curl -fsS "$API/admin/audit?action=LOGIN_FAILED" "${auth[@]}" | jq '.logs | length'
```

You should see LOGIN, LOGIN_FAILED, LOGOUT, PROJECTS_LIST, CONNECT_REQUEST,
RECONNECT, SSH_KEY_REGISTER, SYNC_REQUEST, ADMIN_USER_CREATE, ADMIN_ASSIGNMENT,
ADMIN_DISABLE_USER, SSH_KEY_REVOKE, PROVISION_JOB_RESULT across your test run.

---

## 10. INFRA scripts (optional)

```bash
# DB backup + restore round-trip (proves disaster recovery)
DATABASE_URL="postgresql://proxyclaude:proxyclaude@localhost:5432/proxyclaude" \
  BACKUP_DIR=/tmp/bk bash infra/db/backup.sh "$(date +%Y%m%d-%H%M%S)"
ls -lh /tmp/bk

# workspace hardening check (run as root on the box)
sudo bash infra/vps/security-check.sh "$VPSUSER"     # → OK: workspace hardened
```

The systemd unit / Caddy / deploy.sh are for a real VPS (need systemd + a domain);
they're validated in CI and by `systemd-analyze verify`, not exercised on WSL.

---

## Teardown

```bash
# stop API (Ctrl-C in T1). Remove test pc_user if you like:
sudo userdel -r "$VPSUSER" 2>/dev/null
rm -rf /tmp/pcsync /tmp/bk ~/.proxyclaude
```
