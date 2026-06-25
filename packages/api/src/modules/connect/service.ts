import { AppError, ErrorCode, type ConnectResponse } from '@proxyclaude/shared';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../../config.js';
import type { AuthUser } from '../../plugins/auth.js';
import { ProjectService } from '../projects/service.js';
import { SessionService } from '../sessions/service.js';

/**
 * Connect-info service (plan §5, §6). Enforces project access, then assembles
 * the SSH/tmux connection config the CLI needs. Access is checked server-side
 * on every request — the CLI never decides what it may reach.
 */
export class ConnectService {
  private readonly projects: ProjectService;
  private readonly sessions: SessionService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
  ) {
    this.projects = new ProjectService(prisma);
    this.sessions = new SessionService(prisma);
  }

  async getConnectInfo(user: AuthUser, slug: string): Promise<ConnectResponse> {
    // Throws ACCESS_DENIED / NOT_FOUND if the user may not reach this project.
    const project = await this.projects.getAccessibleProject(user, slug);

    const dbUser = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser || !dbUser.vpsUsername || !dbUser.vpsHost) {
      throw new AppError(
        ErrorCode.CONFLICT,
        'Workspace not provisioned yet. Ask an admin to provision your VPS workspace.',
      );
    }

    await this.sessions.recordConnect(user.id, project.id, project.slug);

    return {
      host: dbUser.vpsHost,
      port: this.config.VPS_SSH_PORT,
      vpsUsername: dbUser.vpsUsername,
      projectPath: project.vpsPath,
      tmuxName: project.slug,
    };
  }
}
