import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { ProvisioningService } from './provision.service.js';
import { VpsClient } from '../../lib/vps-client.js';
import { parseConfig } from '../../config.js';
import { hashPassword } from '../../lib/hash.js';

// Real VPS_* from repo-root .env; runs only when the local sshd provisioner exists.
loadDotenv({ path: resolve(process.cwd(), '../../.env') });
const cfg = parseConfig(process.env);
const ready =
  !!cfg.VPS_HOST &&
  !!cfg.VPS_PROVISIONER_USER &&
  !!cfg.VPS_PROVISIONER_KEY_PATH &&
  existsSync(cfg.VPS_PROVISIONER_KEY_PATH);

const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.provisionJob.deleteMany();
  await prisma.user.deleteMany();
});

describe.skipIf(!ready)('provisioning E2E (real local sshd)', () => {
  const vps = VpsClient.fromConfig(cfg);
  const svc = new ProvisioningService(prisma, cfg, vps);

  it('creates a real workspace on the VPS and marks the job DONE', async () => {
    const user = await prisma.user.create({
      data: {
        email: 'e2e@x.com',
        passwordHash: await hashPassword('x'.repeat(12)),
        role: 'DEVELOPER',
        status: 'ACTIVE',
      },
    });

    const { user: dto, job } = await svc.provisionWorkspace(user.id);
    expect(job.status).toBe('DONE');
    expect(dto.vpsUsername).toMatch(/^pc_user_/);

    // The Linux user really exists on the box.
    const check = await vps.exec(`id ${dto.vpsUsername}`);
    expect(check.code).toBe(0);
    expect(check.stdout).toContain(dto.vpsUsername!);

    // And it has no sudo rights.
    const sudoCheck = await vps.exec(`sudo -l -U ${dto.vpsUsername} 2>&1 || true`);
    expect(sudoCheck.stdout + sudoCheck.stderr).toContain('not allowed');
  });

  it('marks the job FAILED and throws when the VPS rejects the work', async () => {
    // Point at a client whose key is valid but force a script failure by using
    // a username the script will reject is impossible (validated client-side),
    // so simulate transport failure via a bad host.
    const badVps = new VpsClient({
      host: '127.0.0.1',
      port: 59999, // nothing listening
      user: cfg.VPS_PROVISIONER_USER!,
      keyPath: cfg.VPS_PROVISIONER_KEY_PATH!,
    });
    const badSvc = new ProvisioningService(prisma, cfg, badVps);
    const user = await prisma.user.create({
      data: {
        email: 'fail@x.com',
        passwordHash: await hashPassword('x'.repeat(12)),
        role: 'DEVELOPER',
        status: 'ACTIVE',
      },
    });

    await expect(badSvc.provisionWorkspace(user.id)).rejects.toMatchObject({
      code: 'PROVISION_FAILED',
    });
    const job = await prisma.provisionJob.findFirst({ where: { userId: user.id } });
    expect(job?.status).toBe('FAILED');
    expect(job?.error).toBeTruthy();
  });
});
