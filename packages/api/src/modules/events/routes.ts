import { z } from 'zod';
import { projectSlugSchema, AuditAction } from '@proxyclaude/shared';
import type { FastifyInstance } from 'fastify';

const bodySchema = z.object({ slug: projectSlugSchema });

/**
 * Event ingestion for client-side actions that don't otherwise hit the backend.
 * `sync` runs purely locally, so the CLI reports it here to keep the audit log
 * complete (plan §12). The audit hook records SYNC_REQUEST.
 */
export default async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.post('/events/sync', { preHandler: app.authenticate }, async (req, reply) => {
    bodySchema.parse(req.body);
    req.auditAction = AuditAction.SYNC_REQUEST;
    reply.status(204).send();
  });
}
