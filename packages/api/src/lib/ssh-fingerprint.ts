import { createHash } from 'node:crypto';
import { AppError, ErrorCode } from '@proxyclaude/shared';

/**
 * Compute the OpenSSH SHA256 fingerprint of a public key string, matching
 * `ssh-keygen -lf`. Format: "SHA256:<base64-no-padding>".
 */
export function sshFingerprint(publicKey: string): string {
  const parts = publicKey.trim().split(/\s+/);
  const [type, blob] = parts;
  if (!type || !blob || !/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-)/.test(type)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'Invalid OpenSSH public key');
  }
  let der: Buffer;
  try {
    der = Buffer.from(blob, 'base64');
  } catch {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'Invalid public key encoding');
  }
  if (der.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'Invalid public key encoding');
  }
  const digest = createHash('sha256').update(der).digest('base64').replace(/=+$/, '');
  return `SHA256:${digest}`;
}
