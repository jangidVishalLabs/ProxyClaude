import fp from 'fastify-plugin';
import { type AuditAction, AuditResult } from '@proxyclaude/shared';
import type { FastifyInstance } from 'fastify';
import { AuditService } from '../modules/audit/service.js';
import { AUDIT_MAP } from '../modules/audit/map.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Handlers may set this to override the default audited action. */
    auditAction?: AuditAction;
  }
}

/**
 * onResponse audit hook (plan §12). Writes one AuditLog row for every mapped
 * sensitive route, deriving SUCCESS/FAILURE from the status code. A logging
 * failure is logged server-side but never affects the response.
 */
export default fp(
  (app: FastifyInstance, _opts: unknown, done: () => void) => {
    const audit = new AuditService(app.prisma);

    app.addHook('onResponse', async (req, reply) => {
      const routeKey = `${req.method} ${req.routeOptions.url ?? ''}`;
      const mapped = AUDIT_MAP[routeKey];
      const failed = reply.statusCode >= 400;

      let action = req.auditAction;
      if (!action && mapped) {
        action = failed && mapped.failure ? mapped.failure : mapped.success;
      }
      if (!action) return; // unmapped route -> not audited

      try {
        await audit.record({
          action,
          actorUserId: req.user?.id ?? null,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          result: failed ? AuditResult.FAILURE : AuditResult.SUCCESS,
          metadata: { path: req.url, status: reply.statusCode },
        });
      } catch (err) {
        req.log.error({ err }, 'failed to write audit log');
      }
    });

    done();
  },
  { name: 'audit', dependencies: ['prisma'] },
);
