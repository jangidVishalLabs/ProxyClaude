import fp from 'fastify-plugin';
import { AppError, ErrorCode, type Role } from '@proxyclaude/shared';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { verifyAccessToken } from '../lib/jwt.js';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
  interface FastifyInstance {
    /** preHandler: requires a valid access token; sets req.user. */
    authenticate: preHandlerHookHandler;
    /** preHandler factory: authenticates, then requires one of the given roles. */
    requireRole: (...roles: Role[]) => preHandlerHookHandler;
  }
}

/**
 * RBAC (plan §11). `authenticate` verifies the Bearer access token and attaches
 * req.user. `requireRole` builds on it to gate by role. Failures throw typed
 * AppErrors that the central error handler renders.
 */
export default fp(
  (app: FastifyInstance, _opts: unknown, done: () => void) => {
    const authenticate = async (req: FastifyRequest): Promise<void> => {
      const header = req.headers.authorization;
      if (!header || !header.startsWith('Bearer ')) {
        throw new AppError(ErrorCode.AUTH_INVALID, 'Missing bearer token');
      }
      const claims = await verifyAccessToken(header.slice(7), app.config.JWT_ACCESS_SECRET);
      req.user = { id: claims.sub, email: claims.email, role: claims.role };
    };

    app.decorate('authenticate', authenticate);

    app.decorate('requireRole', (...roles: Role[]): preHandlerHookHandler => {
      return async (req: FastifyRequest): Promise<void> => {
        await authenticate(req);
        if (!req.user || !roles.includes(req.user.role)) {
          throw new AppError(ErrorCode.ACCESS_DENIED, 'Insufficient role');
        }
      };
    });

    done();
  },
  { name: 'auth', dependencies: ['config'] },
);
