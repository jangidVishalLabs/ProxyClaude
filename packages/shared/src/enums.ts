/**
 * Core domain enums shared across API, CLI, and sync agent.
 * Mirror these exactly in the Prisma schema (Phase 1).
 */

export const Role = {
  ADMIN: 'ADMIN',
  DEVELOPER: 'DEVELOPER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const SshKeyStatus = {
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
} as const;
export type SshKeyStatus = (typeof SshKeyStatus)[keyof typeof SshKeyStatus];

export const SessionStatus = {
  ACTIVE: 'ACTIVE',
  ENDED: 'ENDED',
} as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

export const ProvisionJobType = {
  WORKSPACE: 'WORKSPACE',
  KEY_INSTALL: 'KEY_INSTALL',
  KEY_REVOKE: 'KEY_REVOKE',
} as const;
export type ProvisionJobType = (typeof ProvisionJobType)[keyof typeof ProvisionJobType];

export const ProvisionJobStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  DONE: 'DONE',
  FAILED: 'FAILED',
} as const;
export type ProvisionJobStatus = (typeof ProvisionJobStatus)[keyof typeof ProvisionJobStatus];
