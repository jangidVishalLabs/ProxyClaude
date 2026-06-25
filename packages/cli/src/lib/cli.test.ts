import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureKeyPair, fingerprintOf } from './sshKeygen.js';
import { saveCredentials, loadCredentials, clearCredentials } from './credentials.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pc-cli-'));
  process.env.PROXYCLAUDE_HOME = home;
});
afterEach(() => {
  delete process.env.PROXYCLAUDE_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe('ensureKeyPair', () => {
  it('generates an ed25519 key and a SHA256 fingerprint', () => {
    const info = ensureKeyPair();
    expect(info.publicKey).toMatch(/^ssh-ed25519 /);
    expect(info.fingerprint).toMatch(/^SHA256:/);
    expect(existsSync(info.privateKeyPath)).toBe(true);
  });

  it('reuses the existing key on subsequent calls', () => {
    const a = ensureKeyPair();
    const b = ensureKeyPair();
    expect(b.publicKey).toBe(a.publicKey);
    expect(b.fingerprint).toBe(a.fingerprint);
  });

  it('writes the private key with 0600 permissions', () => {
    const info = ensureKeyPair();
    const mode = statSync(info.privateKeyPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('fingerprintOf matches ensureKeyPair', () => {
    const info = ensureKeyPair();
    expect(fingerprintOf(`${info.privateKeyPath}.pub`)).toBe(info.fingerprint);
  });
});

describe('credential store', () => {
  const creds = {
    apiUrl: 'https://api.example.com',
    email: 'dev@x.com',
    accessToken: 'at',
    refreshToken: 'rt',
  };

  it('round-trips save -> load', () => {
    saveCredentials(creds);
    expect(loadCredentials()).toEqual(creds);
  });

  it('stores the file with 0600 permissions', () => {
    saveCredentials(creds);
    const mode = statSync(join(home, 'credentials.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('returns null when no credentials exist', () => {
    expect(loadCredentials()).toBeNull();
  });

  it('clear removes the stored credentials', () => {
    saveCredentials(creds);
    clearCredentials();
    expect(loadCredentials()).toBeNull();
  });
});
