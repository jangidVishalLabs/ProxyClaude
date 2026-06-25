import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from './config.js';
import configPlugin from './plugins/config.js';
import prismaPlugin from './plugins/prisma.js';
import authPlugin from './plugins/auth.js';
import auditPlugin from './plugins/audit.js';
import errorHandlerPlugin from './plugins/errorHandler.js';
import authRoutes from './modules/auth/routes.js';
import projectRoutes from './modules/projects/routes.js';
import connectRoutes from './modules/connect/routes.js';
import adminRoutes from './modules/admin/routes.js';
import sshKeyRoutes from './modules/ssh-keys/routes.js';
import sessionRoutes from './modules/sessions/routes.js';
import eventRoutes from './modules/events/routes.js';

export interface BuildServerOptions {
  /** Inject a PrismaClient (e.g. a test client). */
  prismaClient?: PrismaClient;
  /** Inject config (defaults to getConfig() from env). */
  config?: AppConfig;
  /** Pino log level; 'silent' in tests. */
  logLevel?: string;
  /** Global rate-limit max per minute (default 300). */
  rateLimitMax?: number;
}

/**
 * Build (but do not start) the Fastify app. Pure factory so tests can
 * inject dependencies and use app.inject() without binding a port.
 */
export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: opts.logLevel ?? 'info' },
    disableRequestLogging: true,
  });

  await app.register(errorHandlerPlugin);
  // Security headers incl. HSTS (plan §11). TLS itself is terminated at Caddy.
  await app.register(helmet, {
    hsts: { maxAge: 31536000, includeSubDomains: true },
  });
  await app.register(configPlugin, { config: opts.config });
  await app.register(prismaPlugin, { client: opts.prismaClient });
  await app.register(authPlugin);
  await app.register(auditPlugin);
  await app.register(rateLimit, {
    global: true,
    max: opts.rateLimitMax ?? 300,
    timeWindow: '1 minute',
  });

  app.get('/health', async () => ({ status: 'ok' }));
  await app.register(authRoutes);
  await app.register(projectRoutes);
  await app.register(connectRoutes);
  await app.register(adminRoutes);
  await app.register(sshKeyRoutes);
  await app.register(sessionRoutes);
  await app.register(eventRoutes);

  return app;
}
