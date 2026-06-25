import type { FastifyInstance } from 'fastify';
import type { ProjectsResponse } from '@proxyclaude/shared';
import { ProjectService, toProjectDto } from './service.js';

/**
 * Project routes (plan §4). Requires authentication; results are scoped to the
 * caller's role inside the service (developer => assigned only).
 */
export default async function projectRoutes(app: FastifyInstance): Promise<void> {
  const service = new ProjectService(app.prisma);

  app.get('/projects', { preHandler: app.authenticate }, async (req): Promise<ProjectsResponse> => {
    const projects = await service.listForUser(req.user!);
    return { projects: projects.map(toProjectDto) };
  });
}
