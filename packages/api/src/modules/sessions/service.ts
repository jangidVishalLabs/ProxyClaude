import type { PrismaClient } from '@prisma/client';
import type { SessionsResponse } from '@proxyclaude/shared';

/**
 * Session tracking (plan §8). The tmux session on the VPS is the source of
 * truth for liveness; these rows give admins/`status` visibility and a
 * heartbeat-updated lastSeenAt. One ACTIVE row per (user, project).
 */
export class SessionService {
  constructor(private readonly prisma: PrismaClient) {}

  async recordConnect(userId: string, projectId: string, tmuxName: string): Promise<void> {
    const existing = await this.prisma.session.findFirst({
      where: { userId, projectId, status: 'ACTIVE' },
    });
    if (existing) {
      await this.prisma.session.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date(), tmuxName },
      });
    } else {
      await this.prisma.session.create({
        data: { userId, projectId, tmuxName, status: 'ACTIVE' },
      });
    }
  }

  async heartbeat(userId: string): Promise<number> {
    const res = await this.prisma.session.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { lastSeenAt: new Date() },
    });
    return res.count;
  }

  async listActive(userId: string): Promise<SessionsResponse> {
    const rows = await this.prisma.session.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { project: true },
      orderBy: { lastSeenAt: 'desc' },
    });
    return {
      sessions: rows.map((s) => ({
        id: s.id,
        projectSlug: s.project.slug,
        tmuxName: s.tmuxName,
        status: s.status,
        lastSeenAt: s.lastSeenAt.toISOString(),
      })),
    };
  }
}
