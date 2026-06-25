import { spawn } from 'node:child_process';
import { AppError, ErrorCode } from '@proxyclaude/shared';

/** Fixed location the bootstrap/image installs the provisioning scripts to. */
export const VPS_SCRIPT_DIR = '/opt/proxyclaude/vps';

export interface VpsClientOptions {
  host: string;
  port: number;
  user: string;
  keyPath: string;
}

export interface VpsExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

const USERNAME_RE = /^pc_user_[a-z0-9]+$/;

/**
 * Runs provisioning commands on the VPS over SSH as the provisioner account
 * (plan §6). The provisioner has NOPASSWD sudo for ONLY the vps scripts.
 * Transport failures (ssh exit 255 / spawn error) are retried; deterministic
 * script failures are not.
 */
export class VpsClient {
  constructor(private readonly opts: VpsClientOptions) {}

  static fromConfig(config: {
    VPS_HOST?: string;
    VPS_SSH_PORT: number;
    VPS_PROVISIONER_USER?: string;
    VPS_PROVISIONER_KEY_PATH?: string;
  }): VpsClient {
    if (!config.VPS_HOST || !config.VPS_PROVISIONER_USER || !config.VPS_PROVISIONER_KEY_PATH) {
      throw new AppError(
        ErrorCode.PROVISION_FAILED,
        'VPS provisioner is not configured (VPS_HOST / VPS_PROVISIONER_USER / VPS_PROVISIONER_KEY_PATH)',
      );
    }
    return new VpsClient({
      host: config.VPS_HOST,
      port: config.VPS_SSH_PORT,
      user: config.VPS_PROVISIONER_USER,
      keyPath: config.VPS_PROVISIONER_KEY_PATH,
    });
  }

  private runOnce(remoteCmd: string, stdin?: string): Promise<VpsExecResult> {
    const args = [
      '-i',
      this.opts.keyPath,
      '-p',
      String(this.opts.port),
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'ConnectTimeout=10',
      `${this.opts.user}@${this.opts.host}`,
      '--',
      remoteCmd,
    ];

    return new Promise((resolve, reject) => {
      const child = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));

      if (stdin !== undefined) {
        child.stdin.write(stdin);
      }
      child.stdin.end();
    });
  }

  /** Execute a remote command, retrying transport failures. */
  async exec(
    remoteCmd: string,
    opts: { stdin?: string; retries?: number } = {},
  ): Promise<VpsExecResult> {
    const retries = opts.retries ?? 2;
    let last: VpsExecResult | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await this.runOnce(remoteCmd, opts.stdin);
        // 255 == ssh transport error -> worth retrying. Other codes are deterministic.
        if (result.code !== 255) return result;
        last = result;
      } catch (err) {
        last = { code: -1, stdout: '', stderr: String(err) };
      }
    }
    return last ?? { code: -1, stdout: '', stderr: 'unknown ssh failure' };
  }

  private assertUsername(username: string): void {
    if (!USERNAME_RE.test(username)) {
      throw new AppError(ErrorCode.PROVISION_FAILED, `invalid vps username: ${username}`);
    }
  }

  private script(name: string): string {
    return `${VPS_SCRIPT_DIR}/${name}`;
  }

  async createWorkspace(username: string): Promise<VpsExecResult> {
    this.assertUsername(username);
    return this.run(`sudo ${this.script('create-workspace.sh')} ${username}`);
  }

  async installKey(username: string, publicKey: string): Promise<VpsExecResult> {
    this.assertUsername(username);
    return this.run(`sudo ${this.script('install-key.sh')} ${username}`, publicKey);
  }

  async revokeKey(username: string, publicKey: string): Promise<VpsExecResult> {
    this.assertUsername(username);
    return this.run(`sudo ${this.script('revoke-key.sh')} ${username}`, publicKey);
  }

  /** Run a remote command and throw PROVISION_FAILED on a non-zero exit. */
  private async run(remoteCmd: string, stdin?: string): Promise<VpsExecResult> {
    const result = await this.exec(remoteCmd, { stdin });
    if (result.code !== 0) {
      throw new AppError(
        ErrorCode.PROVISION_FAILED,
        `vps command failed (exit ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
    return result;
  }
}
