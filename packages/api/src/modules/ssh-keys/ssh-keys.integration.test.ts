import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../server.js';
import { getConfig } from '../../config.js';
import { hashPassword } from '../../lib/hash.js';
import { signAccessToken } from '../../lib/jwt.js';
import { sshFingerprint } from '../../lib/ssh-fingerprint.js';

const prisma = new PrismaClient();
let app: FastifyInstance;

// Generate a real keypair once to test against.
const keyDir = mkdtempSync(join(tmpdir(), 'pc-key-'));
const keyFile = join(keyDir, 'id_ed25519');
execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', keyFile, '-C', 'test'], {
  stdio: 'ignore',
});
const publicKey = readFileSync(`${keyFile}.pub`, 'utf8').trim();
const expectedFp = execFileSync('ssh-keygen', ['-lf', `${keyFile}.pub`], {
  encoding: 'utf8',
}).match(/SHA256:\S+/)![0];

async function devToken() {
  const dev = await prisma.user.create({
    data: {
      email: 'dev@x.com',
      passwordHash: await hashPassword('x'.repeat(12)),
      role: 'DEVELOPER',
      status: 'ACTIVE',
    },
  });
  const cfg = getConfig();
  const t = await signAccessToken(
    { sub: dev.id, email: dev.email, role: 'DEVELOPER' },
    cfg.JWT_ACCESS_SECRET,
    cfg.ACCESS_TOKEN_TTL,
  );
  return { dev, headers: { authorization: `Bearer ${t}` } };
}

beforeAll(async () => {
  app = await buildServer({ prismaClient: prisma, logLevel: 'silent' });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(keyDir, { recursive: true, force: true });
});
beforeEach(async () => {
  await prisma.sshKey.deleteMany();
  await prisma.provisionJob.deleteMany();
  await prisma.user.deleteMany();
});

describe('sshFingerprint', () => {
  it('matches ssh-keygen -lf', () => {
    expect(sshFingerprint(publicKey)).toBe(expectedFp);
  });
  it('rejects a non-key string', () => {
    expect(() => sshFingerprint('garbage')).toThrow();
  });
});

describe('POST /ssh-keys/register', () => {
  it('requires authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ssh-keys/register',
      payload: { publicKey },
    });
    expect(res.statusCode).toBe(401);
  });

  it('registers a key and returns its fingerprint + ACTIVE', async () => {
    const { headers } = await devToken();
    const res = await app.inject({
      method: 'POST',
      url: '/ssh-keys/register',
      headers,
      payload: { publicKey },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ fingerprint: expectedFp, status: 'ACTIVE' });
  });

  it('is idempotent (same fingerprint, one row)', async () => {
    const { dev, headers } = await devToken();
    await app.inject({
      method: 'POST',
      url: '/ssh-keys/register',
      headers,
      payload: { publicKey },
    });
    await app.inject({
      method: 'POST',
      url: '/ssh-keys/register',
      headers,
      payload: { publicKey },
    });
    const count = await prisma.sshKey.count({ where: { userId: dev.id } });
    expect(count).toBe(1);
  });

  it('rejects a key already owned by another user (409)', async () => {
    const { headers } = await devToken();
    await app.inject({
      method: 'POST',
      url: '/ssh-keys/register',
      headers,
      payload: { publicKey },
    });

    // second developer tries to register the same key
    const other = await prisma.user.create({
      data: {
        email: 'other@x.com',
        passwordHash: await hashPassword('x'.repeat(12)),
        role: 'DEVELOPER',
        status: 'ACTIVE',
      },
    });
    const cfg = getConfig();
    const t = await signAccessToken(
      { sub: other.id, email: other.email, role: 'DEVELOPER' },
      cfg.JWT_ACCESS_SECRET,
      cfg.ACCESS_TOKEN_TTL,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/ssh-keys/register',
      headers: { authorization: `Bearer ${t}` },
      payload: { publicKey },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects a malformed key (422)', async () => {
    const { headers } = await devToken();
    const res = await app.inject({
      method: 'POST',
      url: '/ssh-keys/register',
      headers,
      payload: { publicKey: 'not-a-key' },
    });
    expect(res.statusCode).toBe(422);
  });
});
