import { loginRequestSchema, refreshRequestSchema } from '@proxyclaude/shared';
import type { FastifyInstance } from 'fastify';
import { AuthService } from './service.js';

/**
 * Auth routes (plan §4). Bodies validated with shared Zod schemas;
 * ZodError is mapped to 422 by the central error handler.
 */
export default async function authRoutes(app: FastifyInstance): Promise<void> {
  const service = new AuthService(app.prisma, app.config);

  // Tighter limit on credential endpoints to slow brute force (plan §11).
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/auth/login', strict, async (req) => {
    const { email, password } = loginRequestSchema.parse(req.body);
    const result = await service.login(email, password);
    // Attribute the LOGIN audit entry to this user (no auth preHandler here).
    req.user = { id: result.user.id, email: result.user.email, role: result.user.role };
    return result;
  });

  app.post('/auth/refresh', strict, async (req) => {
    const { refreshToken } = refreshRequestSchema.parse(req.body);
    return service.refresh(refreshToken);
  });

  app.post('/auth/logout', async (req, reply) => {
    const { refreshToken } = refreshRequestSchema.parse(req.body);
    await service.logout(refreshToken);
    reply.status(204).send();
  });
}
