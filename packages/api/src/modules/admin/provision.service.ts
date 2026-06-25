import { AppError, ErrorCode, AuditAction } from '@proxyclaude/shared';
import type { PrismaClient, ProvisionJob } from '@prisma/client';
import type { AppConfig } from '../../config.js';
import type { VpsClient } from '../../lib/vps-client.js';
import { AuditService } from '../audit/service.js';
import { toUserDto, type UserDto } from './service.js';

/**
 * Workspace provisioning control plane (plan §6, §10).
 *
 * Phase 3 scope: allocate the user's VPS identity and record a ProvisionJob
 * (the intent + audit trail). The actual VPS-side execution (adduser, dirs,
 * toolchain) is wired in Phase 4 via a vps-client that consumes PENDING jobs
 * and calls markRunning/markDone/markFailed below.
 */
export class ProvisioningService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    /** When provided, the workspace is actually created on the VPS. When null,
     * the job is left PENDING for out-of-band execution. */
    private readonly vps: VpsClient | null = null,
  ) {}

  async provisionWorkspace(userId: string): Promise<{ user: UserDto; job: ProvisionJob }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
    }
    if (user.status === 'DISABLED') {
      throw new AppError(ErrorCode.CONFLICT, 'Cannot provision a disabled user');
    }

    // Allocate a stable, unique Linux username once; reuse on re-provision.
    const vpsUsername = user.vpsUsername ?? `pc_user_${user.id.slice(-10)}`;
    const vpsHost = user.vpsHost ?? this.config.VPS_HOST ?? null;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { vpsUsername, vpsHost },
    });

    let job = await this.prisma.provisionJob.create({
      data: { userId, type: 'WORKSPACE', status: 'PENDING' },
    });

    if (this.vps) {
      const audit = new AuditService(this.prisma);
      try {
        await this.markRunning(job.id);
        await this.vps.createWorkspace(vpsUsername);
        job = await this.markDone(job.id);
        await audit.record({
          action: AuditAction.PROVISION_JOB_RESULT,
          actorUserId: userId,
          targetType: 'ProvisionJob',
          targetId: job.id,
          result: 'SUCCESS',
          metadata: { type: 'WORKSPACE' },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        job = await this.markFailed(job.id, message);
        await audit.record({
          action: AuditAction.PROVISION_JOB_RESULT,
          actorUserId: userId,
          targetType: 'ProvisionJob',
          targetId: job.id,
          result: 'FAILURE',
          metadata: { type: 'WORKSPACE', error: message },
        });
        throw err instanceof AppError ? err : new AppError(ErrorCode.PROVISION_FAILED, message);
      }
    }

    return { user: toUserDto(updated), job };
  }

  // --- lifecycle helpers consumed by the Phase 4 vps-client ---

  markRunning(jobId: string): Promise<ProvisionJob> {
    return this.prisma.provisionJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING', attempts: { increment: 1 } },
    });
  }

  markDone(jobId: string): Promise<ProvisionJob> {
    return this.prisma.provisionJob.update({
      where: { id: jobId },
      data: { status: 'DONE', error: null },
    });
  }

  markFailed(jobId: string, error: string): Promise<ProvisionJob> {
    return this.prisma.provisionJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', error },
    });
  }
}
