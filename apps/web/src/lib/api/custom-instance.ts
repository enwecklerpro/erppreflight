/**
 * ERP Preflight — Production Custom Fetch Mutator for Orval & TanStack Query v5
 * Location: apps/web/src/lib/api/custom-instance.ts
 *
 * Implements:
 * - Intelligent base URL normalization (prevents duplicate /api/v1 prefixes)
 * - Multi-tenant isolation: Automatic X-Tenant-Id header injection
 * - Authentication: Automatic Bearer JWT injection
 * - Query cancellation: AbortSignal forwarding from TanStack Query
 * - SSR safety: Safe execution in both browser and Next.js App Router SSR
 * - Structured ApiError parsing matching NestJS HttpExceptionFilter
 * - Clean HTTP 204 / empty payload guards
 */

export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  error?: string;
  correlationId?: string;
  timestamp?: string;
  path?: string;
}

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly correlationId?: string;
  public readonly details?: string | string[];
  public readonly timestamp?: string;
  public readonly path?: string;

  constructor(status: number, data: ApiErrorResponse | string) {
    const message =
      typeof data === 'string'
        ? data
        : Array.isArray(data.message)
        ? data.message.join(', ')
        : data.message;
    super(message || `API request failed with HTTP ${status}`);
    this.name = 'ApiError';
    this.statusCode = status;

    if (typeof data !== 'string') {
      this.correlationId = data.correlationId;
      this.details = data.message;
      this.timestamp = data.timestamp;
      this.path = data.path;
    }
  }
}

export const AUTH_TOKEN_KEY = 'erppreflight_token';
export const TENANT_ID_KEY = 'erppreflight_tenant_id';

/**
 * Browser-side storage helpers for auth and tenant context.
 */
export const getStoredAuthToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
};

export const setStoredAuthToken = (token: string | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {
    // Ignore storage quota / private browsing exceptions
  }
};

export const getStoredTenantId = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(TENANT_ID_KEY);
  } catch {
    return null;
  }
};

export const setStoredTenantId = (tenantId: string | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (tenantId) {
      localStorage.setItem(TENANT_ID_KEY, tenantId);
    } else {
      localStorage.removeItem(TENANT_ID_KEY);
    }
  } catch {
    // Ignore storage quota / private browsing exceptions
  }
};

/**
 * Builds the canonical request URL from base URL and path.
 * Strips redundant /api/v1 if both base URL and endpoint path include it.
 */
export const resolveApiUrl = (path: string): string => {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  const rawBase =
    process.env.NEXT_PUBLIC_API_URL ||
    (typeof window !== 'undefined' ? '' : 'http://localhost:4000');

  let cleanBase = rawBase.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  // If base ends with /api/v1 and path starts with /api/v1, strip prefix from base
  if (cleanBase.endsWith('/api/v1') && cleanPath.startsWith('/api/v1')) {
    cleanBase = cleanBase.slice(0, -'/api/v1'.length);
  }

  return `${cleanBase}${cleanPath}`;
};

/**
 * Core custom fetch mutator used by all Orval-generated query and mutation hooks.
 */
export const customInstance = async <T>(
  url: string,
  options?: RequestInit
): Promise<T> => {
  const fullUrl = resolveApiUrl(url);
  const headers = new Headers(options?.headers);

  // Default content-type for mutation payloads sending JSON
  if (
    options?.body &&
    typeof options.body === 'string' &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  // Multi-tenant & Auth headers in browser environment
  if (typeof window !== 'undefined') {
    const token = getStoredAuthToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const tenantId = getStoredTenantId();
    if (tenantId && !headers.has('X-Tenant-Id')) {
      headers.set('X-Tenant-Id', tenantId);
    }
  }

  const response = await fetch(fullUrl, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    let errorData: ApiErrorResponse | string;
    try {
      errorData = text ? (JSON.parse(text) as ApiErrorResponse) : `HTTP ${response.status}`;
    } catch {
      errorData = text || `HTTP ${response.status}`;
    }
    throw new ApiError(response.status, errorData);
  }

  // HTTP 204 No Content
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  // Empty response body guard
  const text = await response.text();
  if (!text || text.trim() === '') {
    return undefined as unknown as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
};

export default customInstance;
