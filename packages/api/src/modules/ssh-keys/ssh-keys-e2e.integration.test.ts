import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { SshKeyService } from './service.js';
import { ProvisioningService } from '../admin/provision.service.js';
import { VpsClient } from '../../lib/vps-client.js';
import { parseConfig } from '../../config.js';
import { hashPassword } from '../../lib/hash.js';

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
  await prisma.sshKey.deleteMany();
  await prisma.provisionJob.deleteMany();
  await prisma.user.deleteMany();
});

describe.skipIf(!ready)('ssh-key registration E2E (real local sshd)', () => {
  const vps = VpsClient.fromConfig(cfg);
  const provisioning = new ProvisioningService(prisma, cfg, vps);
  const sshKeys = new SshKeyService(prisma, vps);

  it('installs the key so the developer can SSH into their workspace', async () => {
    // 1. user + provisioned workspace
    const user = await prisma.user.create({
      data: {
        email: 'keyflow@x.com',
        passwordHash: await hashPassword('x'.repeat(12)),
        role: 'DEVELOPER',
        status: 'ACTIVE',
      },
    });
    const { user: dto } = await provisioning.provisionWorkspace(user.id);
    const username = dto.vpsUsername!;

    // 2. developer keypair
    const dir = mkdtempSync(join(tmpdir(), 'pc-e2e-'));
    const priv = join(dir, 'id_ed25519');
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', priv, '-C', 'e2e'], {
      stdio: 'ignore',
    });
    const pub = readFileSync(`${priv}.pub`, 'utf8').trim();

    try {
      // 3. register -> installs on the box
      const res = await sshKeys.register(user.id, pub);
      expect(res.status).toBe('ACTIVE');

      const key = await prisma.sshKey.findFirst({ where: { userId: user.id } });
      expect(key?.installedAt).toBeTruthy();
      const job = await prisma.provisionJob.findFirst({
        where: { userId: user.id, type: 'KEY_INSTALL' },
      });
      expect(job?.status).toBe('DONE');

      // 4. SSH into the workspace as the developer with the matching key
      const out = execFileSync(
        'ssh',
        [
          '-i',
          priv,
          '-o',
          'StrictHostKeyChecking=no',
          '-o',
          'BatchMode=yes',
          `${username}@${cfg.VPS_HOST}`,
          'whoami',
        ],
        { encoding: 'utf8' },
      ).trim();
      expect(out).toBe(username);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
