import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { AppError, ErrorCode, type Role } from '@proxyclaude/shared';

/**
 * Access-token JWT primitives (plan §11). HS256, short-lived.
 * Pure functions take the secret/ttl as args so they are trivially testable.
 */

export interface AccessTokenClaims {
  sub: string; // user id
  email: string;
  role: Role;
}

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(
  claims: AccessTokenClaims,
  secret: string,
  ttl: string,
): Promise<string> {
  return new SignJWT({ email: claims.email, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(key(secret));
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, key(secret));
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
      throw new AppError(ErrorCode.AUTH_INVALID, 'Malformed token');
    }
    return {
      sub: payload.sub,
      email: payload.email,
      role: payload.role as Role,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof joseErrors.JWTExpired) {
      throw new AppError(ErrorCode.AUTH_TOKEN_EXPIRED, 'Access token expired');
    }
    throw new AppError(ErrorCode.AUTH_INVALID, 'Invalid access token');
  }
}
