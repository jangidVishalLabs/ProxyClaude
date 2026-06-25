import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { getConfig } from '../config.js';
import { signAccessToken } from '../lib/jwt.js';

const fakePrisma = { $disconnect: async () => {} } as unknown as Parameters<
  typeof buildServer
>[0]['prismaClient'];

let app: FastifyInstance;

async function tokenFor(role: 'ADMIN' | 'DEVELOPER'): Promise<string> {
  const cfg = getConfig();
  return signAccessToken(
    { sub: 'u1', email: 'u1@x.com', role },
    cfg.JWT_ACCESS_SECRET,
    cfg.ACCESS_TOKEN_TTL,
  );
}

beforeAll(async () => {
  app = await buildServer({ prismaClient: fakePrisma, logLevel: 'silent' });
  app.get('/me', { preHandler: app.authenticate }, async (req) => ({ user: req.user }));
  app.get('/admin', { preHandler: app.requireRole('ADMIN') }, async () => ({ ok: true }));
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('authenticate', () => {
  it('rejects requests without a token (AUTH_INVALID)', async () => {
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH_INVALID');
  });

  it('rejects a malformed bearer token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer not.a.jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a valid token and sets req.user', async () => {
    const token = await tokenFor('DEVELOPER');
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ id: 'u1', role: 'DEVELOPER' });
  });
});

describe('requireRole', () => {
  it('allows the matching role', async () => {
    const token = await tokenFor('ADMIN');
    const res = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('denies a wrong role with ACCESS_DENIED (403)', async () => {
    const token = await tokenFor('DEVELOPER');
    const res = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('ACCESS_DENIED');
  });
});

describe('rate limiting', () => {
  it('returns 429 RATE_LIMITED past the global cap', async () => {
    const limited = await buildServer({
      prismaClient: fakePrisma,
      logLevel: 'silent',
      rateLimitMax: 2,
    });
    await limited.ready();
    const hits = [];
    for (let i = 0; i < 4; i++) {
      hits.push(await limited.inject({ method: 'GET', url: '/health' }));
    }
    const codes = hits.map((h) => h.statusCode);
    expect(codes.filter((c) => c === 200).length).toBe(2);
    const last = hits[hits.length - 1];
    expect(last.statusCode).toBe(429);
    expect(last.json().code).toBe('RATE_LIMITED');
    await limited.close();
  });
});
