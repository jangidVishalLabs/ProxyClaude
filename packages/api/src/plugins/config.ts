import fp from 'fastify-plugin';
import { getConfig, type AppConfig } from '../config.js';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
  }
}

/** Decorates the server with validated config (injectable for tests). */
export default fp(
  (app: FastifyInstance, opts: { config?: AppConfig }, done: () => void) => {
    app.decorate('config', opts.config ?? getConfig());
    done();
  },
  { name: 'config' },
);
