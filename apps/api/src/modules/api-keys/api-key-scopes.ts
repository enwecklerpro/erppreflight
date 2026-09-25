import { SetMetadata } from '@nestjs/common';

/** Scopes that may be granted to an organization API key. */
export const API_KEY_SCOPES = [
  'projects:read',
  'projects:write',
  'analysis:read',
  'analysis:run',
  'findings:read',
  'findings:write',
  'reports:read',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const DEFAULT_API_KEY_SCOPES: ApiKeyScope[] = [
  'projects:read',
  'analysis:run',
  'analysis:read',
  'reports:read',
];

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Coarse read/write scope enforcement for API-key principals:
 * - safe methods require at least one granted scope;
 * - mutating methods require at least one non-read scope (`*:write` / `*:run`).
 */
export function apiKeyScopesAllow(method: string, scopes: unknown): boolean {
  const granted = normalizeScopes(scopes);
  if (granted.length === 0) {
    return false;
  }
  if (READ_ONLY_METHODS.has(String(method || 'GET').toUpperCase())) {
    return true;
  }
  return granted.some((scope) => {
    const action = scope.split(':')[1];
    return action === 'write' || action === 'run';
  });
}

export function normalizeScopes(scopes: unknown): string[] {
  let value = scopes;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const allowed = new Set<string>(API_KEY_SCOPES);
  return value.filter((s): s is string => typeof s === 'string' && allowed.has(s));
}

export const DENY_API_KEY_AUTH = 'deny_api_key_auth';

/**
 * Marks a controller/handler as requiring an interactive (JWT) session.
 * API keys are rejected, e.g. for API-key and webhook management.
 */
export const DenyApiKeyAuth = () => SetMetadata(DENY_API_KEY_AUTH, true);
