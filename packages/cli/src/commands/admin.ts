import { randomBytes } from 'node:crypto';
import { Role, type AdminUser } from '@proxyclaude/shared';
import { requireLogin } from '../lib/session.js';
import { makeApiClient, type MakeClient } from '../lib/clientFactory.js';
import { consoleIo, type Io } from '../lib/io.js';
import { CliError } from '../lib/errors.js';
import type { ApiClient } from '../lib/apiClient.js';

export interface AdminDeps {
  io?: Io;
  makeClient?: MakeClient;
}

/** Build an authenticated client from stored credentials (admin must `pc login`). */
function adminClient(deps: AdminDeps): { io: Io; client: ApiClient } {
  const io = deps.io ?? consoleIo;
  const makeClient = deps.makeClient ?? makeApiClient;
  const creds = requireLogin();
  const client = makeClient(creds.apiUrl, {
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken,
  });
  return { io, client };
}

/** Generate a strong temp password (satisfies the shared min-12 rule). */
function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}

function parseRole(input?: string): Role {
  if (!input) return Role.DEVELOPER;
  const upper = input.toUpperCase();
  if (upper !== Role.ADMIN && upper !== Role.DEVELOPER) {
    throw new CliError(`Invalid role "${input}" (use DEVELOPER or ADMIN)`, 'VALIDATION_FAILED');
  }
  return upper as Role;
}

/** Resolve an email OR id to a user. Bare ids (no '@') are returned as-is. */
async function resolveUser(client: ApiClient, emailOrId: string): Promise<AdminUser> {
  if (emailOrId.includes('@')) {
    const { users } = await client.adminListUsers(emailOrId);
    const match = users.find((u) => u.email === emailOrId);
    if (!match) throw new CliError(`No user with email ${emailOrId}`, 'NOT_FOUND');
    return match;
  }
  const { users } = await client.adminListUsers();
  const match = users.find((u) => u.id === emailOrId);
  if (!match) throw new CliError(`No user with id ${emailOrId}`, 'NOT_FOUND');
  return match;
}

async function resolveProjectId(client: ApiClient, slug: string): Promise<string> {
  // ADMIN sees all projects via GET /projects.
  const { projects } = await client.listProjects();
  const match = projects.find((p) => p.slug === slug);
  if (!match) throw new CliError(`No project with slug ${slug}`, 'NOT_FOUND');
  return match.id;
}

// --- user commands ---

export async function runAdminUserList(
  opts: { email?: string },
  deps: AdminDeps = {},
): Promise<void> {
  const { io, client } = adminClient(deps);
  const { users } = await client.adminListUsers(opts.email);
  if (users.length === 0) {
    io.out('No users found.');
    return;
  }
  const w = Math.max(...users.map((u) => u.email.length), 5);
  io.out(`${'EMAIL'.padEnd(w)}  ROLE       STATUS    VPS USER`);
  for (const u of users) {
    io.out(
      `${u.email.padEnd(w)}  ${u.role.padEnd(9)}  ${u.status.padEnd(8)}  ${u.vpsUsername ?? '-'}`,
    );
  }
}

export async function runAdminUserCreate(
  email: string,
  opts: { role?: string; password?: string },
  deps: AdminDeps = {},
): Promise<void> {
  const { io, client } = adminClient(deps);
  const role = parseRole(opts.role);
  const password = opts.password ?? generatePassword();
  const user = await client.adminCreateUser(email, password, role);
  io.out(`Created ${user.email} (${user.role}), id=${user.id}`);
  if (!opts.password) {
    io.out(`Temp password: ${password}`);
    io.out('Share it with the developer — they use it for `pc login`.');
  }
}

export async function runAdminUserProvision(
  emailOrId: string,
  deps: AdminDeps = {},
): Promise<void> {
  const { io, client } = adminClient(deps);
  const user = await resolveUser(client, emailOrId);
  const res = await client.adminProvision(user.id);
  io.out(`Provision queued for ${user.email} (job ${res.job.status}).`);
  io.out(`VPS username: ${res.user.vpsUsername ?? '(pending)'}`);
}

