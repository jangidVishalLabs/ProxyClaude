import { ApiClient } from './apiClient.js';
import { loadCredentials, saveCredentials } from './credentials.js';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/** Factory signature commands depend on (overridable in tests). */
export type MakeClient = (apiUrl: string, tokens?: Tokens) => ApiClient;

/**
 * Default client factory: persists rotated tokens back into the credential
 * store so a long-lived session survives access-token expiry transparently.
 */
export const makeApiClient: MakeClient = (apiUrl, tokens) =>
  new ApiClient({
    apiUrl,
    accessToken: tokens?.accessToken,
    refreshToken: tokens?.refreshToken,
    onTokensRefreshed: (t) => {
      const current = loadCredentials();
      if (current) saveCredentials({ ...current, ...t });
    },
  });
