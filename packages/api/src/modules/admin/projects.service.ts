import {
  AppError,
  ErrorCode,
  type CreateProjectRequest,
  type UpdateProjectRequest,
} from '@proxyclaude/shared';
import { Prisma, type PrismaClient, type Project, type Assignment } from '@prisma/client';

/**
 * Admin operations on projects and assignments (plan §10).
 * Authorization (ADMIN) is enforced at the route layer.
 */
export class AdminProjectService {
  constructor(private readonly prisma: PrismaClient) {}

  async createProject(input: CreateProjectRequest): Promise<Project> {
    try {
      return await this.prisma.project.create({
        data: {
          slug: input.slug,
          name: input.name,
          repoUrl: input.repoUrl ?? null,
          vpsPath: input.vpsPath,
          defaultBranch: input.defaultBranch,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(ErrorCode.CONFLICT, 'A project with this slug already exists');
      }
      throw err;
    }
  }

  /** Partially update a project by id. NOT_FOUND if it does not exist. */
  async updateProject(id: string, input: UpdateProjectRequest): Promise<Project> {
    const existing = await this.prisma.project.findUnique({ where: { id } });
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, 'Project not found');
    return this.prisma.project.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.repoUrl !== undefined ? { repoUrl: input.repoUrl } : {}),
        ...(input.vpsPath !== undefined ? { vpsPath: input.vpsPath } : {}),
        ...(input.defaultBranch !== undefined ? { defaultBranch: input.defaultBranch } : {}),
      },
    });
  }

  async assign(userId: string, projectId: string): Promise<Assignment> {
    // Validate both ends exist for clear 404s instead of an opaque FK error.
    const [user, project] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.project.findUnique({ where: { id: projectId } }),
    ]);
    if (!user) throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
    if (!project) throw new AppError(ErrorCode.NOT_FOUND, 'Project not found');

    try {
      return await this.prisma.assignment.create({ data: { userId, projectId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(ErrorCode.CONFLICT, 'User is already assigned to this project');
      }
      throw err;
    }
  }
}
