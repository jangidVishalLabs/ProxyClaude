import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSync } from './sync.js';
import { git } from '../lib/git.js';
import { CliError } from '../lib/errors.js';

let root: string;
let remote: string; // bare
let local: string; // our checkout
let other: string; // a second clone used to push upstream commits

const lines: string[] = [];
const io = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };

function commit(dir: string, file: string, content: string, msg: string): void {
  writeFileSync(join(dir, file), content);
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', msg]);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pc-sync-'));
  process.env.PROXYCLAUDE_HOME = join(root, 'home');

  remote = join(root, 'remote.git');
  git(root, ['init', '-q', '--bare', '-b', 'main', remote]);

  local = join(root, 'local');
  git(root, ['clone', '-q', remote, local]);
  git(local, ['config', 'user.email', 't@t.com']);
  git(local, ['config', 'user.name', 'T']);
  commit(local, 'a.txt', 'v1\n', 'init');
  git(local, ['push', '-q', '-u', 'origin', 'main']);

  other = join(root, 'other');
  git(root, ['clone', '-q', remote, other]);
  git(other, ['config', 'user.email', 'o@o.com']);
  git(other, ['config', 'user.name', 'O']);

  lines.length = 0;
});
afterEach(() => {
  delete process.env.PROXYCLAUDE_HOME;
  rmSync(root, { recursive: true, force: true });
});

function pushUpstreamCommit(): void {
  commit(other, 'b.txt', 'fromOther\n', 'upstream change');
  git(other, ['push', '-q', 'origin', 'main']);
}

describe('runSync', () => {
  it('is up to date when there is nothing to pull', async () => {
    await runSync('alpha', { path: local, yes: true }, { io });
    expect(lines.join('\n')).toContain('Already up to date');
  });

  it('fast-forwards and reports incoming commits when confirmed', async () => {
    pushUpstreamCommit();
    await runSync('alpha', { path: local, yes: true }, { io });
    const out = lines.join('\n');
    expect(out).toContain('Incoming: 1 commit');
    expect(out).toContain('upstream change');
    expect(out).toContain('Synced 1 commit');
    expect(git(local, ['log', '--oneline']).stdout).toContain('upstream change');
  });

  it('aborts without merging when the user declines', async () => {
    pushUpstreamCommit();
    const head = git(local, ['rev-parse', 'HEAD']).stdout;
    await runSync('alpha', { path: local }, { io, confirm: async () => false });
    expect(lines.join('\n')).toContain('Aborted');
    expect(git(local, ['rev-parse', 'HEAD']).stdout).toBe(head); // unchanged
  });

  it('refuses to sync a dirty tree and changes nothing', async () => {
    pushUpstreamCommit();
    writeFileSync(join(local, 'a.txt'), 'localedit\n'); // dirty
    const head = git(local, ['rev-parse', 'HEAD']).stdout;
    await expect(runSync('alpha', { path: local, yes: true }, { io })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(git(local, ['rev-parse', 'HEAD']).stdout).toBe(head);
  });

  it('stops on divergence, preserves HEAD, and saves a backup ref', async () => {
    pushUpstreamCommit(); // upstream advances
    commit(local, 'c.txt', 'localonly\n', 'local divergent commit'); // local advances differently
    const head = git(local, ['rev-parse', 'HEAD']).stdout;

    await expect(runSync('alpha', { path: local, yes: true }, { io })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    // local HEAD untouched, backup ref points at it
    expect(git(local, ['rev-parse', 'HEAD']).stdout).toBe(head);
    expect(git(local, ['rev-parse', 'refs/proxyclaude/backup']).stdout).toBe(head);
  });

  it('errors when no path is known for the slug', async () => {
    await expect(runSync('unknown', {}, { io })).rejects.toBeInstanceOf(CliError);
  });

  it('remembers the path after the first --path use', async () => {
    await runSync('alpha', { path: local, yes: true }, { io }); // sets mapping
    lines.length = 0;
    await runSync('alpha', { yes: true }, { io }); // no --path, uses stored
    expect(lines.join('\n')).toContain('Already up to date');
  });
});
