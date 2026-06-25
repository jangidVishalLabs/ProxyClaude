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
async function adminHeaders() {
  const a = await seedUser('admin@x.com', 'ADMIN');
  const cfg = getConfig();
  const t = await signAccessToken(
    { sub: a.id, email: a.email, role: 'ADMIN' },
    cfg.JWT_ACCESS_SECRET,
    cfg.ACCESS_TOKEN_TTL,
  );
  return { authorization: `Bearer ${t}` };
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
  await prisma.sshKey.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
});

describe('POST /admin/projects', () => {
  it('creates a project (201) and returns a DTO without vpsPath', async () => {
    const headers = await adminHeaders();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/projects',
      headers,
      payload: { slug: 'client-plugin', name: 'Client Plugin', vpsPath: '/home/pc/projects/cp' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ slug: 'client-plugin', defaultBranch: 'main' });
    expect(res.body).not.toContain('vpsPath');
  });

  it('rejects a duplicate slug with 409', async () => {
    const headers = await adminHeaders();
    const payload = { slug: 'dupe', name: 'Dupe', vpsPath: '/home/pc/projects/dupe' };
    await app.inject({ method: 'POST', url: '/admin/projects', headers, payload });
    const res = await app.inject({ method: 'POST', url: '/admin/projects', headers, payload });
    expect(res.statusCode).toBe(409);
  });

  it('denies a developer (403)', async () => {
    const dev = await seedUser('dev@x.com', 'DEVELOPER');
    const cfg = getConfig();
    const t = await signAccessToken(
      { sub: dev.id, email: dev.email, role: 'DEVELOPER' },
      cfg.JWT_ACCESS_SECRET,
      cfg.ACCESS_TOKEN_TTL,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/admin/projects',
      headers: { authorization: `Bearer ${t}` },
      payload: { slug: 'x', name: 'X', vpsPath: '/x' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /admin/assignments', () => {
  async function makeUserAndProject(headers: Record<string, string>) {
    const u = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers,
      payload: { email: 'dev@x.com', password: 'a-strong-password', role: 'DEVELOPER' },
    });
    const p = await app.inject({
      method: 'POST',
      url: '/admin/projects',
      headers,
      payload: { slug: 'alpha', name: 'Alpha', vpsPath: '/home/pc/projects/alpha' },
    });
    return { userId: u.json().id, projectId: p.json().id };
  }

  it('assigns a user to a project (201) and the project then appears in their list', async () => {
    const headers = await adminHeaders();
    const { userId, projectId } = await makeUserAndProject(headers);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/assignments',
      headers,
      payload: { userId, projectId },
    });
    expect(res.statusCode).toBe(201);

    // Developer can now see it.
    const cfg = getConfig();
    const devToken = await signAccessToken(
      { sub: userId, email: 'dev@x.com', role: 'DEVELOPER' },
      cfg.JWT_ACCESS_SECRET,
      cfg.ACCESS_TOKEN_TTL,
    );
    const list = await app.inject({
      method: 'GET',
      url: '/projects',
      headers: { authorization: `Bearer ${devToken}` },
    });
    expect(list.json().projects.map((p: { slug: string }) => p.slug)).toEqual(['alpha']);
  });

  it('rejects a duplicate assignment with 409', async () => {
    const headers = await adminHeaders();
    const { userId, projectId } = await makeUserAndProject(headers);
    const payload = { userId, projectId };
    await app.inject({ method: 'POST', url: '/admin/assignments', headers, payload });
    const res = await app.inject({ method: 'POST', url: '/admin/assignments', headers, payload });
    expect(res.statusCode).toBe(409);
  });

  it('returns 404 when the user does not exist', async () => {
    const headers = await adminHeaders();
    const p = await app.inject({
      method: 'POST',
      url: '/admin/projects',
      headers,
      payload: { slug: 'alpha', name: 'Alpha', vpsPath: '/home/pc/projects/alpha' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/assignments',
      headers,
      payload: { userId: 'ghost', projectId: p.json().id },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /admin/projects/:id', () => {
  async function makeProject(headers: Record<string, string>) {
    const p = await app.inject({
      method: 'POST',
      url: '/admin/projects',
      headers,
      payload: { slug: 'beta', name: 'Beta', vpsPath: '/tmp/placeholder' },
    });
    return p.json().id as string;
  }

  it('updates vpsPath (200) and the DTO still hides vpsPath', async () => {
    const headers = await adminHeaders();
    const id = await makeProject(headers);
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/projects/${id}`,
      headers,
      payload: { vpsPath: '/home/pc_user_abc/projects' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ slug: 'beta' });
    expect(res.body).not.toContain('vpsPath');
    const row = await prisma.project.findUnique({ where: { id } });
    expect(row?.vpsPath).toBe('/home/pc_user_abc/projects');
  });

  it('rejects an empty body (422)', async () => {
    const headers = await adminHeaders();
    const id = await makeProject(headers);
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/projects/${id}`,
      headers,
      payload: {},
    });
    expect(res.statusCode).toBe(422);
  });

  it('returns 404 for an unknown project', async () => {
    const headers = await adminHeaders();
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/projects/ghost',
      headers,
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('denies a developer (403)', async () => {
    const dev = await seedUser('dev@x.com', 'DEVELOPER');
    const cfg = getConfig();
    const t = await signAccessToken(
      { sub: dev.id, email: dev.email, role: 'DEVELOPER' },
      cfg.JWT_ACCESS_SECRET,
      cfg.ACCESS_TOKEN_TTL,
    );
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/projects/anything',
      headers: { authorization: `Bearer ${t}` },
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /admin/users?email', () => {
  it('filters to the exact email', async () => {
    const headers = await adminHeaders();
    await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers,
      payload: { email: 'one@x.com', password: 'a-strong-password', role: 'DEVELOPER' },
    });
    await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers,
      payload: { email: 'two@x.com', password: 'a-strong-password', role: 'DEVELOPER' },
    });
    const res = await app.inject({ method: 'GET', url: '/admin/users?email=one@x.com', headers });
    expect(res.statusCode).toBe(200);
    const emails = res.json().users.map((u: { email: string }) => u.email);
    expect(emails).toEqual(['one@x.com']);
  });
});

describe('GET /admin/users/:id/ssh-keys', () => {
  it('lists a user keys (empty when none registered)', async () => {
    const headers = await adminHeaders();
    const u = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers,
      payload: { email: 'keys@x.com', password: 'a-strong-password', role: 'DEVELOPER' },
    });
    const userId = u.json().id as string;
    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${userId}/ssh-keys`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ keys: [] });

    await prisma.sshKey.create({
      data: { userId, publicKey: 'ssh-ed25519 AAAA test', fingerprint: 'fp1', status: 'ACTIVE' },
    });
    const res2 = await app.inject({
      method: 'GET',
      url: `/admin/users/${userId}/ssh-keys`,
      headers,
    });
    expect(res2.json().keys).toHaveLength(1);
    expect(res2.json().keys[0]).toMatchObject({ fingerprint: 'fp1', status: 'ACTIVE' });
  });

  it('denies a developer (403)', async () => {
    const dev = await seedUser('dev@x.com', 'DEVELOPER');
    const cfg = getConfig();
    const t = await signAccessToken(
      { sub: dev.id, email: dev.email, role: 'DEVELOPER' },
      cfg.JWT_ACCESS_SECRET,
      cfg.ACCESS_TOKEN_TTL,
    );
    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${dev.id}/ssh-keys`,
      headers: { authorization: `Bearer ${t}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
