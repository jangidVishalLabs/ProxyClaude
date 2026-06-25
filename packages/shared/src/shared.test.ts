import { describe, it, expect } from 'vitest';
import {
  AppError,
  ErrorCode,
  httpStatusForCode,
  exitCodeForCode,
  AuditAction,
  Role,
  loginRequestSchema,
  registerSshKeyRequestSchema,
  createProjectRequestSchema,
  projectSlugSchema,
} from './index.js';

describe('errors', () => {
  it('maps codes to http + exit codes', () => {
    expect(httpStatusForCode(ErrorCode.ACCESS_DENIED)).toBe(403);
    expect(httpStatusForCode(ErrorCode.AUTH_INVALID)).toBe(401);
    expect(exitCodeForCode(ErrorCode.ACCESS_DENIED)).toBe(3);
    expect(exitCodeForCode(ErrorCode.AUTH_INVALID)).toBe(2);
  });

  it('AppError exposes status/exit/body', () => {
    const e = new AppError(ErrorCode.USER_DISABLED, 'account disabled');
    expect(e.httpStatus).toBe(403);
    expect(e.exitCode).toBe(2);
    expect(e.toBody()).toEqual({
      code: 'USER_DISABLED',
      message: 'account disabled',
      details: undefined,
    });
  });

  it('every ErrorCode has a status and exit mapping', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(typeof httpStatusForCode(code)).toBe('number');
      expect(typeof exitCodeForCode(code)).toBe('number');
    }
  });
});

describe('audit', () => {
  it('covers all 13 plan actions', () => {
    expect(Object.keys(AuditAction)).toHaveLength(13);
    expect(AuditAction.LOGIN_FAILED).toBe('LOGIN_FAILED');
  });
});

describe('schemas', () => {
  it('accepts a valid login', () => {
    const r = loginRequestSchema.safeParse({ email: 'a@b.com', password: 'x' });
    expect(r.success).toBe(true);
  });

  it('rejects a bad email', () => {
    const r = loginRequestSchema.safeParse({ email: 'nope', password: 'x' });
    expect(r.success).toBe(false);
  });

  it('validates project slugs', () => {
    expect(projectSlugSchema.safeParse('client-plugin').success).toBe(true);
    expect(projectSlugSchema.safeParse('Bad_Slug').success).toBe(false);
    expect(projectSlugSchema.safeParse('-lead').success).toBe(false);
  });

  it('requires an OpenSSH public key', () => {
    expect(
      registerSshKeyRequestSchema.safeParse({ publicKey: 'ssh-ed25519 AAAAC3Nz user@host' })
        .success,
    ).toBe(true);
    expect(registerSshKeyRequestSchema.safeParse({ publicKey: 'garbage' }).success).toBe(false);
  });

  it('defaults project branch to main', () => {
    const r = createProjectRequestSchema.parse({
      slug: 'demo',
      name: 'Demo',
      vpsPath: '/home/pc_user_1/projects/demo',
    });
    expect(r.defaultBranch).toBe('main');
    expect(r.slug).toBe('demo');
  });

  it('exposes Role values', () => {
    expect(Role.ADMIN).toBe('ADMIN');
    expect(Role.DEVELOPER).toBe('DEVELOPER');
  });
});
