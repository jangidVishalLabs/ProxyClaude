import { AppError, ErrorCode, AuditAction, type RegisterSshKeyResponse } from '@proxyclaude/shared';
import type { PrismaClient } from '@prisma/client';
import type { VpsClient } from '../../lib/vps-client.js';
import { sshFingerprint } from '../../lib/ssh-fingerprint.js';
import { AuditService } from '../audit/service.js';

/**
 * SSH key registration (plan §7). Idempotent by fingerprint. When a VpsClient
 * is configured, the key is also installed into the developer's workspace
 * authorized_keys (via install-key.sh) and a KEY_INSTALL job is recorded.
 */
export class SshKeyService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly vps: VpsClient | null = null,
  ) {}

  async register(userId: string, publicKey: string): Promise<RegisterSshKeyResponse> {
    const fingerprint = sshFingerprint(publicKey);

    const existing = await this.prisma.sshKey.findUnique({ where: { fingerprint } });
    if (existing && existing.userId !== userId) {
      throw new AppError(ErrorCode.CONFLICT, 'This key is already registered to another user');
    }

    const key =
      existing ??
      (await this.prisma.sshKey.create({
        data: { userId, publicKey, fingerprint, status: 'ACTIVE' },
      }));

    // Reactivate a previously revoked key.
    if (existing && existing.status === 'REVOKED') {
      await this.prisma.sshKey.update({ where: { id: existing.id }, data: { status: 'ACTIVE' } });
    }

    await this.installOnVps(userId, key.id, publicKey);

    return { fingerprint, status: 'ACTIVE' };
  }

  /** Install the key on the developer's VPS workspace, recording a job. */
  private async installOnVps(userId: string, keyId: string, publicKey: string): Promise<void> {
    if (!this.vps) return; // out-of-band install when provisioner not configured

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.vpsUsername) {
      // No workspace yet; key is registered but not installed. Connect will 409.
      return;
    }

    const audit = new AuditService(this.prisma);
    const job = await this.prisma.provisionJob.create({
      data: { userId, type: 'KEY_INSTALL', status: 'RUNNING', attempts: 1 },
    });
    try {
      await this.vps.installKey(user.vpsUsername, publicKey);
      await this.prisma.provisionJob.update({ where: { id: job.id }, data: { status: 'DONE' } });
      await this.prisma.sshKey.update({
        where: { id: keyId },
        data: { installedAt: new Date() },
      });
      await audit.record({
        action: AuditAction.PROVISION_JOB_RESULT,
        actorUserId: userId,
        targetType: 'ProvisionJob',
        targetId: job.id,
        result: 'SUCCESS',
        metadata: { type: 'KEY_INSTALL' },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.provisionJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', error: message },
      });
      await audit.record({
        action: AuditAction.PROVISION_JOB_RESULT,
        actorUserId: userId,
        targetType: 'ProvisionJob',
        targetId: job.id,
        result: 'FAILURE',
        metadata: { type: 'KEY_INSTALL', error: message },
      });
      throw err instanceof AppError ? err : new AppError(ErrorCode.PROVISION_FAILED, message);
    }
  }

  /** List a user's keys (admin view) so the CLI can resolve a keyId for revoke. */
  async listForUser(
    userId: string,
  ): Promise<{ id: string; fingerprint: string; status: 'ACTIVE' | 'REVOKED'; createdAt: Date }[]> {
    const keys = await this.prisma.sshKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return keys.map((k) => ({
      id: k.id,
      fingerprint: k.fingerprint,
      status: k.status as 'ACTIVE' | 'REVOKED',
      createdAt: k.createdAt,
    }));
  }

  /** Revoke a key: mark REVOKED and remove it from the VPS authorized_keys. */
  async revoke(keyId: string): Promise<void> {
    const key = await this.prisma.sshKey.findUnique({
      where: { id: keyId },
      include: { user: true },
    });
    if (!key) throw new AppError(ErrorCode.NOT_FOUND, 'SSH key not found');

    await this.prisma.sshKey.update({ where: { id: keyId }, data: { status: 'REVOKED' } });

    if (this.vps && key.user.vpsUsername) {
      await this.vps.revokeKey(key.user.vpsUsername, key.publicKey);
    }
  }
}
