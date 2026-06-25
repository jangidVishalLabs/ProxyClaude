import { describe, it, expect, afterEach } from 'vitest';
import { AppError, ErrorCode } from '@proxyclaude/shared';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';

// A fake PrismaClient so the server never touches a real DB in unit tests.
const fakePrisma = { $disconnect: async () => {} } as unknown as Parameters<
  typeof buildServer
>[0]['prismaClient'];

let app: FastifyInstance;

afterEach(async () => {
  if (app) await app.close();
});

describe('server', () => {
  it('health returns ok', async () => {
    app = await buildServer({ prismaClient: fakePrisma, logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('decorates prisma', async () => {
    app = await buildServer({ prismaClient: fakePrisma, logLevel: 'silent' });
    expect(app.prisma).toBe(fakePrisma);
  });

  it('maps AppError to its http status + body', async () => {
    app = await buildServer({ prismaClient: fakePrisma, logLevel: 'silent' });
    app.get('/boom', async () => {
      throw new AppError(ErrorCode.ACCESS_DENIED, 'nope');
    });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'ACCESS_DENIED', message: 'nope' });
  });

  it('maps ZodError to 422 VALIDATION_FAILED', async () => {
    app = await buildServer({ prismaClient: fakePrisma, logLevel: 'silent' });
    app.get('/zod', async () => {
      z.object({ a: z.string() }).parse({ a: 1 });
      return {};
    });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/zod' });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('VALIDATION_FAILED');
  });

  it('maps unknown errors to 500 INTERNAL without leaking detail', async () => {
    app = await buildServer({ prismaClient: fakePrisma, logLevel: 'silent' });
    app.get('/explode', async () => {
      throw new Error('secret internal detail');
    });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/explode' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ code: 'INTERNAL', message: 'Internal server error' });
    expect(res.body).not.toContain('secret internal detail');
  });
});
