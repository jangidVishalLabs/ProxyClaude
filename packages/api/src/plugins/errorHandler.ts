import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { AppError, ErrorCode, httpStatusForCode } from '@proxyclaude/shared';
import type { FastifyError, FastifyInstance } from 'fastify';

/**
 * Central error handler (plan §13). Maps every thrown error to a consistent
 * { code, message, details? } body. Never leaks stack traces or internals.
 */
export default fp(
  (app: FastifyInstance, _opts: unknown, done: () => void) => {
    app.setErrorHandler((err: FastifyError, req, reply) => {
      // Our typed domain errors.
      if (err instanceof AppError) {
        reply.status(err.httpStatus).send(err.toBody());
        return;
      }

      // Zod validation failures (manual .parse in handlers).
      if (err instanceof ZodError) {
        reply.status(httpStatusForCode(ErrorCode.VALIDATION_FAILED)).send({
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Request validation failed',
          details: err.issues,
        });
        return;
      }

      // Fastify's own schema validation.
      if (err.validation) {
        reply.status(httpStatusForCode(ErrorCode.VALIDATION_FAILED)).send({
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Request validation failed',
          details: err.validation,
        });
        return;
      }

      // Fastify rate-limit and other tagged status codes.
      if (err.statusCode === 429) {
        reply.status(429).send({ code: ErrorCode.RATE_LIMITED, message: 'Too many requests' });
        return;
      }

      // Unknown -> 500, log server-side, hide details from client.
      req.log.error({ err }, 'unhandled error');
      reply
        .status(httpStatusForCode(ErrorCode.INTERNAL))
        .send({ code: ErrorCode.INTERNAL, message: 'Internal server error' });
    });
    done();
  },
  { name: 'error-handler' },
);
