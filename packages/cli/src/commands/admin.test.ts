import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runAdminUserCreate,
  runAdminUserProvision,
  runAdminAssign,
  runAdminKeyRevoke,
  runAdminOnboard,
} from './admin.js';
import { saveCredentials } from '../lib/credentials.js';
import { CliError } from '../lib/errors.js';

let home: string;
const lines: string[] = [];
const io = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pc-admin-'));
  process.env.PROXYCLAUDE_HOME = home;
  lines.length = 0;
});
afterEach(() => {
  delete process.env.PROXYCLAUDE_HOME;
  rmSync(home, { recursive: true, force: true });
});

function login() {
  saveCredentials({ apiUrl: 'http://api', email: 'a@x.com', accessToken: 'a', refreshToken: 'r' });
}

const aUser = (over = {}) => ({
  id: 'u1',
  email: 'dev@x.com',
  role: 'DEVELOPER',
  status: 'ACTIVE',
  vpsUsername: null,
  createdAt: new Date(),
  ...over,
});

describe('runAdminUserCreate', () => {
  it('fails when not logged in', async () => {
    await expect(runAdminUserCreate('dev@x.com', {}, { io })).rejects.toBeInstanceOf(CliError);
  });

  it('auto-generates and prints a temp password when none given', async () => {
    login();
    const adminCreateUser = vi.fn().mockResolvedValue(aUser());
    await runAdminUserCreate('dev@x.com', {}, { io, makeClient: () => ({ adminCreateUser }) as never });
    // password arg is non-empty and >= 12 chars (shared min)
    const passedPassword = adminCreateUser.mock.calls[0][1] as string;
    expect(passedPassword.length).toBeGreaterThanOrEqual(12);
    expect(lines.join('\n')).toContain('Temp password:');
  });

  it('rejects an invalid role', async () => {
    login();
    await expect(
      runAdminUserCreate('dev@x.com', { role: 'WIZARD' }, { io, makeClient: () => ({}) as never }),
    ).rejects.toBeInstanceOf(CliError);
  });
});

describe('runAdminUserProvision', () => {
  it('resolves email → id and prints the allocated vpsUsername', async () => {
    login();
    const adminListUsers = vi.fn().mockResolvedValue({ users: [aUser()] });
    const adminProvision = vi.fn().mockResolvedValue({
      user: aUser({ vpsUsername: 'pc_user_abc' }),
      job: { id: 'j1', type: 'WORKSPACE', status: 'PENDING' },
    });
    await runAdminUserProvision('dev@x.com', {
      io,
      makeClient: () => ({ adminListUsers, adminProvision }) as never,
    });
    expect(adminProvision).toHaveBeenCalledWith('u1');
    expect(lines.join('\n')).toContain('pc_user_abc');
  });

  it('errors when the email is unknown', async () => {
    login();
    const adminListUsers = vi.fn().mockResolvedValue({ users: [] });
    await expect(
      runAdminUserProvision('ghost@x.com', { io, makeClient: () => ({ adminListUsers }) as never }),
    ).rejects.toThrow(/No user with email/);
  });
});

describe('runAdminAssign', () => {
  it('resolves both email and slug then assigns', async () => {
    login();
    const adminListUsers = vi.fn().mockResolvedValue({ users: [aUser()] });
    const listProjects = vi
      .fn()
      .mockResolvedValue({ projects: [{ id: 'p1', slug: 'demo', name: 'Demo', repoUrl: null, defaultBranch: 'main' }] });
    const adminAssign = vi.fn().mockResolvedValue({ id: 'a1', userId: 'u1', projectId: 'p1' });
    await runAdminAssign('dev@x.com', 'demo', {
      io,
      makeClient: () => ({ adminListUsers, listProjects, adminAssign }) as never,
    });
    expect(adminAssign).toHaveBeenCalledWith('u1', 'p1');
  });
});