export async function runAdminUserDisable(emailOrId: string, deps: AdminDeps = {}): Promise<void> {
  const { io, client } = adminClient(deps);
  const user = await resolveUser(client, emailOrId);
  const updated = await client.adminDisableUser(user.id);
  io.out(`Disabled ${updated.email} (status=${updated.status}). Login + refresh tokens revoked.`);
}

// --- project commands ---

export async function runAdminProjectCreate(
  slug: string,
  opts: { name?: string; vpsPath?: string; repoUrl?: string },
  deps: AdminDeps = {},
): Promise<void> {
  const { io, client } = adminClient(deps);
  if (!opts.name) throw new CliError('Project name is required (--name)', 'VALIDATION_FAILED');
  const project = await client.adminCreateProject({
    slug,
    name: opts.name,
    // Placeholder until a workspace is provisioned; update with `pc admin project update`.
    vpsPath: opts.vpsPath ?? '/tmp/placeholder',
    repoUrl: opts.repoUrl,
  });
  io.out(`Created project ${project.slug} (${project.name}), id=${project.id}`);
}

export async function runAdminProjectUpdate(
  slug: string,
  opts: { name?: string; vpsPath?: string; repoUrl?: string },
  deps: AdminDeps = {},
): Promise<void> {
  const { io, client } = adminClient(deps);
  const id = await resolveProjectId(client, slug);
  const input: { name?: string; vpsPath?: string; repoUrl?: string } = {};
  if (opts.name !== undefined) input.name = opts.name;
  if (opts.vpsPath !== undefined) input.vpsPath = opts.vpsPath;
  if (opts.repoUrl !== undefined) input.repoUrl = opts.repoUrl;
  if (Object.keys(input).length === 0) {
    throw new CliError('Nothing to update (pass --name, --vps-path, or --repo-url)', 'VALIDATION_FAILED');
  }
  const project = await client.adminUpdateProject(id, input);
  io.out(`Updated project ${project.slug}.`);
}

// --- assignment ---

export async function runAdminAssign(
  email: string,
  slug: string,
  deps: AdminDeps = {},
): Promise<void> {
  const { io, client } = adminClient(deps);
  const user = await resolveUser(client, email);
  const projectId = await resolveProjectId(client, slug);
  await client.adminAssign(user.id, projectId);
  io.out(`Assigned ${user.email} → ${slug}.`);
}

// --- ssh keys ---

export async function runAdminKeyList(email: string, deps: AdminDeps = {}): Promise<void> {
  const { io, client } = adminClient(deps);
  const user = await resolveUser(client, email);
  const { keys } = await client.adminListSshKeys(user.id);
  if (keys.length === 0) {
    io.out(`No SSH keys for ${user.email}.`);
    return;
  }
  io.out('ID                          STATUS    FINGERPRINT');
  for (const k of keys) {
    io.out(`${k.id.padEnd(26)}  ${k.status.padEnd(8)}  ${k.fingerprint}`);
  }
}

export async function runAdminKeyRevoke(
  opts: { keyId?: string; user?: string },
  deps: AdminDeps = {},
): Promise<void> {
  const { io, client } = adminClient(deps);
  let keyId = opts.keyId;
  if (!keyId) {
    if (!opts.user) {
      throw new CliError('Provide a keyId or --user <email>', 'VALIDATION_FAILED');
    }
    const user = await resolveUser(client, opts.user);
    const { keys } = await client.adminListSshKeys(user.id);
    const active = keys.filter((k) => k.status === 'ACTIVE');
    const [first, ...rest] = active;
    if (!first) throw new CliError(`No active keys for ${opts.user}`, 'NOT_FOUND');
    if (rest.length > 0) {
      throw new CliError(
        `${opts.user} has ${active.length} active keys — pass an explicit keyId (\`pc admin key list ${opts.user}\`)`,
        'VALIDATION_FAILED',
      );
    }
    keyId = first.id;
  }
  await client.adminRevokeKey(keyId);
  io.out(`Revoked key ${keyId}. Removed from VPS authorized_keys.`);
}

