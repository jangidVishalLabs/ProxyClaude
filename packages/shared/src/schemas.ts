import { z } from 'zod';
import { Role } from './enums.js';

/**
 * Request/response contracts shared by API (validation) and CLI (input).
 * Single source of truth — both sides import from here.
 */

// --- primitives ---
export const emailSchema = z.string().email().max(254);
export const passwordSchema = z.string().min(12).max(128);
export const projectSlugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'lowercase alphanumeric and hyphens only');

// --- auth ---
export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: z.object({
    id: z.string(),
    email: emailSchema,
    role: z.enum([Role.ADMIN, Role.DEVELOPER]),
  }),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

// --- projects ---
export const projectSchema = z.object({
  id: z.string(),
  slug: projectSlugSchema,
  name: z.string(),
  repoUrl: z.string().url().nullable(),
  defaultBranch: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectsResponseSchema = z.object({
  projects: z.array(projectSchema),
});
export type ProjectsResponse = z.infer<typeof projectsResponseSchema>;

// --- ssh key registration ---
export const registerSshKeyRequestSchema = z.object({
  publicKey: z
    .string()
    .min(1)
    .regex(/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-\S+) \S+/, 'must be an OpenSSH public key'),
});
export type RegisterSshKeyRequest = z.infer<typeof registerSshKeyRequestSchema>;

export const registerSshKeyResponseSchema = z.object({
  fingerprint: z.string(),
  status: z.enum(['ACTIVE', 'REVOKED']),
});
export type RegisterSshKeyResponse = z.infer<typeof registerSshKeyResponseSchema>;

// --- connect ---
export const connectResponseSchema = z.object({
  host: z.string(),
  port: z.number().int().positive(),
  vpsUsername: z.string(),
  projectPath: z.string(),
  tmuxName: z.string(),
});
export type ConnectResponse = z.infer<typeof connectResponseSchema>;

// --- admin ---
export const createUserRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  role: z.enum([Role.ADMIN, Role.DEVELOPER]).default(Role.DEVELOPER),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const createProjectRequestSchema = z.object({
  slug: projectSlugSchema,
  name: z.string().min(1).max(200),
  repoUrl: z.string().url().optional(),
  vpsPath: z.string().min(1),
  defaultBranch: z.string().min(1).default('main'),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const assignmentRequestSchema = z.object({
  userId: z.string().min(1),
  projectId: z.string().min(1),
});
export type AssignmentRequest = z.infer<typeof assignmentRequestSchema>;

/** Partial project update (PATCH /admin/projects/:id). At least one field required. */
export const updateProjectRequestSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    repoUrl: z.string().url().nullable().optional(),
    vpsPath: z.string().min(1).optional(),
    defaultBranch: z.string().min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

/** Admin view of a user (GET /admin/users). Includes internal fields admins need. */
export const adminUserSchema = z.object({
  id: z.string(),
  email: emailSchema,
  role: z.enum([Role.ADMIN, Role.DEVELOPER]),
  status: z.enum(['ACTIVE', 'DISABLED']),
  vpsUsername: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUsersResponseSchema = z.object({
  users: z.array(adminUserSchema),
});
export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>;

/** Admin view of an SSH key (GET /admin/users/:id/ssh-keys). */
export const adminSshKeySchema = z.object({
  id: z.string(),
  fingerprint: z.string(),
  status: z.enum(['ACTIVE', 'REVOKED']),
  createdAt: z.coerce.date(),
});
export type AdminSshKey = z.infer<typeof adminSshKeySchema>;

export const adminSshKeysResponseSchema = z.object({
  keys: z.array(adminSshKeySchema),
});
export type AdminSshKeysResponse = z.infer<typeof adminSshKeysResponseSchema>;

/** Response of POST /admin/users/:id/provision. */
export const provisionResponseSchema = z.object({
  user: adminUserSchema,
  job: z.object({
    id: z.string(),
    type: z.string(),
    status: z.string(),
  }),
});
export type ProvisionResponse = z.infer<typeof provisionResponseSchema>;

/** Response of POST /admin/assignments. */
export const assignmentResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  projectId: z.string(),
});
export type AssignmentResponse = z.infer<typeof assignmentResponseSchema>;

/** Response of GET /admin/audit. */
export const auditLogSchema = z.object({
  id: z.string(),
  action: z.string(),
  result: z.string(),
  actorUserId: z.string().nullable(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type AuditLogEntry = z.infer<typeof auditLogSchema>;

export const auditResponseSchema = z.object({
  logs: z.array(auditLogSchema),
});
export type AuditResponse = z.infer<typeof auditResponseSchema>;

// --- sessions ---
export const sessionSchema = z.object({
  id: z.string(),
  projectSlug: projectSlugSchema,
  tmuxName: z.string(),
  status: z.enum(['ACTIVE', 'ENDED']),
  lastSeenAt: z.string(),
});
export type Session = z.infer<typeof sessionSchema>;

export const sessionsResponseSchema = z.object({
  sessions: z.array(sessionSchema),
});
export type SessionsResponse = z.infer<typeof sessionsResponseSchema>;