describe('runAdminKeyRevoke', () => {
  it('revokes the sole active key via --user', async () => {
    login();
    const adminListUsers = vi.fn().mockResolvedValue({ users: [aUser()] });
    const adminListSshKeys = vi
      .fn()
      .mockResolvedValue({ keys: [{ id: 'k1', fingerprint: 'fp', status: 'ACTIVE', createdAt: new Date() }] });
    const adminRevokeKey = vi.fn().mockResolvedValue(undefined);
    await runAdminKeyRevoke(
      { user: 'dev@x.com' },
      { io, makeClient: () => ({ adminListUsers, adminListSshKeys, adminRevokeKey }) as never },
    );
    expect(adminRevokeKey).toHaveBeenCalledWith('k1');
  });

  it('refuses when the user has multiple active keys', async () => {
    login();
    const adminListUsers = vi.fn().mockResolvedValue({ users: [aUser()] });
    const adminListSshKeys = vi.fn().mockResolvedValue({
      keys: [
        { id: 'k1', fingerprint: 'a', status: 'ACTIVE', createdAt: new Date() },
        { id: 'k2', fingerprint: 'b', status: 'ACTIVE', createdAt: new Date() },
      ],
    });
    await expect(
      runAdminKeyRevoke(
        { user: 'dev@x.com' },
        { io, makeClient: () => ({ adminListUsers, adminListSshKeys }) as never },
      ),
    ).rejects.toThrow(/active keys/);
  });
});

describe('runAdminOnboard', () => {
  it('creates, provisions, sets vpsPath, and assigns end-to-end', async () => {
    login();
    const adminListUsers = vi.fn().mockResolvedValue({ users: [] }); // no existing user
    const adminCreateUser = vi.fn().mockResolvedValue(aUser());
    const adminProvision = vi.fn().mockResolvedValue({
      user: aUser({ vpsUsername: 'pc_user_xyz' }),
      job: { id: 'j1', type: 'WORKSPACE', status: 'PENDING' },
    });
    const listProjects = vi.fn().mockResolvedValue({ projects: [] }); // project absent
    const adminCreateProject = vi
      .fn()
      .mockResolvedValue({ id: 'p1', slug: 'demo', name: 'Demo', repoUrl: null, defaultBranch: 'main' });
    const adminUpdateProject = vi
      .fn()
      .mockResolvedValue({ id: 'p1', slug: 'demo', name: 'Demo', repoUrl: null, defaultBranch: 'main' });
    const adminAssign = vi.fn().mockResolvedValue({ id: 'a1', userId: 'u1', projectId: 'p1' });

    await runAdminOnboard(
      'dev@x.com',
      { project: 'demo', createProject: true, name: 'Demo' },
      {
        io,
        makeClient: () =>
          ({
            adminListUsers,
            adminCreateUser,
            adminProvision,
            listProjects,
            adminCreateProject,
            adminUpdateProject,
            adminAssign,
          }) as never,
      },
    );

    expect(adminCreateUser).toHaveBeenCalled();
    expect(adminUpdateProject).toHaveBeenCalledWith('p1', { vpsPath: '/home/pc_user_xyz/projects' });
    expect(adminAssign).toHaveBeenCalledWith('u1', 'p1');
    const out = lines.join('\n');
    expect(out).toContain('Onboarding complete');
    expect(out).toContain('pc_user_xyz');
  });

  it('reuses an existing user instead of creating', async () => {
    login();
    const adminListUsers = vi.fn().mockResolvedValue({ users: [aUser({ vpsUsername: 'pc_user_old' })] });
    const adminCreateUser = vi.fn();
    const adminProvision = vi.fn().mockResolvedValue({
      user: aUser({ vpsUsername: 'pc_user_old' }),
      job: { id: 'j1', type: 'WORKSPACE', status: 'DONE' },
    });
    const listProjects = vi
      .fn()
      .mockResolvedValue({ projects: [{ id: 'p1', slug: 'demo', name: 'Demo', repoUrl: null, defaultBranch: 'main' }] });
    const adminUpdateProject = vi.fn().mockResolvedValue({});
    const adminAssign = vi.fn().mockResolvedValue({ id: 'a1', userId: 'u1', projectId: 'p1' });

    await runAdminOnboard(
      'dev@x.com',
      { project: 'demo' },
      {
        io,
        makeClient: () =>
          ({
            adminListUsers,
            adminCreateUser,
            adminProvision,
            listProjects,
            adminUpdateProject,
            adminAssign,
          }) as never,
      },
    );

    expect(adminCreateUser).not.toHaveBeenCalled();
    expect(lines.join('\n')).toContain('already exists');
  });
});
