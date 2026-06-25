# Developer quickstart

Get from zero to running `claude` in a persistent workspace in a few minutes.

## Prerequisites

- An admin has created your account and **assigned** you to at least one project.
- `ssh` and `git` on your laptop.
- The `proxyclaude` CLI installed (your admin provides the package / binary).

## 1. Log in

```bash
proxyclaude login
# prompts for email + password; stores tokens in ~/.proxyclaude (chmod 600)
```

Check state any time:

```bash
proxyclaude status      # shows who you are + active sessions
```

## 2. See your projects

```bash
proxyclaude projects
```

Only projects you've been assigned to appear. If the list is empty, ask your admin
to assign you.

## 3. Connect

```bash
proxyclaude connect <project-slug>
```

First connect does all of this automatically:

1. Generates an ed25519 SSH keypair if you don't have one (`~/.ssh/proxyclaude_ed25519`).
2. Registers the public key with the API (idempotent — safe to re-run).
3. The API installs it into your workspace `authorized_keys`.
4. `ssh -t` into your workspace and `tmux new-session -A` drops you in the project
   folder, inside a durable tmux session.

Then just:

```bash
claude
```

## 4. Survive disconnects — this is the point

Your work runs in tmux **on the VPS**, not on your laptop. If your laptop sleeps,
Wi-Fi drops, or the SSH connection dies, the session keeps running. To get back:

```bash
proxyclaude reconnect <project-slug>
```

You re-attach to the **same** session, right where you left off — nothing restarts.
(`reconnect` and `connect` both use attach-or-create, so either works.)

## 5. Pull latest code safely

```bash
proxyclaude sync <project-slug>
```

`sync` is deliberately conservative and **never overwrites local work**:

- If your working tree is dirty → it aborts and tells you to commit/stash first.
- It fetches, shows you the incoming commits + diffstat, and asks for confirmation.
- It saves a backup ref (`refs/proxyclaude/backup`) before merging.
- It does a **fast-forward-only** merge. If your branch has diverged, it stops
  without changing anything and leaves resolution to you.

## Troubleshooting

| Symptom                                | Cause / fix                                                      |
| -------------------------------------- | ---------------------------------------------------------------- |
| `connect` → 403 / access denied        | Not assigned to that project. Ask your admin.                    |
| `connect` → 409 / not provisioned      | Your workspace isn't ready yet. Ask your admin to provision you. |
| `login` → 403                          | Your account is disabled. Contact your admin.                    |
| SSH permission denied after key change | Re-run `connect` (re-registers + reinstalls your key).           |
| `sync` aborted "working tree dirty"    | Commit or stash your changes, then re-run `sync`.                |
