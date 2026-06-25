import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../server.js';
import { getConfig } from '../../config.js';
import { hashPassword } from '../../lib/hash.js';
import { signAccessToken } from '../../lib/jwt.js';

const prisma = new PrismaClient();
let app: FastifyInstance;

async function user(email: string, role: 'ADMIN' | 'DEVELOPER') {
  return prisma.user.create({
    data: { email, passwordHash: await hashPassword('x'.repeat(12)), role, status: 'ACTIVE' },
  });
}
async function project(slug: string) {
  return prisma.project.create({
    data: { slug, name: slug, vpsPath: `/home/u/projects/${slug}`, defaultBranch: 'main' },
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

describe('GET /projects', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/projects' });
    expect(res.statusCode).toBe(401);
  });

  it('returns only assigned projects for a developer', async () => {
    const dev = await user('dev@x.com', 'DEVELOPER');
    const a = await project('alpha');
    await project('beta');
    await prisma.assignment.create({ data: { userId: dev.id, projectId: a.id } });

    const token = await tokenFor(dev.id, dev.email, 'DEVELOPER');
    const res = await app.inject({
      method: 'GET',
      url: '/projects',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().projects.map((p: { slug: string }) => p.slug)).toEqual(['alpha']);
  });

  it('returns all projects for an admin', async () => {
    const admin = await user('admin@x.com', 'ADMIN');
    await project('alpha');
    await project('beta');

    const token = await tokenFor(admin.id, admin.email, 'ADMIN');
    const res = await app.inject({
      method: 'GET',
      url: '/projects',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().projects.map((p: { slug: string }) => p.slug)).toEqual(['alpha', 'beta']);
  });

  it('does not leak internal fields (vpsPath) in the DTO', async () => {
    const admin = await user('admin@x.com', 'ADMIN');
    await project('alpha');
    const token = await tokenFor(admin.id, admin.email, 'ADMIN');
    const res = await app.inject({
      method: 'GET',
      url: '/projects',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.body).not.toContain('vpsPath');
    expect(res.json().projects[0]).toHaveProperty('defaultBranch');
  });
});
