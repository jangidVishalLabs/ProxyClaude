# Plan — Admin CLI commands (`pc admin …`)

## Problem

Admin work today = raw `curl` + `psql` (see `docs/manual-test-walkthrough.md` §2, §8).
Creating a project, registering a developer, provisioning, reading the allocated
VPS username, pointing the project at the workspace, and assigning the dev is **six
manual steps**, two of which poke Postgres directly. Developers already get a clean
CLI (`pc login/connect/sync/...`); admins should too.

Goal: every admin action reachable as a `pc admin …` subcommand, plus a single
`pc admin onboard` that collapses the whole §2 flow into one command. No psql.

## Current state

- CLI: `commander` program in `packages/cli/src/index.ts`; commands registered in
  `packages/cli/src/commands/index.ts`; HTTP via `packages/cli/src/lib/apiClient.ts`;
  auth via `requireLogin()` (`lib/session.ts`). `pc login` is already role-agnostic —
  an ADMIN can log in with it today.
- API admin routes: `packages/api/src/modules/admin/routes.ts`, all gated by
  `requireRole('ADMIN')`. Services: `service.ts` (users), `projects.service.ts`
  (projects+assignments), `provision.service.ts`, `ssh-keys/service.ts`.
- Shared contracts: `packages/shared/src/schemas.ts`.

## Backend gaps (must close before CLI can be clean)

| # | Need | Today | Fix |
|---|------|-------|-----|
| 1 | Update project `vpsPath` after provision | psql `UPDATE Project` | **`PATCH /admin/projects/:id`** + `updateProjectRequestSchema` + `AdminProjectService.updateProject()` |
| 2 | Find user id from email (CLI takes email) | `GET /admin/users` then grep | **`?email=` filter** on `GET /admin/users` |
| 3 | List a user's SSH keys to get keyId for revoke | psql `SELECT id FROM SshKey` | **`GET /admin/users/:id/ssh-keys`** |
| 4 | Read allocated `vpsUsername` after provision | psql `SELECT vpsUsername` | already returned in provision response `result.user.vpsUsername` — no change, just consume it |

Provision already returns the full `UserDto` (incl. `vpsUsername`) and create-user
returns the `UserDto` (incl. `id`) — so onboard never needs the DB.

## Phase 1 — Backend (this PR)

1. **shared/schemas.ts** — add:
   - `updateProjectRequestSchema` (all fields optional: `name?`, `repoUrl?`, `vpsPath?`, `defaultBranch?`)
   - `adminUserSchema` + `adminUsersResponseSchema` (validates `GET /admin/users`)
   - `adminSshKeySchema` + `adminSshKeysResponseSchema`
2. **AdminProjectService.updateProject(id, input)** — partial update, NOT_FOUND if
   missing, returns `Project`.
3. **AdminUserService.listUsers(email?)** — optional exact-email filter.
4. **SshKeyService.listForUser(userId)** — return `{id, fingerprint, status, createdAt}[]`.
5. **routes.ts**:
   - `PATCH /admin/projects/:id` → `updateProject`, 200, `toProjectDto`
   - `GET /admin/users?email=` → filtered list
   - `GET /admin/users/:id/ssh-keys` → key list
6. Integration tests for each new/changed route (mirror existing
   `admin/projects.integration.test.ts`, `users.integration.test.ts`).

## Phase 2 — CLI apiClient methods

Add to `ApiClient`: `adminListUsers(email?)`, `adminCreateUser(...)`,
`adminDisableUser(id)`, `adminProvision(id)`, `adminCreateProject(...)`,
`adminUpdateProject(id, ...)`, `adminAssign(userId, projectId)`,
`adminListSshKeys(userId)`, `adminRevokeKey(keyId)`, `adminAudit(...)`.
Each validates the response with the shared schema. RBAC errors (403) surface as
`CliError` already.

## Phase 3 — CLI commands (`pc admin <noun> <verb>`)

```
pc admin user list [--email <e>]
pc admin user create <email> [--role DEVELOPER|ADMIN] [--password <p>]   # auto-gen + print if omitted
pc admin user provision <email|id>          # prints allocated vpsUsername
pc admin user disable <email|id>
pc admin project create <slug> --name <n> [--vps-path <p>] [--repo-url <u>]
pc admin project update <slug> [--vps-path <p>] [--name <n>] [--repo-url <u>]
pc admin assign <email> <slug>
pc admin key list <email>
pc admin key revoke <keyId | --user <email>>
pc admin audit [--action <A>] [--limit <n>]
```

Email→id and slug→id resolution done client-side via list endpoints so the admin
never handles raw ids.

## Phase 4 — `onboard` orchestrator (the headline)

```
pc admin onboard <email> --project <slug>
        [--create-project --name "..."]   # create project if it doesn't exist
        [--role DEVELOPER]
```

Chains, idempotent where possible:
1. create user (or reuse if email exists) → capture `id`, temp password
2. provision → capture `vpsUsername`
3. ensure project exists (create if `--create-project`)
4. `PATCH` project `vpsPath = /home/<vpsUsername>/projects`
5. assign user → project
6. print summary: email, temp password, vpsUsername, project, "tell the dev to `pc login` then `pc connect <slug>`"

Replaces the entire walkthrough §2 block. Zero psql.

## Out of scope (note, don't build)

- Re-enable/un-disable endpoint (MVP has none — walkthrough §8 flips DB by hand).
- Interactive TUI. Commands stay flag-driven + a couple of prompts (password).

## Test strategy

- API: integration tests per route (Phase 1).
- CLI: unit tests with injected `makeClient`/`io` (mirror `projects.test.ts`),
  covering email/slug resolution + onboard happy path + "user already exists" reuse.

## Build/verify

`pnpm -r build && pnpm -r test`. Manual: re-run walkthrough §2 as
`pc admin onboard dev@example.com --project demo --create-project --name "Demo"`.
