import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runConnect } from './connect.js';
import { buildSshArgs } from '../lib/ssh.js';
import { saveCredentials } from '../lib/credentials.js';
import { CliError } from '../lib/errors.js';

let home: string;
const lines: string[] = [];
const io = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pc-conn-'));
  process.env.PROXYCLAUDE_HOME = home;
  lines.length = 0;
});
afterEach(() => {
  delete process.env.PROXYCLAUDE_HOME;
  rmSync(home, { recursive: true, force: true });
});

const key = {
  privateKeyPath: '/home/dev/.proxyclaude/id_ed25519',
  publicKey: 'ssh-ed25519 AAA x',
  fingerprint: 'SHA256:x',
};
const connectCfg = {
  host: '10.0.0.5',
  port: 2222,
  vpsUsername: 'pc_user_1',
  projectPath: '/home/pc_user_1/projects/alpha',
  tmuxName: 'alpha',
};

function login() {
  saveCredentials({ apiUrl: 'http://api', email: 'd@x.com', accessToken: 'a', refreshToken: 'r' });
}

describe('buildSshArgs', () => {
  it('builds a -t tmux attach-or-create command with keepalives', () => {
    const args = buildSshArgs({
      host: 'h',
      port: 22,
      user: 'pc_user_1',
      keyPath: '/k',
      projectPath: '/home/pc_user_1/projects/alpha',
      tmuxName: 'alpha',
    });
    expect(args).toContain('-t');
    expect(args).toContain('ServerAliveInterval=30');
    expect(args).toContain('pc_user_1@h');
    const remote = args[args.length - 1];
    expect(remote).toContain('tmux new-session -A -s');
    expect(remote).toContain("cd '/home/pc_user_1/projects/alpha'");
  });

  it('quotes paths to resist shell injection', () => {
    const args = buildSshArgs({
      host: 'h',
      port: 22,
      user: 'u',
      keyPath: '/k',
      projectPath: "/tmp/x'; rm -rf /",
      tmuxName: 'a',
    });
    const remote = args[args.length - 1];
    expect(remote).toContain(`'/tmp/x'\\''; rm -rf /'`);
  });
});

describe('runConnect', () => {
  it('requires login', async () => {
    await expect(runConnect('alpha', { io })).rejects.toBeInstanceOf(CliError);
  });

  it('registers the key, fetches config, and launches ssh with it', async () => {
    login();
    const registerSshKey = vi.fn().mockResolvedValue({ fingerprint: 'SHA256:x', status: 'ACTIVE' });
    const connect = vi.fn().mockResolvedValue(connectCfg);
    const launchSsh = vi.fn().mockResolvedValue(0);

    const code = await runConnect('alpha', {
      io,
      ensureKey: () => key,
      makeClient: () => ({ registerSshKey, connect }) as never,
      launchSsh,
    });

    expect(registerSshKey).toHaveBeenCalledWith(key.publicKey);
    expect(connect).toHaveBeenCalledWith('alpha', false);
    expect(launchSsh).toHaveBeenCalledWith({
      host: '10.0.0.5',
      port: 2222,
      user: 'pc_user_1',
      keyPath: key.privateKeyPath,
      projectPath: '/home/pc_user_1/projects/alpha',
      tmuxName: 'alpha',
    });
    expect(code).toBe(0);
  });

  it('propagates an access-denied connect error', async () => {
    login();
    const registerSshKey = vi.fn().mockResolvedValue({ fingerprint: 'x', status: 'ACTIVE' });
    const connect = vi.fn().mockRejectedValue(new CliError('denied', 'ACCESS_DENIED', 3));
    await expect(
      runConnect('alpha', {
        io,
        ensureKey: () => key,
        makeClient: () => ({ registerSshKey, connect }) as never,
        launchSsh: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });
});
