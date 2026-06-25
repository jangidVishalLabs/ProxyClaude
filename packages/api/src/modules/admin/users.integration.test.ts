import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../server.js';
import { getConfig } from '../../config.js';
import { hashPassword } from '../../lib/hash.js';
import { signAccessToken } from '../../lib/jwt.js';

const prisma = new PrismaClient();
let app: FastifyInstance;

async function seedUser(email: string, role: 'ADMIN' | 'DEVELOPER') {
  return prisma.user.create({
    data: { email, passwordHash: await hashPassword('x'.repeat(12)), role, status: 'ACTIVE' },
  });
}
async function token(id: string, email: string, role: 'ADMIN' | 'DEVELOPER') {
  const cfg = getConfig();
  return signAccessToken({ sub: id, email, role }, cfg.JWT_ACCESS_SECRET, cfg.ACCESS_TOKEN_TTL);
}
async function adminAuth() {
  const a = await seedUser('admin@x.com', 'ADMIN');
  return { user: a, headers: { authorization: `Bearer ${await token(a.id, a.email, 'ADMIN')}` } };
}

beforeAll(async () => {
  app = await buildServer({ prismaClient: prisma, logLevel: 'silent' });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.refreshToken.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.user.deleteMany();
});

describe('POST /admin/users', () => {
  it('creates a user (201) without leaking the password hash', async () => {
    const { headers } = await adminAuth();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers,
      payload: { email: 'new@x.com', password: 'a-strong-password', role: 'DEVELOPER' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ email: 'new@x.com', role: 'DEVELOPER', status: 'ACTIVE' });
    expect(res.body).not.toContain('passwordHash');
  });

  it('rejects a duplicate email with 409 CONFLICT', async () => {
    const { headers } = await adminAuth();
    const payload = { email: 'dupe@x.com', password: 'a-strong-password', role: 'DEVELOPER' };
    await app.inject({ method: 'POST', url: '/admin/users', headers, payload });
    const res = await app.inject({ method: 'POST', url: '/admin/users', headers, payload });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CONFLICT');
  });

  it('denies a developer (403 ACCESS_DENIED)', async () => {
    const dev = await seedUser('dev@x.com', 'DEVELOPER');
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${await token(dev.id, dev.email, 'DEVELOPER')}` },
      payload: { email: 'x@x.com', password: 'a-strong-password', role: 'DEVELOPER' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('ACCESS_DENIED');
  });

  it('requires authentication (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: { email: 'x@x.com', password: 'a-strong-password', role: 'DEVELOPER' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('validates the body (422 on weak password)', async () => {
    const { headers } = await adminAuth();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers,
      payload: { email: 'x@x.com', password: 'short' },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('PATCH /admin/users/:id/disable', () => {
  it('disables a user and blocks their subsequent login', async () => {
    const { headers } = await adminAuth();
    // create a developer with a known password via the admin API
    const created = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers,
      payload: { email: 'victim@x.com', password: 'a-strong-password', role: 'DEVELOPER' },
    });
    const id = created.json().id;

    const dis = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${id}/disable`,
      headers,
    });
    expect(dis.statusCode).toBe(200);
    expect(dis.json().status).toBe('DISABLED');

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'victim@x.com', password: 'a-strong-password' },
    });
    expect(login.statusCode).toBe(403);
    expect(login.json().code).toBe('USER_DISABLED');
  });

  it('returns 404 for a missing user', async () => {
    const { headers } = await adminAuth();
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/nonexistent/disable',
      headers,
    });
    expect(res.statusCode).toBe(404);
  });

  it('denies a developer (403)', async () => {
    const dev = await seedUser('dev@x.com', 'DEVELOPER');
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${dev.id}/disable`,
      headers: { authorization: `Bearer ${await token(dev.id, dev.email, 'DEVELOPER')}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
