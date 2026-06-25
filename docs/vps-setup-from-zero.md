# ProxyClaude — VPS setup from zero (beginner guide)

End-to-end: stand up ProxyClaude on a fresh Ubuntu VPS, use it as the admin, and get
your developers connected. No prior ProxyClaude knowledge assumed.

## What you're building

```
 developer laptop                         your VPS (one Ubuntu box)
┌──────────────┐   HTTPS (Caddy, TLS)   ┌──────────────────────────────────────┐
│ proxyclaude  │ ─────────────────────▶ │ Caddy :443 → Fastify API :3000        │
│   CLI        │   login / connect      │ PostgreSQL 16                          │
│              │                        │ provisioner account (NOPASSWD sudo)    │
│  ssh + tmux  │ ─────────────────────▶ │   creates pc_user_* workspaces         │
└──────────────┘                        │   each: ~/projects, tmux, claude       │
                                        └──────────────────────────────────────┘
```

Everything runs on **one VPS**: the API, the database, and the developer workspaces.
The API talks to the workspaces over local SSH (`127.0.0.1`).

## Before you start — what you need

- A VPS: Ubuntu 22.04/24.04, ≥ 2 GB RAM, root or `sudo` access.
- A domain name (e.g. `api.yourcompany.com`) with an **A record pointing at the VPS IP**.
  Caddy needs this to get a free HTTPS certificate.
- Ports **80** and **443** open to the world; **22** open (or your SSH port).
- Comfort with copy-pasting shell commands. That's it.

Conventions used below:
- `$` = run as your normal sudo user.
- App lives in `/opt/proxyclaude/app`. The API runs as a system user `proxyclaude`.
- Replace `api.yourcompany.com` with your real domain everywhere.

---

# PART A — Prepare the server

### A1. Base packages

```bash
sudo apt-get update
sudo apt-get install -y git curl ca-certificates gnupg openssh-server tmux jq postgresql
```

### A2. Node 22 + pnpm

```bash
# Node 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo corepack enable
corepack prepare pnpm@9 --activate
node -v && pnpm -v        # expect v22.x and 9.x
```

### A3. Caddy (reverse proxy + automatic HTTPS)

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

### A4. The `proxyclaude` service user + app directory

```bash
sudo useradd --system --create-home --home-dir /opt/proxyclaude --shell /bin/bash proxyclaude
sudo mkdir -p /opt/proxyclaude/app
sudo chown -R proxyclaude:proxyclaude /opt/proxyclaude
```

### A5. Get the code

```bash
sudo -u proxyclaude git clone https://github.com/wisdmlabs/ProxyClaude.git /opt/proxyclaude/app
cd /opt/proxyclaude/app
```

(If your repo is private, set up a deploy key or use HTTPS with a token.)

---

# PART B — Database

### B1. Create the database + user

```bash
sudo -u postgres psql <<'SQL'
CREATE USER proxyclaude WITH PASSWORD 'PUT-A-STRONG-DB-PASSWORD-HERE';
CREATE DATABASE proxyclaude OWNER proxyclaude;
SQL
```

PostgreSQL on the same box listens on `localhost:5432` by default — good, keep it
local.

---

# PART C — Configure the API

### C1. Write the `.env`

```bash
cd /opt/proxyclaude/app
sudo -u proxyclaude cp .env.example .env
# generate two strong secrets:
openssl rand -hex 32      # copy → JWT_ACCESS_SECRET
openssl rand -hex 32      # copy → JWT_REFRESH_SECRET
sudo -u proxyclaude nano .env
```

Fill it in like this (the provisioner block is wired in Part D):

```ini
NODE_ENV=production
PORT=3000

DATABASE_URL=postgresql://proxyclaude:PUT-A-STRONG-DB-PASSWORD-HERE@localhost:5432/proxyclaude?schema=public

JWT_ACCESS_SECRET=<paste first openssl value>
JWT_REFRESH_SECRET=<paste second openssl value>
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL_DAYS=30

# your first admin login — you'll use these in Part F
ADMIN_EMAIL=admin@yourcompany.com
ADMIN_PASSWORD=pick-a-strong-admin-password-min-12

# provisioner — filled in Part D
VPS_HOST=127.0.0.1
VPS_SSH_PORT=22
VPS_PROVISIONER_USER=pc_provisioner
VPS_PROVISIONER_KEY_PATH=/opt/proxyclaude/app/secrets/provisioner_ed25519
```

