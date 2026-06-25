import type { FastifyInstance } from 'fastify';
import { SessionService } from './service.js';

/** Session routes (plan §8). Authenticated; scoped to the caller. */
export default async function sessionRoutes(app: FastifyInstance): Promise<void> {
  const service = new SessionService(app.prisma);

  app.get('/sessions', { preHandler: app.authenticate }, async (req) =>
    service.listActive(req.user!.id),
  );

  app.post('/sessions/heartbeat', { preHandler: app.authenticate }, async (req) => ({
    updated: await service.heartbeat(req.user!.id),
  }));
}
