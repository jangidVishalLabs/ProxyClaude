import { AppError, ErrorCode, type Project as ProjectDto } from '@proxyclaude/shared';
import type { PrismaClient, Project } from '@prisma/client';
import type { AuthUser } from '../../plugins/auth.js';

/**
 * Project access logic (plan §2, §11). The core guarantee: a DEVELOPER only ever
 * sees or reaches projects they are explicitly assigned to. ADMIN sees all.
 */
export class ProjectService {
  constructor(private readonly prisma: PrismaClient) {}

  async listForUser(user: Pick<AuthUser, 'id' | 'role'>): Promise<Project[]> {
    if (user.role === 'ADMIN') {
      return this.prisma.project.findMany({ orderBy: { slug: 'asc' } });
    }
    const assignments = await this.prisma.assignment.findMany({
      where: { userId: user.id },
      include: { project: true },
      orderBy: { project: { slug: 'asc' } },
    });
    return assignments.map((a) => a.project);
  }

  /**
   * Returns the project only if the user may access it; otherwise throws.
   * NOT_FOUND for a missing slug, ACCESS_DENIED for an unassigned developer.
   */
  async getAccessibleProject(user: Pick<AuthUser, 'id' | 'role'>, slug: string): Promise<Project> {
    const project = await this.prisma.project.findUnique({ where: { slug } });
    if (!project) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Project not found');
    }
    if (user.role === 'ADMIN') {
      return project;
    }
    const assignment = await this.prisma.assignment.findUnique({
      where: { userId_projectId: { userId: user.id, projectId: project.id } },
    });
    if (!assignment) {
      throw new AppError(ErrorCode.ACCESS_DENIED, 'Not assigned to this project');
    }
    return project;
  }
}

/** Map a DB Project to the client-facing DTO (drops internal fields). */
export function toProjectDto(p: Project): ProjectDto {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    repoUrl: p.repoUrl,
    defaultBranch: p.defaultBranch,
  };
}