```bash
sudo chmod 600 /opt/proxyclaude/app/.env      # secrets — keep it locked down
```

### C2. Install, migrate, build, seed the first admin

```bash
cd /opt/proxyclaude/app
sudo -u proxyclaude bash -lc '
  set -a; . ./.env; set +a
  pnpm install --frozen-lockfile --prod=false
  pnpm --filter @proxyclaude/api exec prisma generate
  pnpm --filter @proxyclaude/api exec prisma migrate deploy
  pnpm build
  pnpm --filter @proxyclaude/api exec tsx prisma/seed.ts   # creates ADMIN_EMAIL/ADMIN_PASSWORD
'
```

### C3. Run the API under systemd

```bash
sudo cp infra/deploy/proxyclaude-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now proxyclaude-api
sudo systemctl status proxyclaude-api --no-pager      # should be active (running)
curl -fsS http://127.0.0.1:3000/health && echo OK     # local health check
```

If it isn't healthy: `journalctl -u proxyclaude-api -n 50`.

### C4. Put Caddy in front (HTTPS)

```bash
sudo cp infra/deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/api\.example\.com/api.yourcompany.com/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Wait ~30s for the certificate, then from your **laptop**:

```bash
curl -fsS https://api.yourcompany.com/health && echo OK
```

### C5. Make the audit log tamper-proof (run once)

```bash
sudo -u proxyclaude bash -lc 'set -a; . /opt/proxyclaude/app/.env; set +a;
  psql "$DATABASE_URL" -f /opt/proxyclaude/app/infra/db/append-only-audit.sql'
