import { CliError } from '../lib/errors.js';
import { resolveApiUrl } from '../lib/config.js';
import { saveCredentials } from '../lib/credentials.js';
import { makeApiClient, type MakeClient } from '../lib/clientFactory.js';
import { consoleIo, type Io } from '../lib/io.js';

export interface LoginOptions {
  email?: string;
  password?: string;
  apiUrl?: string;
}

export interface LoginDeps {
  io?: Io;
  makeClient?: MakeClient;
  /** Resolve a password when not supplied via opts (interactive prompt in real use). */
  promptPassword?: () => Promise<string>;
}

export async function runLogin(opts: LoginOptions, deps: LoginDeps = {}): Promise<void> {
  const io = deps.io ?? consoleIo;
  const makeClient = deps.makeClient ?? makeApiClient;

  const email = opts.email;
  if (!email) throw new CliError('Email is required (--email)', 'VALIDATION_FAILED');

  const password =
    opts.password ?? process.env.PROXYCLAUDE_PASSWORD ?? (await deps.promptPassword?.());
  if (!password) throw new CliError('Password is required', 'VALIDATION_FAILED');

  const apiUrl = opts.apiUrl ?? resolveApiUrl();
  const client = makeClient(apiUrl);
  const res = await client.login(email, password);

  saveCredentials({
    apiUrl,
    email: res.user.email,
    accessToken: res.accessToken,
    refreshToken: res.refreshToken,
  });
  io.out(`Logged in as ${res.user.email} (${res.user.role}) → ${apiUrl}`);
}
