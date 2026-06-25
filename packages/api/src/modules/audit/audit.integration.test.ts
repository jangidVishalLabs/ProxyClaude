import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../server.js';
import { getConfig, type AppConfig } from '../../config.js';
import { hashPassword } from '../../lib/hash.js';
import { signAccessToken } from '../../lib/jwt.js';
import { ProvisioningService } from '../admin/provision.service.js';
import type { VpsClient } from '../../lib/vps-client.js';

const prisma = new PrismaClient();
let app: FastifyInstance;
const cfg: AppConfig = { ...getConfig(), VPS_HOST: '10.0.0.9' };

async function token(id: string, email: string, role: 'ADMIN' | 'DEVELOPER') {
  return signAccessToken({ sub: id, email, role }, cfg.JWT_ACCESS_SECRET, cfg.ACCESS_TOKEN_TTL);
}

async function actionsLogged(): Promise<Set<string>> {
  const rows = await prisma.auditLog.findMany();
  return new Set(rows.map((r) => r.action));
}

/**
 * Audit rows are written in the onResponse hook, which completes AFTER the
 * response is sent (so it never adds latency). In tests we poll briefly for the
 * write to land rather than asserting synchronously.
 */
async function waitForActions(expected: string[], timeoutMs = 3000): Promise<Set<string>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const logged = await actionsLogged();
    if (expected.every((a) => logged.has(a))) return logged;
    if (Date.now() > deadline) return logged;
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  app = await buildServer({ prismaClient: prisma, config: cfg, logLevel: 'silent' });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.sshKey.deleteMany();
  await prisma.provisionJob.deleteMany();
  await prisma.session.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
});

describe('audit logging', () => {
  it('records LOGIN and LOGIN_FAILED with the right actor + result', async () => {
    const dev = await prisma.user.create({
      data: {
        email: 'dev@x.com',
        passwordHash: await hashPassword('super-secret-pass'),
        role: 'DEVELOPER',
        status: 'ACTIVE',
      },
    });

    await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'dev@x.com', password: 'wrong' },
    });
    await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'dev@x.com', password: 'super-secret-pass' },
    });

    await waitForActions(['LOGIN', 'LOGIN_FAILED']);
    const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    const failed = rows.find((r) => r.action === 'LOGIN_FAILED');
    const ok = rows.find((r) => r.action === 'LOGIN');
    expect(failed?.result).toBe('FAILURE');
    expect(failed?.actorUserId).toBeNull(); // no actor on failed login
    expect(ok?.result).toBe('SUCCESS');
    expect(ok?.actorUserId).toBe(dev.id);
  });

  it('covers all 13 audit actions across the surface', async () => {
    // admin + a dev, provisioned
    const admin = await prisma.user.create({
      data: {
        email: 'admin@x.com',
        passwordHash: await hashPassword('super-secret-pass'),
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    const adminHeaders = { authorization: `Bearer ${await token(admin.id, admin.email, 'ADMIN')}` };

    // ADMIN_USER_CREATE
    const created = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: adminHeaders,
      payload: { email: 'dev@x.com', password: 'super-secret-pass', role: 'DEVELOPER' },
    });
    const devId = created.json().id;

    // project + ADMIN_ASSIGNMENT
    const project = await prisma.project.create({
      data: { slug: 'alpha', name: 'Alpha', vpsPath: '/home/pc_user_x/projects/alpha' },
    });
    await app.inject({
      method: 'POST',
      url: '/admin/assignments',
      headers: adminHeaders,
      payload: { userId: devId, projectId: project.id },
    });

    // give the dev a workspace identity so connect works
    await prisma.user.update({
      where: { id: devId },
      data: { vpsUsername: 'pc_user_x', vpsHost: '10.0.0.9' },
    });
    const devHeaders = { authorization: `Bearer ${await token(devId, 'dev@x.com', 'DEVELOPER')}` };

    // LOGIN + LOGOUT
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'dev@x.com', password: 'super-secret-pass' },
    });
    await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refreshToken: login.json().refreshToken },
    });

    // PROJECTS_LIST
    await app.inject({ method: 'GET', url: '/projects', headers: devHeaders });
    // SSH_KEY_REGISTER
    const reg = await app.inject({
      method: 'POST',
      url: '/ssh-keys/register',
      headers: devHeaders,
      payload: { publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA dev@laptop' },
    });
    // CONNECT_REQUEST + RECONNECT
    await app.inject({ method: 'POST', url: '/connect/alpha', headers: devHeaders });
    await app.inject({
      method: 'POST',
      url: '/connect/alpha',
      headers: devHeaders,
      payload: { reconnect: true },
    });
    // SYNC_REQUEST
    await app.inject({
      method: 'POST',
      url: '/events/sync',
      headers: devHeaders,
      payload: { slug: 'alpha' },
    });
    // SSH_KEY_REVOKE
    const keyRow = await prisma.sshKey.findFirst({ where: { userId: devId } });
    expect(reg.statusCode).toBe(200);
    await app.inject({
      method: 'POST',
      url: `/admin/ssh-keys/${keyRow!.id}/revoke`,
      headers: adminHeaders,
    });
    // ADMIN_DISABLE_USER
    await app.inject({
      method: 'PATCH',
      url: `/admin/users/${devId}/disable`,
      headers: adminHeaders,
    });

    // PROVISION_JOB_RESULT — drive the service with a stub VPS (no real SSH)
    const stubVps = {
      createWorkspace: async () => ({ code: 0, stdout: '', stderr: '' }),
    } as unknown as VpsClient;
    await new ProvisioningService(prisma, cfg, stubVps).provisionWorkspace(admin.id);

    const expected = [
      'LOGIN',
      'LOGOUT',
      'PROJECTS_LIST',
      'CONNECT_REQUEST',
      'RECONNECT',
      'SSH_KEY_REGISTER',
      'SYNC_REQUEST',
      'ADMIN_USER_CREATE',
      'ADMIN_ASSIGNMENT',
      'ADMIN_DISABLE_USER',
      'SSH_KEY_REVOKE',
      'PROVISION_JOB_RESULT',
    ];
    const logged = await waitForActions(expected);
    for (const action of expected) {
      expect(logged.has(action), `missing audit action: ${action}`).toBe(true);
    }
  });

  it('GET /admin/audit returns logs and is admin-only', async () => {
    const admin = await prisma.user.create({
      data: {
        email: 'admin@x.com',
        passwordHash: await hashPassword('super-secret-pass'),
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    const dev = await prisma.user.create({
      data: {
        email: 'dev@x.com',
        passwordHash: await hashPassword('super-secret-pass'),
        role: 'DEVELOPER',
        status: 'ACTIVE',
      },
    });

    await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@x.com', password: 'super-secret-pass' },
    });
    await waitForActions(['LOGIN']);

    const adminRes = await app.inject({
      method: 'GET',
      url: '/admin/audit',
      headers: { authorization: `Bearer ${await token(admin.id, admin.email, 'ADMIN')}` },
    });
    expect(adminRes.statusCode).toBe(200);
    expect(adminRes.json().logs.length).toBeGreaterThan(0);

    const devRes = await app.inject({
      method: 'GET',
      url: '/admin/audit',
      headers: { authorization: `Bearer ${await token(dev.id, dev.email, 'DEVELOPER')}` },
    });
    expect(devRes.statusCode).toBe(403);
  });
});
