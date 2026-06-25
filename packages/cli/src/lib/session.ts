import { CliError } from './errors.js';
import { loadCredentials, type Credentials } from './credentials.js';

/** Return stored credentials or fail with a clear "please log in" error. */
export function requireLogin(): Credentials {
  const creds = loadCredentials();
  if (!creds) {
    throw new CliError('Not logged in. Run `proxyclaude login` first.', 'AUTH_INVALID');
  }
  return creds;
}
