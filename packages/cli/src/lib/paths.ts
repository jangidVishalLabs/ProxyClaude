import { homedir } from 'node:os';
import { join } from 'node:path';

/** Root config dir for the CLI on the developer's machine. Overridable for tests. */
export function configDir(): string {
  return process.env.PROXYCLAUDE_HOME ?? join(homedir(), '.proxyclaude');
}

export function keyPath(): string {
  return join(configDir(), 'id_ed25519');
}

export function credentialsPath(): string {
  return join(configDir(), 'credentials.json');
}
