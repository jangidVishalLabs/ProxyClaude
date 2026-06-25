import { z } from 'zod';
import { projectSlugSchema, AuditAction } from '@proxyclaude/shared';
import type { FastifyInstance } from 'fastify';
import { ConnectService } from './service.js';

const paramsSchema = z.object({ slug: projectSlugSchema });
const bodySchema = z.object({ reconnect: z.boolean().optional() }).optional();

/**
 * Connect route (plan §5). Returns SSH/tmux config for an accessible project.
 * The CLI passes { reconnect: true } so the audit log can distinguish
 * reconnect from an initial connect (same tmux session either way).
 */
export default async function connectRoutes(app: FastifyInstance): Promise<void> {
  const service = new ConnectService(app.prisma, app.config);

  app.post('/connect/:slug', { preHandler: app.authenticate }, async (req) => {
    const { slug } = paramsSchema.parse(req.params);
    const body = bodySchema.parse(req.body);
    if (body?.reconnect) req.auditAction = AuditAction.RECONNECT;
    return service.getConnectInfo(req.user!, slug);
  });
}
