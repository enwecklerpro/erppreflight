import * as crypto from 'node:crypto';
import { ConnectorHttp, ConnectorHttpError } from '../connector-http';
import { basicAuth } from './adapter.types';

/**
 * OAuth 2.0 client-credentials grant (RFC 6749 §4.4) with an in-memory token
 * cache keyed by token URL + client id + a hash of the secret. Tokens are reused
 * until 60 s before expiry and are never persisted or logged.
 */

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();

export function clearOAuthTokenCache(): void {
  cache.clear();
}

export async function getClientCredentialsToken(
  http: ConnectorHttp,
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
  scope?: string,
  now: () => number = Date.now
): Promise<string> {
  const key = `${tokenUrl}|${clientId}|${crypto.createHash('sha256').update(clientSecret).digest('hex')}|${scope ?? ''}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt - 60_000 > now()) {
    return hit.accessToken;
  }
  const params = new URLSearchParams({ grant_type: 'client_credentials' });
  if (scope) params.set('scope', scope);
  const res = await http.request({
    method: 'POST',
    url: tokenUrl,
    retry: true,
    headers: {
      Authorization: basicAuth(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
  });
  let data: any;
  try {
    data = res.json();
  } catch {
    throw new ConnectorHttpError('Token endpoint returned a non-JSON response', res.status, '', false);
  }
  if (!data?.access_token || typeof data.access_token !== 'string') {
    throw new ConnectorHttpError('Token endpoint response has no access_token', res.status, '', false);
  }
  const ttl = Number(data.expires_in);
  cache.set(key, {
    accessToken: data.access_token,
    expiresAt: now() + (Number.isFinite(ttl) && ttl > 0 ? ttl * 1000 : 300_000),
  });
  return data.access_token;
}
