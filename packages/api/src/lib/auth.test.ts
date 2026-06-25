import { describe, it, expect } from 'vitest';
import { AppError } from '@proxyclaude/shared';
import { hashPassword, verifyPassword } from './hash.js';
import { signAccessToken, verifyAccessToken } from './jwt.js';
import { generateRefreshToken, hashRefreshToken, refreshTokenExpiry } from './tokens.js';

const SECRET = 'x'.repeat(32);

describe('password hashing', () => {
  it('hashes then verifies', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(h, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
  });

  it('returns false on a malformed hash instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
  });
});

describe('access token', () => {
  const claims = { sub: 'user123', email: 'a@b.com', role: 'DEVELOPER' as const };

  it('signs and verifies round-trip', async () => {
    const token = await signAccessToken(claims, SECRET, '15m');
    const out = await verifyAccessToken(token, SECRET);
    expect(out).toEqual(claims);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signAccessToken(claims, SECRET, '15m');
    await expect(verifyAccessToken(token, 'y'.repeat(32))).rejects.toBeInstanceOf(AppError);
  });

  it('rejects an expired token with AUTH_TOKEN_EXPIRED', async () => {
    const token = await signAccessToken(claims, SECRET, '0s');
    await new Promise((r) => setTimeout(r, 1100));
    await expect(verifyAccessToken(token, SECRET)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_EXPIRED',
    });
  });

  it('rejects garbage with AUTH_INVALID', async () => {
    await expect(verifyAccessToken('garbage.token.here', SECRET)).rejects.toMatchObject({
      code: 'AUTH_INVALID',
    });
  });
});

describe('refresh token', () => {
  it('generates unique random tokens', () => {
    expect(generateRefreshToken()).not.toBe(generateRefreshToken());
    expect(generateRefreshToken()).toHaveLength(64);
  });

  it('hashes deterministically', () => {
    const raw = generateRefreshToken();
    expect(hashRefreshToken(raw)).toBe(hashRefreshToken(raw));
    expect(hashRefreshToken(raw)).not.toBe(raw);
  });

  it('computes a future expiry', () => {
    const base = new Date('2026-01-01T00:00:00Z');
    const exp = refreshTokenExpiry(30, base);
    expect(exp.getTime()).toBe(base.getTime() + 30 * 86400 * 1000);
  });
});
