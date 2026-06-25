import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../server.js';
import { getConfig } from '../../config.js';
import { hashPassword } from '../../lib/hash.js';
import { signAccessToken } from '../../lib/jwt.js';

const prisma = new PrismaClient();
let app: FastifyInstance;

async function user(
  email: string,
  role: 'ADMIN' | 'DEVELOPER',
  vps?: { username: string; host: string },
) {
  return prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword('x'.repeat(12)),
      role,
      status: 'ACTIVE',
      vpsUsername: vps?.username ?? null,
      vpsHost: vps?.host ?? null,
    },
  });
}
async function project(slug: string) {
  return prisma.project.create({
    data: { slug, name: slug, vpsPath: `/home/pc/projects/${slug}`, defaultBranch: 'main' },
  });
}
async function tokenFor(id: string, email: string, role: 'ADMIN' | 'DEVELOPER') {
  const cfg = getConfig();
  return signAccessToken({ sub: id, email, role }, cfg.JWT_ACCESS_SECRET, cfg.ACCESS_TOKEN_TTL);
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
  await prisma.assignment.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
});

describe('POST /connect/:slug', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'POST', url: '/connect/alpha' });
    expect(res.statusCode).toBe(401);
  });

  it('returns connect config for an assigned, provisioned developer', async () => {
    const dev = await user('dev@x.com', 'DEVELOPER', { username: 'pc_user_1', host: '10.0.0.5' });
    const a = await project('alpha');
    await prisma.assignment.create({ data: { userId: dev.id, projectId: a.id } });

    const token = await tokenFor(dev.id, dev.email, 'DEVELOPER');
    const res = await app.inject({
      method: 'POST',
      url: '/connect/alpha',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      host: '10.0.0.5',
      port: 22,
      vpsUsername: 'pc_user_1',
      projectPath: '/home/pc/projects/alpha',
      tmuxName: 'alpha',
    });
  });

  it('denies an unassigned developer with 403 ACCESS_DENIED', async () => {
    const dev = await user('dev@x.com', 'DEVELOPER', { username: 'pc_user_1', host: '10.0.0.5' });
    await project('alpha');
    const token = await tokenFor(dev.id, dev.email, 'DEVELOPER');
    const res = await app.inject({
      method: 'POST',
      url: '/connect/alpha',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('ACCESS_DENIED');
  });

  it('returns 409 CONFLICT when the workspace is not provisioned', async () => {
    const dev = await user('dev@x.com', 'DEVELOPER'); // no vps fields
    const a = await project('alpha');
    await prisma.assignment.create({ data: { userId: dev.id, projectId: a.id } });
    const token = await tokenFor(dev.id, dev.email, 'DEVELOPER');
    const res = await app.inject({
      method: 'POST',
      url: '/connect/alpha',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CONFLICT');
  });

  it('returns 404 for a missing project', async () => {
    const admin = await user('admin@x.com', 'ADMIN', { username: 'pc_admin', host: '10.0.0.1' });
    const token = await tokenFor(admin.id, admin.email, 'ADMIN');
    const res = await app.inject({
      method: 'POST',
      url: '/connect/ghost',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });
});
