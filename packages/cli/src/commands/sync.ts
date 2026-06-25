import { CliError } from '../lib/errors.js';
import { consoleIo, type Io } from '../lib/io.js';
import { getProjectPath, setProjectPath } from '../lib/projectPaths.js';
import { loadCredentials } from '../lib/credentials.js';
import { makeApiClient } from '../lib/clientFactory.js';
import {
  isGitRepo,
  isDirty,
  hasUpstream,
  fetch as gitFetch,
  inspectIncoming,
  backupHead,
  ffMerge,
} from '../lib/git.js';

export interface SyncOptions {
  path?: string;
  /** Skip the confirmation prompt. */
  yes?: boolean;
}

export interface SyncDeps {
  io?: Io;
  /** Resolve the y/N confirmation (interactive prompt in real use). */
  confirm?: () => Promise<boolean>;
}

/**
 * `sync <project>` (plan §9). Safe by default: never touches a dirty tree,
 * shows incoming changes, asks before pulling, fast-forward only, and stops
 * (without mutating) on any divergence/conflict — backing up HEAD first.
 */
export async function runSync(
  slug: string,
  opts: SyncOptions = {},
  deps: SyncDeps = {},
): Promise<void> {
  const io = deps.io ?? consoleIo;

  const dir = resolvePath(slug, opts.path);

  if (!isGitRepo(dir)) {
    throw new CliError(`Not a git repository: ${dir}`, 'VALIDATION_FAILED');
  }
  if (!hasUpstream(dir)) {
    throw new CliError('Current branch has no upstream to sync from.', 'VALIDATION_FAILED');
  }
  if (isDirty(dir)) {
    throw new CliError(
      'You have uncommitted changes. Commit or stash them before syncing — sync never overwrites local work.',
      'CONFLICT',
    );
  }

  const fetched = gitFetch(dir);
  if (fetched.code !== 0) {
    throw new CliError(`git fetch failed: ${fetched.stderr}`, 'INTERNAL');
  }

  const incoming = inspectIncoming(dir);
  if (incoming.behind === 0) {
    io.out('Already up to date.');
    return;
  }

  io.out(`Incoming: ${incoming.behind} commit(s) from upstream`);
  io.out(incoming.log);
  if (incoming.diffstat) io.out(incoming.diffstat);

  const proceed = opts.yes ? true : ((await deps.confirm?.()) ?? false);
  if (!proceed) {
    io.out('Aborted. Nothing changed.');
    return;
  }

  backupHead(dir); // recoverable at refs/proxyclaude/backup
  const merged = ffMerge(dir);
  if (merged.code !== 0) {
    throw new CliError(
      'Cannot fast-forward — your branch has diverged from upstream. Nothing was changed; ' +
        'your previous HEAD is saved at refs/proxyclaude/backup. Resolve manually (rebase/merge).',
      'CONFLICT',
    );
  }

  io.out(`Synced ${incoming.behind} commit(s).`);
  await reportSync(slug);
}

/** Best-effort audit report; a sync must succeed even if the backend is down. */
async function reportSync(slug: string): Promise<void> {
  const creds = loadCredentials();
  if (!creds) return;
  try {
    await makeApiClient(creds.apiUrl, {
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
    }).reportSync(slug);
  } catch {
    /* offline / not reachable — local sync already succeeded */
  }
}

function resolvePath(slug: string, optPath?: string): string {
  if (optPath) {
    setProjectPath(slug, optPath); // remember for next time
    return optPath;
  }
  const stored = getProjectPath(slug);
  if (!stored) {
    throw new CliError(
      `No local path known for "${slug}". Run once with --path <local-repo-dir> to set it.`,
      'VALIDATION_FAILED',
    );
  }
  return stored;
}
