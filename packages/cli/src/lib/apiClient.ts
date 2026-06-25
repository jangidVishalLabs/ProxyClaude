import {
  loginResponseSchema,
  projectsResponseSchema,
  registerSshKeyResponseSchema,
  connectResponseSchema,
  sessionsResponseSchema,
  adminUserSchema,
  adminUsersResponseSchema,
  adminSshKeysResponseSchema,
  projectSchema,
  provisionResponseSchema,
  assignmentResponseSchema,
  auditResponseSchema,
  type LoginResponse,
  type ProjectsResponse,
  type RegisterSshKeyResponse,
  type ConnectResponse,
  type SessionsResponse,
  type AdminUser,
  type AdminUsersResponse,
  type AdminSshKeysResponse,
  type Project,
  type ProvisionResponse,
  type AssignmentResponse,
  type AuditResponse,
  type Role,
  type UpdateProjectRequest,
} from '@proxyclaude/shared';
import { CliError } from './errors.js';

type FetchFn = typeof fetch;

export interface ApiClientOptions {
  apiUrl: string;
  accessToken?: string;
  refreshToken?: string;
  /** Injectable for tests. */
  fetchFn?: FetchFn;
  /** Called when tokens are rotated via refresh, so callers can persist them. */
  onTokensRefreshed?: (tokens: { accessToken: string; refreshToken: string }) => void;
}

/**
 * Thin typed HTTP client for the ProxyClaude backend (plan §5). Validates every
 * response with the shared schemas, maps error bodies to CliError, and refreshes
 * the access token once on a 401 before retrying.
 */
export class ApiClient {
  private accessToken?: string;
  private refreshToken?: string;
  private readonly fetchFn: FetchFn;

  constructor(private readonly opts: ApiClientOptions) {
    this.accessToken = opts.accessToken;
    this.refreshToken = opts.refreshToken;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const data = await this.request('POST', '/auth/login', { body: { email, password } });
    const parsed = loginResponseSchema.parse(data);
    this.accessToken = parsed.accessToken;
    this.refreshToken = parsed.refreshToken;
    return parsed;
  }

  async logout(): Promise<void> {
    if (!this.refreshToken) return;
    await this.request('POST', '/auth/logout', { body: { refreshToken: this.refreshToken } });
  }

  async listProjects(): Promise<ProjectsResponse> {
    return projectsResponseSchema.parse(await this.request('GET', '/projects', { auth: true }));
  }

  async registerSshKey(publicKey: string): Promise<RegisterSshKeyResponse> {
    return registerSshKeyResponseSchema.parse(
      await this.request('POST', '/ssh-keys/register', { auth: true, body: { publicKey } }),
    );
  }

  async connect(slug: string, reconnect = false): Promise<ConnectResponse> {
    return connectResponseSchema.parse(
      await this.request('POST', `/connect/${slug}`, { auth: true, body: { reconnect } }),
    );
  }

  /** Report a local-only sync so it lands in the audit log (plan §12). */
  async reportSync(slug: string): Promise<void> {
    await this.request('POST', '/events/sync', { auth: true, body: { slug } });
  }

  async listSessions(): Promise<SessionsResponse> {
    return sessionsResponseSchema.parse(await this.request('GET', '/sessions', { auth: true }));
  }

  async heartbeat(): Promise<void> {
    await this.request('POST', '/sessions/heartbeat', { auth: true });
  }

  // --- admin (ADMIN role only; 403 surfaces as a CliError) ---

  async adminListUsers(email?: string): Promise<AdminUsersResponse> {
    const path = email ? `/admin/users?email=${encodeURIComponent(email)}` : '/admin/users';
    return adminUsersResponseSchema.parse(await this.request('GET', path, { auth: true }));
  }

  async adminCreateUser(email: string, password: string, role: Role): Promise<AdminUser> {
    return adminUserSchema.parse(
      await this.request('POST', '/admin/users', { auth: true, body: { email, password, role } }),
    );
  }

  async adminDisableUser(id: string): Promise<AdminUser> {
    return adminUserSchema.parse(
      await this.request('PATCH', `/admin/users/${id}/disable`, { auth: true }),
    );
  }

  async adminProvision(id: string): Promise<ProvisionResponse> {
    return provisionResponseSchema.parse(
      await this.request('POST', `/admin/users/${id}/provision`, { auth: true }),
    );
  }

  async adminCreateProject(input: {
    slug: string;
    name: string;
    vpsPath: string;
    repoUrl?: string;
  }): Promise<Project> {
    return projectSchema.parse(
      await this.request('POST', '/admin/projects', { auth: true, body: input }),
    );
  }

  async adminUpdateProject(id: string, input: UpdateProjectRequest): Promise<Project> {
    return projectSchema.parse(
      await this.request('PATCH', `/admin/projects/${id}`, { auth: true, body: input }),
    );
  }

  async adminAssign(userId: string, projectId: string): Promise<AssignmentResponse> {
    return assignmentResponseSchema.parse(
      await this.request('POST', '/admin/assignments', { auth: true, body: { userId, projectId } }),
    );
  }

  async adminListSshKeys(userId: string): Promise<AdminSshKeysResponse> {
    return adminSshKeysResponseSchema.parse(
      await this.request('GET', `/admin/users/${userId}/ssh-keys`, { auth: true }),
    );
  }

  async adminRevokeKey(keyId: string): Promise<void> {
    await this.request('POST', `/admin/ssh-keys/${keyId}/revoke`, { auth: true });
  }

  async adminAudit(opts: { action?: string; limit?: number } = {}): Promise<AuditResponse> {
    const params = new URLSearchParams();
    if (opts.action) params.set('action', opts.action);
    if (opts.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return auditResponseSchema.parse(
      await this.request('GET', `/admin/audit${qs ? `?${qs}` : ''}`, { auth: true }),
    );
  }

  // --- internals ---

  private async request(
    method: string,
    path: string,
    opts: { body?: unknown; auth?: boolean; isRetry?: boolean } = {},
  ): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.opts.apiUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(opts.auth && this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (err) {
      throw new CliError(
        `Cannot reach the ProxyClaude API at ${this.opts.apiUrl}: ${String(err)}`,
        'INTERNAL',
      );
    }

    // Refresh-and-retry once on an expired/invalid access token.
    if (res.status === 401 && opts.auth && !opts.isRetry && this.refreshToken) {
      await this.doRefresh();
      return this.request(method, path, { ...opts, isRetry: true });
    }

    if (res.status === 204) return undefined;

    const text = await res.text();
    const json = text ? JSON.parse(text) : undefined;

    if (!res.ok) {
      const code = (json?.code as string) ?? 'INTERNAL';
      const message = (json?.message as string) ?? `Request failed (${res.status})`;
      throw new CliError(message, code);
    }
    return json;
  }

  private async doRefresh(): Promise<void> {
    const data = await this.request('POST', '/auth/refresh', {
      body: { refreshToken: this.refreshToken },
    });
    const parsed = loginResponseSchema.parse(data);
    this.accessToken = parsed.accessToken;
    this.refreshToken = parsed.refreshToken;
    this.opts.onTokensRefreshed?.({
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
    });
  }
}