```

---

# PART D — Wire the provisioner (so workspaces can be created)

The API creates each developer's Linux workspace by SSHing into the box as a
**provisioner account** that is allowed to run exactly three scripts with sudo.

### D1. Install the provisioning scripts where the API expects them

```bash
sudo mkdir -p /opt/proxyclaude/vps
sudo cp /opt/proxyclaude/app/infra/vps/{create-workspace,install-key,revoke-key}.sh /opt/proxyclaude/vps/
sudo chown root:root /opt/proxyclaude/vps/*.sh
sudo chmod 755 /opt/proxyclaude/vps/*.sh
```

### D2. Install the developer toolchain (claude, git, tmux for workspaces)

```bash
sudo bash /opt/proxyclaude/app/infra/vps/install-toolchain.sh
```

### D3. Create the provisioner account with NOPASSWD sudo for ONLY those scripts

```bash
sudo adduser --disabled-password --gecos "" pc_provisioner

sudo tee /etc/sudoers.d/proxyclaude-provisioner >/dev/null <<'EOF'
pc_provisioner ALL=(root) NOPASSWD: /opt/proxyclaude/vps/create-workspace.sh, /opt/proxyclaude/vps/install-key.sh, /opt/proxyclaude/vps/revoke-key.sh
EOF
sudo chmod 440 /etc/sudoers.d/proxyclaude-provisioner
sudo visudo -c        # syntax check — must say "parsed OK"
```

### D4. Give the API an SSH key to log in as the provisioner

```bash
# generate a keypair owned by the API service user
sudo -u proxyclaude mkdir -p /opt/proxyclaude/app/secrets
sudo -u proxyclaude ssh-keygen -t ed25519 -N '' \
  -f /opt/proxyclaude/app/secrets/provisioner_ed25519
sudo chmod 600 /opt/proxyclaude/app/secrets/provisioner_ed25519

# authorize that key for pc_provisioner
sudo mkdir -p /home/pc_provisioner/.ssh
sudo cp /opt/proxyclaude/app/secrets/provisioner_ed25519.pub /home/pc_provisioner/.ssh/authorized_keys
sudo chown -R pc_provisioner:pc_provisioner /home/pc_provisioner/.ssh
sudo chmod 700 /home/pc_provisioner/.ssh
sudo chmod 600 /home/pc_provisioner/.ssh/authorized_keys

# let the API write its known_hosts (avoids first-connect prompt)
sudo -u proxyclaude mkdir -p /opt/proxyclaude/.ssh
sudo -u proxyclaude ssh-keyscan -p 22 127.0.0.1 >> /opt/proxyclaude/.ssh/known_hosts 2>/dev/null
```

### D5. Restart the API so it picks up the provisioner config

```bash
sudo systemctl restart proxyclaude-api
```

Smoke-test the SSH path (should print `provisioner-ok` with no password prompt):

```bash
sudo -u proxyclaude ssh -i /opt/proxyclaude/app/secrets/provisioner_ed25519 \
  -o BatchMode=yes pc_provisioner@127.0.0.1 'echo provisioner-ok'
```

> If `VPS_HOST` / `VPS_PROVISIONER_USER` / `VPS_PROVISIONER_KEY_PATH` are left blank,
> the API still runs but provisioning jobs stay **PENDING** (nothing is created on the
> box). Filling them in (above) is what makes `onboard` actually build workspaces.

---

# PART E — Use it as the admin

You drive everything from the `proxyclaude` CLI — no curl, no psql. Install the CLI
on **your own laptop** (same steps as a developer, see Part F), then:

```bash
proxyclaude login
#   API URL: https://api.yourcompany.com   (first run asks; saved after)
#   email:   admin@yourcompany.com
#   password: <your ADMIN_PASSWORD>
```

### Onboard a developer — one command

```bash
proxyclaude admin onboard dev@yourcompany.com \
  --project alpha --create-project --name "Alpha"
```

This creates the developer account, provisions their isolated Linux workspace,
creates the `alpha` project, points it at the new workspace, and assigns the
developer — then prints a **temp password** and the workspace name. Copy the temp
password and send it to the developer (along with your API URL).

Onboard another developer onto the same project later:

```bash
proxyclaude admin onboard dev2@yourcompany.com --project alpha
```

### Everyday admin commands

```bash
proxyclaude admin user list                       # who exists, status, workspace
proxyclaude admin user create dev@x.com           # just an account (prints temp pass)
proxyclaude admin user provision dev@x.com        # build/refresh their workspace
proxyclaude admin project create beta --name Beta
proxyclaude admin project update beta --vps-path /home/<vpsUser>/projects
proxyclaude admin assign dev@x.com beta           # give an existing dev a new project
proxyclaude admin audit --limit 50                # everything that happened
```

### Off-board / revoke a developer (under 2 minutes)

```bash
proxyclaude admin user disable dev@yourcompany.com    # blocks login + kills tokens
proxyclaude admin key revoke --user dev@yourcompany.com   # pulls their SSH key off the box
```

To also force-drop someone already connected over SSH, on the VPS:

```bash
sudo pkill -KILL -u <their pc_user_xxxx>
```

(There's no "re-enable" command in the MVP. To bring a disabled account back, set its
status in the DB: `UPDATE "User" SET status='ACTIVE' WHERE email='dev@yourcompany.com';`)

---

# PART F — Help your developers get connected

Send each developer three things: **the API URL**, **their email**, and **their temp
password**. Then point them at these steps.

### F1. Install the CLI (developer's laptop)

Two ways. The **tarball** path is recommended — your developers need only Node 22, no
build step, and they get a real `proxyclaude` command.

#### Option 1 — tarball (recommended)

**You (admin), once:** build a self-contained tarball. `pnpm pack` runs a `prepack`
hook that bundles the whole CLI (and its deps) into a single file, so the tarball has
**zero runtime dependencies**.

```bash
cd /opt/proxyclaude/app/packages/cli
pnpm pack
#   → proxyclaude-cli-0.0.0.tgz   (one self-contained dist/index.js inside, no deps)
```

Host that `.tgz` somewhere your developers can download it (internal share, release
asset, `scp`, etc.).

**Each developer**, with Node 22 installed:

```bash
npm i -g ./proxyclaude-cli-0.0.0.tgz     # or a URL to the hosted tarball
proxyclaude --version                     # confirms it's on PATH
```

To upgrade later, hand them a new tarball and they re-run `npm i -g`.

#### Option 2 — clone and build

For developers who already work in the repo:

```bash
git clone https://github.com/wisdmlabs/ProxyClaude.git
cd ProxyClaude
corepack enable && corepack prepare pnpm@9 --activate
pnpm install && pnpm build
alias proxyclaude='node ~/ProxyClaude/packages/cli/dist/index.js'
echo "alias proxyclaude='node ~/ProxyClaude/packages/cli/dist/index.js'" >> ~/.bashrc
```

### F2. Log in and connect

```bash
proxyclaude login           # API URL = https://api.yourcompany.com, then email + temp password
proxyclaude projects        # shows only the projects you assigned them
proxyclaude connect alpha   # generates an SSH key, registers it, drops into tmux + the project folder
claude                      # start working
```

### F3. The whole point — survive disconnects

Their work runs in tmux **on the VPS**. If Wi-Fi drops or the laptop sleeps:

```bash
proxyclaude reconnect alpha   # back in the same session, nothing lost
```

### F4. Pull latest code safely

```bash
proxyclaude sync alpha        # fast-forward only, never clobbers local edits
```

Full developer reference: [dev-quickstart.md](dev-quickstart.md).

---

# PART G — Day-2 operations

### Upgrade to new code

```bash
cd /opt/proxyclaude/app
sudo -u proxyclaude git pull
sudo -u proxyclaude bash infra/deploy/deploy.sh    # install → migrate → build → restart → health check
```

### Nightly database backup (cron)

```bash
sudo crontab -u proxyclaude -e
# add:
0 3 * * *  APP_DIR=/opt/proxyclaude/app /opt/proxyclaude/app/infra/db/backup.sh "$(date +\%Y\%m\%d-\%H\%M\%S)"
```

Restore (disaster recovery — destructive):

```bash
sudo -u proxyclaude bash -lc 'set -a; . /opt/proxyclaude/app/.env; set +a;
  infra/db/restore.sh /var/backups/proxyclaude/proxyclaude-<stamp>.dump "$DATABASE_URL"'
```

### Health & logs

```bash
sudo systemctl status proxyclaude-api
journalctl -u proxyclaude-api -n 100 -f
sudo bash /opt/proxyclaude/app/infra/vps/security-check.sh <pc_user_xxxx>   # re-verify a workspace is hardened
```

---

# Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `https://.../health` fails, `http://127.0.0.1:3000/health` works | Caddy/DNS: domain A record or ports 80/443 not reachable. Check `journalctl -u caddy`. |
| `onboard` says provisioned but `vpsUser` is `(pending)` | Provisioner not wired. Re-check Part D, confirm the D5 SSH smoke-test works, restart the API. |
| `onboard` errors `vps command failed` | Sudoers or script path wrong. `sudo visudo -c`; confirm scripts in `/opt/proxyclaude/vps/` are root-owned + executable. |
| developer `connect` → 403 | Not assigned. `proxyclaude admin assign <email> <slug>`. |
| developer `connect` → 409 not provisioned | Run `proxyclaude admin user provision <email>`. |
| developer `login` → 403 | Account disabled, or wrong API URL. |
| API won't start | `journalctl -u proxyclaude-api -n 50` — usually a bad value in `.env` (the API validates env at boot). |

---

# One-glance checklist

- [ ] A–C: API healthy at `https://api.yourcompany.com/health`
- [ ] C2: first admin seeded
- [ ] C5: audit log locked append-only
- [ ] D5: provisioner SSH smoke-test prints `provisioner-ok`
- [ ] E: `proxyclaude admin onboard …` prints a temp password + real `pc_user_*`
- [ ] F: a developer can `connect` and run `claude`
- [ ] G: nightly backup cron in place
