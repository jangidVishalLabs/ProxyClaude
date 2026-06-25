import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, isGitRepo, isDirty, currentBranch, hasUpstream } from './git.js';
import { getProjectPath, setProjectPath } from './projectPaths.js';

let dir: string;

function initRepo(path: string): void {
  mkdirSync(path, { recursive: true });
  git(path, ['init', '-q', '-b', 'main']);
  git(path, ['config', 'user.email', 't@t.com']);
  git(path, ['config', 'user.name', 'T']);
  writeFileSync(join(path, 'a.txt'), 'hello\n');
  git(path, ['add', '.']);
  git(path, ['commit', '-q', '-m', 'init']);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pc-git-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('git helpers', () => {
  it('detects a git repo vs a plain dir', () => {
    expect(isGitRepo(dir)).toBe(false);
    const repo = join(dir, 'repo');
    initRepo(repo);
    expect(isGitRepo(repo)).toBe(true);
  });

  it('detects a clean vs dirty tree', () => {
    const repo = join(dir, 'repo');
    initRepo(repo);
    expect(isDirty(repo)).toBe(false);
    writeFileSync(join(repo, 'a.txt'), 'changed\n');
    expect(isDirty(repo)).toBe(true);
  });

  it('detects untracked files as dirty', () => {
    const repo = join(dir, 'repo');
    initRepo(repo);
    writeFileSync(join(repo, 'new.txt'), 'x\n');
    expect(isDirty(repo)).toBe(true);
  });

  it('reports the current branch', () => {
    const repo = join(dir, 'repo');
    initRepo(repo);
    expect(currentBranch(repo)).toBe('main');
  });

  it('reports no upstream for a fresh local repo', () => {
    const repo = join(dir, 'repo');
    initRepo(repo);
    expect(hasUpstream(repo)).toBe(false);
  });
});

describe('projectPaths store', () => {
  beforeEach(() => {
    process.env.PROXYCLAUDE_HOME = dir;
  });
  afterEach(() => {
    delete process.env.PROXYCLAUDE_HOME;
  });

  it('returns undefined for an unknown slug', () => {
    expect(getProjectPath('ghost')).toBeUndefined();
  });

  it('persists and reads back a slug -> path mapping', () => {
    setProjectPath('alpha', '/home/dev/work/alpha');
    expect(getProjectPath('alpha')).toBe('/home/dev/work/alpha');
  });

  it('overwrites an existing mapping', () => {
    setProjectPath('alpha', '/old');
    setProjectPath('alpha', '/new');
    expect(getProjectPath('alpha')).toBe('/new');
  });
});
