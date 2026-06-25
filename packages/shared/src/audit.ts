/**
 * Every sensitive action that MUST produce an audit-log row (plan §12).
 * The API audit hook keys off these. Do not remove values — append only.
 */

export const AuditAction = {
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  PROJECTS_LIST: 'PROJECTS_LIST',
  CONNECT_REQUEST: 'CONNECT_REQUEST',
  SSH_KEY_REGISTER: 'SSH_KEY_REGISTER',
  RECONNECT: 'RECONNECT',
  SYNC_REQUEST: 'SYNC_REQUEST',
  ADMIN_USER_CREATE: 'ADMIN_USER_CREATE',
  ADMIN_ASSIGNMENT: 'ADMIN_ASSIGNMENT',
  ADMIN_DISABLE_USER: 'ADMIN_DISABLE_USER',
  SSH_KEY_REVOKE: 'SSH_KEY_REVOKE',
  PROVISION_JOB_RESULT: 'PROVISION_JOB_RESULT',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const AuditResult = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
} as const;
export type AuditResult = (typeof AuditResult)[keyof typeof AuditResult];
