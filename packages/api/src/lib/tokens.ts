import { randomBytes, createHash } from 'node:crypto';

/**
 * Opaque refresh tokens (plan §11). The raw token is returned to the client ONCE;
 * only its SHA-256 hash is stored, so a DB leak does not expose usable tokens.
 * Rotation (revoke-old + issue-new) lives in the auth service (Task 4).
 */

export function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function refreshTokenExpiry(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
