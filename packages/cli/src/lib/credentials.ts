import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { credentialsPath } from './paths.js';

/**
 * Local credential store (plan §6). MVP uses a 0600 file in the CLI config dir.
 * (OS keychain via keytar is a post-MVP enhancement — it needs a running secret
 * service that is absent on headless Linux/CI.)
 */
export const credentialsSchema = z.object({
  apiUrl: z.string().url(),
  email: z.string().email(),
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type Credentials = z.infer<typeof credentialsSchema>;

export function saveCredentials(creds: Credentials): void {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export function loadCredentials(): Credentials | null {
  const path = credentialsPath();
  if (!existsSync(path)) return null;
  const parsed = credentialsSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  return parsed.success ? parsed.data : null;
}

export function clearCredentials(): void {
  const path = credentialsPath();
  if (existsSync(path)) rmSync(path);
}
