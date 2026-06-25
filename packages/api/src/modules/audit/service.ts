import type { PrismaClient } from '@prisma/client';
import type { AuditAction, AuditResult } from '@proxyclaude/shared';

export interface AuditEntry {
  action: AuditAction;
  actorUserId?: string | null;
  targetType?: string;
  targetId?: string;
  ip?: string;
  userAgent?: string;
  result?: AuditResult;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only audit log (plan §12). Writes never throw into the request path —
 * a logging failure must not break the user's action, but is surfaced to the
 * server log by the caller.
 */
export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        action: entry.action,
        actorUserId: entry.actorUserId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
        result: entry.result ?? 'SUCCESS',
        metadata: (entry.metadata ?? undefined) as never,
      },
    });
  }
}
