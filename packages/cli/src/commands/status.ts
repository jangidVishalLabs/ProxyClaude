import { loadCredentials } from '../lib/credentials.js';
import { makeApiClient, type MakeClient } from '../lib/clientFactory.js';
import { consoleIo, type Io } from '../lib/io.js';

export interface StatusDeps {
  io?: Io;
  makeClient?: MakeClient;
}

export async function runStatus(deps: StatusDeps = {}): Promise<void> {
  const io = deps.io ?? consoleIo;
  const makeClient = deps.makeClient ?? makeApiClient;

  const creds = loadCredentials();
  if (!creds) {
    io.out('Not logged in. Run `proxyclaude login`.');
    return;
  }
  io.out(`Logged in as ${creds.email}`);
  io.out(`API: ${creds.apiUrl}`);

  // Best-effort: show active sessions; never fail status on a network hiccup.
  try {
    const { sessions } = await makeClient(creds.apiUrl, {
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
    }).listSessions();
    if (sessions.length === 0) {
      io.out('Active sessions: none');
    } else {
      io.out('Active sessions:');
      for (const s of sessions) {
        io.out(`  ${s.projectSlug} (tmux: ${s.tmuxName}, last seen ${s.lastSeenAt})`);
      }
    }
  } catch {
    io.out('Active sessions: (unavailable)');
  }
}
