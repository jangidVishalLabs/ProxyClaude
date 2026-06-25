import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';

const fakePrisma = { $disconnect: async () => {} } as unknown as Parameters<
  typeof buildServer
>[0]['prismaClient'];

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer({ prismaClient: fakePrisma, logLevel: 'silent' });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe('security headers', () => {
  it('sets HSTS and core helmet headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});
