import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { configDir, keyPath } from './paths.js';

export interface KeyInfo {
  privateKeyPath: string;
  publicKey: string;
  fingerprint: string;
}

/**
 * Ensure an ed25519 keypair exists for this machine (plan §7). Generates one in
 * the CLI config dir on first use; reuses it afterwards. The private key never
 * leaves the machine — only publicKey is sent to the backend.
 */
export function ensureKeyPair(): KeyInfo {
  const priv = keyPath();
  const pub = `${priv}.pub`;

  if (!existsSync(priv)) {
    mkdirSync(dirname(priv), { recursive: true, mode: 0o700 });
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', priv, '-C', 'proxyclaude-cli'], {
      stdio: 'ignore',
    });
  }

  const publicKey = readFileSync(pub, 'utf8').trim();
  return { privateKeyPath: priv, publicKey, fingerprint: fingerprintOf(pub) };
}

/** SHA256 fingerprint of a public key file, e.g. "SHA256:abc...". */
export function fingerprintOf(pubKeyPath: string): string {
  const out = execFileSync('ssh-keygen', ['-lf', pubKeyPath], { encoding: 'utf8' });
  // format: "256 SHA256:xxxx comment (ED25519)"
  const match = out.match(/\bSHA256:\S+/);
  if (!match) {
    throw new Error(`could not parse fingerprint from: ${out}`);
  }
  return match[0];
}

export { configDir };
