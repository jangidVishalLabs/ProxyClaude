import { describe, it, expect, vi } from 'vitest';
import { ApiClient } from './apiClient.js';
import { CliError } from './errors.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const loginBody = {
  accessToken: 'at1',
  refreshToken: 'rt1',
  user: { id: 'u1', email: 'a@b.com', role: 'DEVELOPER' },
};

describe('ApiClient.login', () => {
  it('parses and stores tokens', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, loginBody));
    const client = new ApiClient({ apiUrl: 'http://x', fetchFn });
    const res = await client.login('a@b.com', 'pw');
    expect(res.accessToken).toBe('at1');
    expect(fetchFn).toHaveBeenCalledWith(
      'http://x/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('maps an error body to CliError with the right exit code', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { code: 'AUTH_INVALID', message: 'bad creds' }));
    const client = new ApiClient({ apiUrl: 'http://x', fetchFn });
    await expect(client.login('a@b.com', 'pw')).rejects.toMatchObject({
      code: 'AUTH_INVALID',
      exitCode: 2,
    });
  });

  it('wraps a network failure in CliError', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const client = new ApiClient({ apiUrl: 'http://x', fetchFn });
    await expect(client.login('a@b.com', 'pw')).rejects.toBeInstanceOf(CliError);
  });
});

describe('ApiClient auth + refresh', () => {
  it('refreshes once on 401 then retries, persisting new tokens', async () => {
    const onTokensRefreshed = vi.fn();
    const fetchFn = vi
      .fn()
      // 1: protected call -> 401
      .mockResolvedValueOnce(jsonResponse(401, { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' }))
      // 2: refresh -> new tokens
      .mockResolvedValueOnce(
        jsonResponse(200, { ...loginBody, accessToken: 'at2', refreshToken: 'rt2' }),
      )
      // 3: retried protected call -> ok
      .mockResolvedValueOnce(jsonResponse(200, { projects: [] }));

    const client = new ApiClient({
      apiUrl: 'http://x',
      accessToken: 'at1',
      refreshToken: 'rt1',
      fetchFn,
      onTokensRefreshed,
    });

    const res = await client.listProjects();
    expect(res.projects).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(onTokensRefreshed).toHaveBeenCalledWith({ accessToken: 'at2', refreshToken: 'rt2' });
  });

  it('does not loop forever if refresh also fails', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(401, { code: 'AUTH_INVALID', message: 'bad refresh' }));
    const client = new ApiClient({
      apiUrl: 'http://x',
      accessToken: 'at1',
      refreshToken: 'rt1',
      fetchFn,
    });
    await expect(client.listProjects()).rejects.toBeInstanceOf(CliError);
  });
});

describe('ApiClient.connect', () => {
  it('returns validated connect config', async () => {
    const cfg = {
      host: '10.0.0.5',
      port: 22,
      vpsUsername: 'pc_user_1',
      projectPath: '/home/pc_user_1/projects/alpha',
      tmuxName: 'alpha',
    };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, cfg));
    const client = new ApiClient({ apiUrl: 'http://x', accessToken: 'at', fetchFn });
    expect(await client.connect('alpha')).toEqual(cfg);
  });
});