// --- audit ---

export async function runAdminAudit(
  opts: { action?: string; limit?: string },
  deps: AdminDeps = {},
): Promise<void> {
  const { io, client } = adminClient(deps);
  const limit = opts.limit ? Number(opts.limit) : undefined;
  const { logs } = await client.adminAudit({ action: opts.action, limit });
  if (logs.length === 0) {
    io.out('No audit entries.');
    return;
  }
  for (const l of logs) {
    io.out(`${l.createdAt.toISOString()}  ${l.action.padEnd(22)}  ${l.result}`);
  }
}

// --- onboard orchestrator (collapses walkthrough §2) ---

export async function runAdminOnboard(
  email: string,
  opts: { project?: string; createProject?: boolean; name?: string; role?: string },
  deps: AdminDeps = {},
): Promise<void> {
  const { io, client } = adminClient(deps);
  if (!opts.project) throw new CliError('Target project is required (--project)', 'VALIDATION_FAILED');
  const role = parseRole(opts.role);

  // 1. Create the user, or reuse an existing one.
  let user: AdminUser;
  let tempPassword: string | undefined;
  const existing = (await client.adminListUsers(email)).users.find((u) => u.email === email);
  if (existing) {
    user = existing;
    io.out(`User ${email} already exists — reusing.`);
  } else {
    tempPassword = generatePassword();
    user = await client.adminCreateUser(email, tempPassword, role);
    io.out(`Created ${user.email} (${user.role}).`);
  }

  // 2. Provision the workspace → allocate vpsUsername.
  const provision = await client.adminProvision(user.id);
  const vpsUsername = provision.user.vpsUsername;
  io.out(`Provisioned workspace (job ${provision.job.status}), vpsUser=${vpsUsername ?? '(pending)'}.`);

  // 3. Ensure the project exists.
  let projectId: string;
  const project = (await client.listProjects()).projects.find((p) => p.slug === opts.project);
  if (project) {
    projectId = project.id;
  } else if (opts.createProject) {
    if (!opts.name) throw new CliError('--name is required when creating a project', 'VALIDATION_FAILED');
    const created = await client.adminCreateProject({
      slug: opts.project,
      name: opts.name,
      vpsPath: '/tmp/placeholder',
    });
    projectId = created.id;
    io.out(`Created project ${created.slug}.`);
  } else {
    throw new CliError(
      `Project ${opts.project} not found. Re-run with --create-project --name "..."`,
      'NOT_FOUND',
    );
  }

  // 4. Point the project at the dev's workspace.
  if (vpsUsername) {
    await client.adminUpdateProject(projectId, { vpsPath: `/home/${vpsUsername}/projects` });
    io.out(`Set vpsPath → /home/${vpsUsername}/projects.`);
  }

  // 5. Assign the user to the project (ignore "already assigned").
  try {
    await client.adminAssign(user.id, projectId);
    io.out(`Assigned ${user.email} → ${opts.project}.`);
  } catch (err) {
    if (err instanceof CliError && err.code === 'CONFLICT') {
      io.out(`${user.email} already assigned to ${opts.project}.`);
    } else {
      throw err;
    }
  }

  // 6. Summary.
  io.out('');
  io.out('── Onboarding complete ──');
  io.out(`  email:    ${user.email}`);
  if (tempPassword) io.out(`  password: ${tempPassword}`);
  io.out(`  vpsUser:  ${vpsUsername ?? '(pending)'}`);
  io.out(`  project:  ${opts.project}`);
  io.out(`Tell the developer: \`pc login\` then \`pc connect ${opts.project}\`.`);
}
