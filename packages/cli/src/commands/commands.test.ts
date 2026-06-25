import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLogin } from './login.js';
import { runLogout } from './logout.js';
import { runStatus } from './status.js';
import { loadCredentials, saveCredentials } from '../lib/credentials.js';
import { CliError } from '../lib/errors.js';

let home: string;
const lines: string[] = [];
const io = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pc-cmd-'));
  process.env.PROXYCLAUDE_HOME = home;
  lines.length = 0;
});
afterEach(() => {
  delete process.env.PROXYCLAUDE_HOME;
  delete process.env.PROXYCLAUDE_PASSWORD;
  rmSync(home, { recursive: true, force: true });
});

const fakeLoginResult = {
  accessToken: 'at1',
  refreshToken: 'rt1',
  user: { id: 'u1', email: 'dev@x.com', role: 'DEVELOPER' as const },
};

describe('runLogin', () => {
  it('logs in and persists credentials', async () => {
    const login = vi.fn().mockResolvedValue(fakeLoginResult);
    const makeClient = vi.fn().mockReturnValue({ login });

    await runLogin(
      { email: 'dev@x.com', password: 'pw', apiUrl: 'http://api' },
      { io, makeClient },
    );

    expect(login).toHaveBeenCalledWith('dev@x.com', 'pw');
    const creds = loadCredentials();
    expect(creds).toMatchObject({ email: 'dev@x.com', apiUrl: 'http://api', accessToken: 'at1' });
    expect(lines.join('\n')).toContain('Logged in as dev@x.com');
  });

  it('requires an email', async () => {
    await expect(runLogin({ password: 'pw' }, { io })).rejects.toBeInstanceOf(CliError);
  });

  it('reads password from PROXYCLAUDE_PASSWORD when not given', async () => {
    process.env.PROXYCLAUDE_PASSWORD = 'envpw';
    const login = vi.fn().mockResolvedValue(fakeLoginResult);
    await runLogin(
      { email: 'dev@x.com', apiUrl: 'http://api' },
      { io, makeClient: () => ({ login }) as never },
    );
    expect(login).toHaveBeenCalledWith('dev@x.com', 'envpw');
  });
});

describe('runStatus', () => {
  it('shows not-logged-in without credentials', async () => {
    await runStatus({ io });
    expect(lines.join('\n')).toContain('Not logged in');
  });

  it('shows identity and active sessions when logged in', async () => {
    saveCredentials({
      apiUrl: 'http://api',
      email: 'dev@x.com',
      accessToken: 'a',
      refreshToken: 'r',
    });
    const listSessions = vi.fn().mockResolvedValue({
      sessions: [
        { id: 's1', projectSlug: 'alpha', tmuxName: 'alpha', status: 'ACTIVE', lastSeenAt: 'now' },
      ],
    });
    await runStatus({ io, makeClient: () => ({ listSessions }) as never });
    const out = lines.join('\n');
    expect(out).toContain('dev@x.com');
    expect(out).toContain('http://api');
    expect(out).toContain('alpha');
  });

  it('still shows identity if sessions are unavailable', async () => {
    saveCredentials({
      apiUrl: 'http://api',
      email: 'dev@x.com',
      accessToken: 'a',
      refreshToken: 'r',
    });
    const listSessions = vi.fn().mockRejectedValue(new Error('network'));
    await runStatus({ io, makeClient: () => ({ listSessions }) as never });
    const out = lines.join('\n');
    expect(out).toContain('dev@x.com');
    expect(out).toContain('unavailable');
  });
});

describe('runLogout', () => {
  it('revokes and clears credentials', async () => {
    saveCredentials({
      apiUrl: 'http://api',
      email: 'dev@x.com',
      accessToken: 'a',
      refreshToken: 'r',
    });
    const logout = vi.fn().mockResolvedValue(undefined);
    await runLogout({ io, makeClient: () => ({ logout }) as never });
    expect(logout).toHaveBeenCalled();
    expect(loadCredentials()).toBeNull();
    expect(lines.join('\n')).toContain('Logged out');
  });

  it('clears locally even if the server revoke fails', async () => {
    saveCredentials({
      apiUrl: 'http://api',
      email: 'dev@x.com',
      accessToken: 'a',
      refreshToken: 'r',
    });
    const logout = vi.fn().mockRejectedValue(new Error('network'));
    await runLogout({ io, makeClient: () => ({ logout }) as never });
    expect(loadCredentials()).toBeNull();
  });

  it('is a no-op when not logged in', async () => {
    await runLogout({ io });
    expect(lines.join('\n')).toContain('Not logged in');
  });
});
