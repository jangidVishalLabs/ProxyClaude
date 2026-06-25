import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../server.js';
import { getConfig, type AppConfig } from '../../config.js';
import { hashPassword } from '../../lib/hash.js';
import { signAccessToken } from '../../lib/jwt.js';

const prisma = new PrismaClient();
let app: FastifyInstance;
const cfg: AppConfig = { ...getConfig(), VPS_HOST: '10.0.0.9' };

async function devSetup() {
  const dev = await prisma.user.create({
    data: {
      email: 'dev@x.com',
      passwordHash: await hashPassword('x'.repeat(12)),
      role: 'DEVELOPER',
      status: 'ACTIVE',
      vpsUsername: 'pc_user_sess',
      vpsHost: '10.0.0.9',
    },
  });
  const project = await prisma.project.create({
    data: { slug: 'alpha', name: 'Alpha', vpsPath: '/home/pc_user_sess/projects/alpha' },
  });
  await prisma.assignment.create({ data: { userId: dev.id, projectId: project.id } });
  const t = await signAccessToken(
    { sub: dev.id, email: dev.email, role: 'DEVELOPER' },
    cfg.JWT_ACCESS_SECRET,
    cfg.ACCESS_TOKEN_TTL,
  );
  return { dev, headers: { authorization: `Bearer ${t}` } };
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
  await prisma.session.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
});

describe('session tracking', () => {
  it('connect records an ACTIVE session, visible via GET /sessions', async () => {
    const { headers } = await devSetup();
    await app.inject({ method: 'POST', url: '/connect/alpha', headers });

    const res = await app.inject({ method: 'GET', url: '/sessions', headers });
    expect(res.statusCode).toBe(200);
    const { sessions } = res.json();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      projectSlug: 'alpha',
      tmuxName: 'alpha',
      status: 'ACTIVE',
    });
  });

  it('reconnect (second connect) does not create a duplicate session', async () => {
    const { headers } = await devSetup();
    await app.inject({ method: 'POST', url: '/connect/alpha', headers });
    await app.inject({ method: 'POST', url: '/connect/alpha', headers });
    const { sessions } = (await app.inject({ method: 'GET', url: '/sessions', headers })).json();
    expect(sessions).toHaveLength(1);
  });

  it('heartbeat updates lastSeenAt and returns the count', async () => {
    const { headers } = await devSetup();
    await app.inject({ method: 'POST', url: '/connect/alpha', headers });
    const before = (await app.inject({ method: 'GET', url: '/sessions', headers })).json()
      .sessions[0].lastSeenAt;

    await new Promise((r) => setTimeout(r, 20));
    const hb = await app.inject({ method: 'POST', url: '/sessions/heartbeat', headers });
    expect(hb.json().updated).toBe(1);

    const after = (await app.inject({ method: 'GET', url: '/sessions', headers })).json()
      .sessions[0].lastSeenAt;
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/sessions' });
    expect(res.statusCode).toBe(401);
  });
});
