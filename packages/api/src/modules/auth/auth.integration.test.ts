import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../server.js';
import { hashPassword } from '../../lib/hash.js';

const prisma = new PrismaClient();
let app: FastifyInstance;

async function createUser(email: string, password: string, status: 'ACTIVE' | 'DISABLED') {
  return prisma.user.create({
    data: { email, passwordHash: await hashPassword(password), role: 'DEVELOPER', status },
  });
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
  // Clean slate; order respects FKs.
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
});

describe('POST /auth/login', () => {
  it('returns tokens for valid credentials', async () => {
    await createUser('dev@x.com', 'super-secret-pass', 'ACTIVE');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'dev@x.com', password: 'super-secret-pass' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.user).toMatchObject({ email: 'dev@x.com', role: 'DEVELOPER' });
  });

  it('rejects a wrong password with 401 AUTH_INVALID', async () => {
    await createUser('dev@x.com', 'super-secret-pass', 'ACTIVE');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'dev@x.com', password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH_INVALID');
  });

  it('rejects an unknown user with 401 AUTH_INVALID (no enumeration)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'ghost@x.com', password: 'whatever-123456' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH_INVALID');
  });

  it('blocks a disabled user with 403 USER_DISABLED', async () => {
    await createUser('off@x.com', 'super-secret-pass', 'DISABLED');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'off@x.com', password: 'super-secret-pass' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('USER_DISABLED');
  });

  it('returns 422 for a malformed body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /auth/refresh (rotation)', () => {
  async function loginAndGetRefresh(): Promise<string> {
    await createUser('dev@x.com', 'super-secret-pass', 'ACTIVE');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'dev@x.com', password: 'super-secret-pass' },
    });
    return res.json().refreshToken;
  }

  it('issues a new pair and revokes the old token', async () => {
    const oldRefresh = await loginAndGetRefresh();

    const first = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: oldRefresh },
    });
    expect(first.statusCode).toBe(200);
    const newRefresh = first.json().refreshToken;
    expect(newRefresh).not.toBe(oldRefresh);

    // Old token must no longer work (rotation).
    const reuse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: oldRefresh },
    });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().code).toBe('AUTH_INVALID');

    // New token works.
    const second = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: newRefresh },
    });
    expect(second.statusCode).toBe(200);
  });

  it('rejects an unknown refresh token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'deadbeef'.repeat(8) },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the refresh token (204) and blocks reuse', async () => {
    await createUser('dev@x.com', 'super-secret-pass', 'ACTIVE');
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'dev@x.com', password: 'super-secret-pass' },
    });
    const refreshToken = login.json().refreshToken;

    const out = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refreshToken },
    });
    expect(out.statusCode).toBe(204);

    const after = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    });
    expect(after.statusCode).toBe(401);
  });
});
