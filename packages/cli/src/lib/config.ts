import { loadCredentials } from './credentials.js';

const DEFAULT_API_URL = 'http://localhost:3000';

/**
 * Resolve the backend API URL: explicit env override > stored credentials >
 * default. Lets a developer point the CLI at staging/prod without re-login.
 */
export function resolveApiUrl(): string {
  if (process.env.PROXYCLAUDE_API_URL) return process.env.PROXYCLAUDE_API_URL;
  const creds = loadCredentials();
  return creds?.apiUrl ?? DEFAULT_API_URL;
}
