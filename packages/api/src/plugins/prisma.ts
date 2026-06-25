import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

/**
 * Decorates the server with a single shared PrismaClient and closes it on shutdown.
 * Accepts an injected client for tests.
 */
export default fp(
  async (app: FastifyInstance, opts: { client?: PrismaClient }) => {
    const prisma = opts.client ?? new PrismaClient();
    app.decorate('prisma', prisma);
    app.addHook('onClose', async () => {
      await prisma.$disconnect();
    });
  },
  { name: 'prisma' },
);
