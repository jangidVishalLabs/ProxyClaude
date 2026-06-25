import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a git command in a directory. Never throws — inspect `code`. */
export function git(cwd: string, args: string[]): GitResult {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    code: res.status ?? -1,
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? '').trim(),
  };
}

export function isGitRepo(dir: string): boolean {
  if (!existsSync(dir)) return false;
  return git(dir, ['rev-parse', '--is-inside-work-tree']).stdout === 'true';
}

/** True if there are uncommitted changes (tracked or untracked). */
export function isDirty(dir: string): boolean {
  return git(dir, ['status', '--porcelain']).stdout.length > 0;
}

export function currentBranch(dir: string): string {
  return git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout;
}

/** True if the current branch has a configured upstream. */
export function hasUpstream(dir: string): boolean {
  return git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).code === 0;
}

export function fetch(dir: string): GitResult {
  return git(dir, ['fetch', '--quiet']);
}

export interface AheadBehind {
  ahead: number;
  behind: number;
}

/** Local commits ahead of / behind the upstream. */
export function aheadBehind(dir: string): AheadBehind {
  const res = git(dir, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
  const [ahead, behind] = res.stdout.split(/\s+/).map((n) => Number(n) || 0);
  return { ahead: ahead ?? 0, behind: behind ?? 0 };
}

export interface Incoming {
  behind: number;
  ahead: number;
  log: string;
  diffstat: string;
}

/** Summarise the changes the upstream has that we don't (plan §9 step 4). */
export function inspectIncoming(dir: string): Incoming {
  const { ahead, behind } = aheadBehind(dir);
  return {
    ahead,
    behind,
    log: git(dir, ['log', '--oneline', 'HEAD..@{u}']).stdout,
    diffstat: git(dir, ['diff', '--stat', 'HEAD..@{u}']).stdout,
  };
}

/** Save a recoverable backup of the current HEAD before mutating (plan §9). */
export function backupHead(dir: string): GitResult {
  return git(dir, ['update-ref', 'refs/proxyclaude/backup', 'HEAD']);
}

/** Fast-forward-only merge of the upstream. Fails (non-zero) on divergence. */
export function ffMerge(dir: string): GitResult {
  return git(dir, ['merge', '--ff-only', '@{u}']);
}
