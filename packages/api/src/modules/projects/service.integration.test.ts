import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AppError } from '@proxyclaude/shared';
import { ProjectService } from './service.js';
import { hashPassword } from '../../lib/hash.js';

const prisma = new PrismaClient();
const svc = new ProjectService(prisma);

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

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.assignment.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
});

describe('ProjectService.listForUser', () => {
  it('returns only assigned projects for a developer', async () => {
    const dev = await user('dev@x.com', 'DEVELOPER');
    const a = await project('alpha');
    await project('beta'); // not assigned
    await prisma.assignment.create({ data: { userId: dev.id, projectId: a.id } });

    const list = await svc.listForUser(dev);
    expect(list.map((p) => p.slug)).toEqual(['alpha']);
  });

  it('returns all projects for an admin', async () => {
    const admin = await user('admin@x.com', 'ADMIN');
    await project('alpha');
    await project('beta');

    const list = await svc.listForUser(admin);
    expect(list.map((p) => p.slug)).toEqual(['alpha', 'beta']);
  });

  it('returns empty for a developer with no assignments', async () => {
    const dev = await user('dev@x.com', 'DEVELOPER');
    await project('alpha');
    expect(await svc.listForUser(dev)).toEqual([]);
  });
});

describe('ProjectService.getAccessibleProject', () => {
  it('returns the project for an assigned developer', async () => {
    const dev = await user('dev@x.com', 'DEVELOPER');
    const a = await project('alpha');
    await prisma.assignment.create({ data: { userId: dev.id, projectId: a.id } });

    const got = await svc.getAccessibleProject(dev, 'alpha');
    expect(got.slug).toBe('alpha');
  });

  it('denies an unassigned developer with ACCESS_DENIED', async () => {
    const dev = await user('dev@x.com', 'DEVELOPER');
    await project('alpha');
    await expect(svc.getAccessibleProject(dev, 'alpha')).rejects.toMatchObject({
      code: 'ACCESS_DENIED',
    });
  });

  it('allows an admin for any project', async () => {
    const admin = await user('admin@x.com', 'ADMIN');
    await project('alpha');
    const got = await svc.getAccessibleProject(admin, 'alpha');
    expect(got.slug).toBe('alpha');
  });

  it('throws NOT_FOUND for a missing slug', async () => {
    const admin = await user('admin@x.com', 'ADMIN');
    await expect(svc.getAccessibleProject(admin, 'ghost')).rejects.toBeInstanceOf(AppError);
    await expect(svc.getAccessibleProject(admin, 'ghost')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
