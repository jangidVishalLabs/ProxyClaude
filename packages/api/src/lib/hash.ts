import argon2 from 'argon2';

/**
 * Password hashing (plan §11). argon2id = memory-hard, OWASP-recommended.
 * Defaults are argon2's safe defaults; tuned values can come later.
 */

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
