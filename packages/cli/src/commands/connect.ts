import { requireLogin } from '../lib/session.js';
import { makeApiClient, type MakeClient } from '../lib/clientFactory.js';
import { ensureKeyPair, type KeyInfo } from '../lib/sshKeygen.js';
import { launchSsh as defaultLaunchSsh, type SshLaunch } from '../lib/ssh.js';
import { consoleIo, type Io } from '../lib/io.js';

export interface ConnectDeps {
  io?: Io;
  makeClient?: MakeClient;
  ensureKey?: () => KeyInfo;
  launchSsh?: (launch: SshLaunch) => Promise<number>;
}

/**
 * connect <project> (plan §5): ensure a local key, register it, fetch the
 * server-checked connect config, then open a persistent SSH+tmux session.
 * `reconnect` (Phase 7) reuses this same flow — same tmux name re-attaches.
 */
export async function runConnect(
  slug: string,
  deps: ConnectDeps = {},
  opts: { reconnect?: boolean } = {},
): Promise<number> {
  const io = deps.io ?? consoleIo;
  const makeClient = deps.makeClient ?? makeApiClient;
  const ensureKey = deps.ensureKey ?? ensureKeyPair;
  const launchSsh = deps.launchSsh ?? defaultLaunchSsh;

  const creds = requireLogin();
  const client = makeClient(creds.apiUrl, {
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken,
  });

  const key = ensureKey();
  await client.registerSshKey(key.publicKey);

  const cfg = await client.connect(slug, opts.reconnect ?? false);
  io.out(`Connecting to ${slug} (${cfg.vpsUsername}@${cfg.host})…`);

  return launchSsh({
    host: cfg.host,
    port: cfg.port,
    user: cfg.vpsUsername,
    keyPath: key.privateKeyPath,
    projectPath: cfg.projectPath,
    tmuxName: cfg.tmuxName,
  });
}
