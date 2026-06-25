import { loadCredentials, clearCredentials } from '../lib/credentials.js';
import { makeApiClient, type MakeClient } from '../lib/clientFactory.js';
import { consoleIo, type Io } from '../lib/io.js';

export interface LogoutDeps {
  io?: Io;
  makeClient?: MakeClient;
}

export async function runLogout(deps: LogoutDeps = {}): Promise<void> {
  const io = deps.io ?? consoleIo;
  const makeClient = deps.makeClient ?? makeApiClient;

  const creds = loadCredentials();
  if (!creds) {
    io.out('Not logged in.');
    return;
  }

  // Best-effort server-side revoke; always clear locally even if it fails.
  try {
    await makeClient(creds.apiUrl, {
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
    }).logout();
  } catch {
    /* ignore network/revoke errors on logout */
  }
  clearCredentials();
  io.out('Logged out.');
}
