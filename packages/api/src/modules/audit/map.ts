import { AuditAction } from '@proxyclaude/shared';

export interface AuditRouteEntry {
  success: AuditAction;
  failure?: AuditAction;
}

/**
 * Maps `${METHOD} ${routePattern}` to the audit action(s) it produces.
 * Handlers may override the success action at runtime via req.auditAction
 * (e.g. reconnect vs connect). Routes absent here are not audited.
 */
export const AUDIT_MAP: Record<string, AuditRouteEntry> = {
  'POST /auth/login': { success: AuditAction.LOGIN, failure: AuditAction.LOGIN_FAILED },
  'POST /auth/logout': { success: AuditAction.LOGOUT },
  'GET /projects': { success: AuditAction.PROJECTS_LIST },
  'POST /connect/:slug': { success: AuditAction.CONNECT_REQUEST },
  'POST /ssh-keys/register': { success: AuditAction.SSH_KEY_REGISTER },
  'POST /events/sync': { success: AuditAction.SYNC_REQUEST },
  'POST /admin/users': { success: AuditAction.ADMIN_USER_CREATE },
  'POST /admin/assignments': { success: AuditAction.ADMIN_ASSIGNMENT },
  'PATCH /admin/users/:id/disable': { success: AuditAction.ADMIN_DISABLE_USER },
  'POST /admin/ssh-keys/:id/revoke': { success: AuditAction.SSH_KEY_REVOKE },
};
