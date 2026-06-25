import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../server.js';
import { getConfig, type AppConfig } from '../../config.js';
import { hashPassword } from '../../lib/hash.js';
import { signAccessToken } from '../../lib/jwt.js';

const prisma = new PrismaClient();
let app: FastifyInstance;

// Inject config with a VPS_HOST so provisioning sets a usable host.
const testConfig: AppConfig = { ...getConfig(), VPS_HOST: '10.0.0.9' };

async function seedUser(email: string, role: 'ADMIN' | 'DEVELOPER', status: 'ACTIVE' | 'DISABLED') {
  return prisma.user.create({
    data: { email, passwordHash: await hashPassword('x'.repeat(12)), role, status },
  });
}
async function adminHeaders() {
  const a = await seedUser('admin@x.com', 'ADMIN', 'ACTIVE');
  const t = await signAccessToken(
    { sub: a.id, email: a.email, role: 'ADMIN' },
    testConfig.JWT_ACCESS_SECRET,
    testConfig.ACCESS_TOKEN_TTL,
  );
  return { authorization: `Bearer ${t}` };
}

beforeAll(async () => {
  app = await buildServer({ prismaClient: prisma, config: testConfig, logLevel: 'silent' });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.provisionJob.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
});

describe('POST /admin/users/:id/provision', () => {
  it('allocates a vps username + host and creates a PENDING job (202)', async () => {
    const headers = await adminHeaders();
    const dev = await seedUser('dev@x.com', 'DEVELOPER', 'ACTIVE');

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${dev.id}/provision`,
      headers,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().user.vpsUsername).toMatch(/^pc_user_/);
    expect(res.json().job).toMatchObject({ type: 'WORKSPACE', status: 'PENDING' });

    const job = await prisma.provisionJob.findFirst({ where: { userId: dev.id } });
    expect(job?.status).toBe('PENDING');
    const updated = await prisma.user.findUnique({ where: { id: dev.id } });
    expect(updated?.vpsHost).toBe('10.0.0.9');
  });

  it('makes a previously-unprovisioned, assigned developer able to connect', async () => {
    const headers = await adminHeaders();
    const dev = await seedUser('dev@x.com', 'DEVELOPER', 'ACTIVE');
    const project = await prisma.project.create({
      data: { slug: 'alpha', name: 'Alpha', vpsPath: '/home/pc/projects/alpha' },
    });
    await prisma.assignment.create({ data: { userId: dev.id, projectId: project.id } });

    const devToken = await signAccessToken(
      { sub: dev.id, email: dev.email, role: 'DEVELOPER' },
      testConfig.JWT_ACCESS_SECRET,
      testConfig.ACCESS_TOKEN_TTL,
    );
    const devHeaders = { authorization: `Bearer ${devToken}` };

    // Before provisioning: 409.
    const before = await app.inject({ method: 'POST', url: '/connect/alpha', headers: devHeaders });
    expect(before.statusCode).toBe(409);

    await app.inject({ method: 'POST', url: `/admin/users/${dev.id}/provision`, headers });

    // After provisioning: 200 with config.
    const after = await app.inject({ method: 'POST', url: '/connect/alpha', headers: devHeaders });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toMatchObject({ host: '10.0.0.9', port: 22, tmuxName: 'alpha' });
  });

  it('reuses the same username on re-provision (idempotent identity)', async () => {
    const headers = await adminHeaders();
    const dev = await seedUser('dev@x.com', 'DEVELOPER', 'ACTIVE');

    const r1 = await app.inject({
      method: 'POST',
      url: `/admin/users/${dev.id}/provision`,
      headers,
    });
    const r2 = await app.inject({
      method: 'POST',
      url: `/admin/users/${dev.id}/provision`,
      headers,
    });
    expect(r1.json().user.vpsUsername).toBe(r2.json().user.vpsUsername);
    const jobs = await prisma.provisionJob.count({ where: { userId: dev.id } });
    expect(jobs).toBe(2); // each request records a job
  });

  it('refuses to provision a disabled user (409)', async () => {
    const headers = await adminHeaders();
    const dev = await seedUser('off@x.com', 'DEVELOPER', 'DISABLED');
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${dev.id}/provision`,
      headers,
    });
    expect(res.statusCode).toBe(409);
  });

  it('denies a developer (403)', async () => {
    const dev = await seedUser('dev@x.com', 'DEVELOPER', 'ACTIVE');
    const t = await signAccessToken(
      { sub: dev.id, email: dev.email, role: 'DEVELOPER' },
      testConfig.JWT_ACCESS_SECRET,
      testConfig.ACCESS_TOKEN_TTL,
    );
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${dev.id}/provision`,
      headers: { authorization: `Bearer ${t}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
