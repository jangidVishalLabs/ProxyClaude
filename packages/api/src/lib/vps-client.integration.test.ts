import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { AppError } from '@proxyclaude/shared';
import { VpsClient } from './vps-client.js';
import { parseConfig } from '../config.js';

// Load real VPS_* values from the repo-root .env (test setup only sets DB/JWT).
loadDotenv({ path: resolve(process.cwd(), '../../.env') });
const cfg = parseConfig(process.env);

const provisionerReady =
  !!cfg.VPS_HOST &&
  !!cfg.VPS_PROVISIONER_USER &&
  !!cfg.VPS_PROVISIONER_KEY_PATH &&
  existsSync(cfg.VPS_PROVISIONER_KEY_PATH);

describe('VpsClient username validation (no SSH)', () => {
  it('rejects an invalid username before connecting', async () => {
    const client = new VpsClient({ host: 'x', port: 22, user: 'u', keyPath: '/nope' });
    await expect(client.createWorkspace('bad; rm -rf /')).rejects.toBeInstanceOf(AppError);
  });
});

describe.skipIf(!provisionerReady)('VpsClient against local sshd', () => {
  const client = VpsClient.fromConfig(cfg);
  const username = 'pc_user_vpsc1';

  it('creates a workspace (idempotent)', async () => {
    const r1 = await client.createWorkspace(username);
    expect(r1.code).toBe(0);
    expect(r1.stdout).toContain('workspace-ready');
    const r2 = await client.createWorkspace(username);
    expect(r2.code).toBe(0);
  });

  it('installs then revokes a key', async () => {
    const pub = `ssh-ed25519 AAAA${'A'.repeat(40)}test vpsc@test`;
    const inst = await client.installKey(username, pub);
    expect(inst.stdout).toContain('key-installed');

    const rev = await client.revokeKey(username, pub);
    expect(rev.stdout).toContain('key-revoked');
  });

  it('throws PROVISION_FAILED when a remote command fails', async () => {
    // Force a script-level failure: create-workspace with a (validated-ok) name
    // that the remote script will accept, then a bogus one bypassing... instead
    // assert install-key on a non-existent user fails (exit 3).
    const pub = `ssh-ed25519 AAAA${'A'.repeat(40)}test x@y`;
    await expect(client.installKey('pc_user_ghost999', pub)).rejects.toMatchObject({
      code: 'PROVISION_FAILED',
    });
  });
});
