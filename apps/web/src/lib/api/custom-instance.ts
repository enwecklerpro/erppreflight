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
 * Normalizes double slashes, trims whitespace, and handles edge cases cleanly.
 */
export const resolveApiUrl = (path: string): string => {
  const trimmedPath = (path || '').trim();
  if (trimmedPath.startsWith('http://') || trimmedPath.startsWith('https://')) {
    return trimmedPath;
  }

  const rawBase = (
    process.env.NEXT_PUBLIC_API_URL ||
    (typeof window !== 'undefined' ? '' : 'http://localhost:3001')
  ).trim();

  // Normalize base:
  // 1. Collapse multiple slashes after protocol (http:// or https://)
  // 2. Strip trailing slashes
  // 3. Collapse duplicate /api/v1 at end of base
  let cleanBase = rawBase
    .replace(/(https?:\/\/)|(\/)+/g, (_m, proto, slash) => proto || slash || '')
    .replace(/\/+$/, '')
    .replace(/(\/api\/v1)+$/, '/api/v1');

  // Split path into pathname and search/hash (? or #) to preserve query parameters
  const queryOrHashIndex = trimmedPath.search(/[?#]/);
  let pathname = queryOrHashIndex === -1 ? trimmedPath : trimmedPath.slice(0, queryOrHashIndex);
  const searchAndHash = queryOrHashIndex === -1 ? '' : trimmedPath.slice(queryOrHashIndex);

  // Normalize pathname: collapse consecutive slashes
  pathname = pathname.replace(/\/{2,}/g, '/');

  // Ensure leading slash if pathname is non-empty
  if (pathname && !pathname.startsWith('/')) {
    pathname = `/${pathname}`;
  }

  // Collapse accidental duplicate /api/v1 segments at the start of pathname
  pathname = pathname.replace(/^(\/api\/v1)+(?=\/|$)/, '/api/v1');

  // Boundary check: does pathname start with /api/v1 (followed by / or end of string)?
  const hasApiV1 = /^\/api\/v1(?=$|\/)/.test(pathname);
  const baseHasApiV1 = cleanBase.endsWith('/api/v1');

  if (hasApiV1) {
    if (baseHasApiV1) {
      cleanBase = cleanBase.slice(0, -'/api/v1'.length).replace(/\/+$/, '');
    }
  } else {
    // Path does not have /api/v1
    if (!baseHasApiV1) {
      if (pathname === '' || pathname === '/') {
        pathname = '/api/v1';
      } else {
        pathname = `/api/v1${pathname}`;
      }
    } else {
      if (pathname === '/') {
        pathname = '';
      }
    }
  }

  return `${cleanBase}${pathname}${searchAndHash}`;
};

/**
 * Resolves a URL on the API origin *outside* the /api/v1 global prefix
 * (e.g. /health/readiness, which the API excludes from the prefix).
 */
export const resolveApiRootUrl = (path: string): string => {
  const rawBase = (
    process.env.NEXT_PUBLIC_API_URL ||
    (typeof window !== 'undefined' ? '' : 'http://localhost:3001')
  ).trim();
  const base = rawBase
    .replace(/\/+$/, '')
    .replace(/(\/api\/v1)+$/, '')
    .replace(/\/+$/, '');
  const cleanPath = `/${(path || '').trim().replace(/^\/+/, '')}`;
  return `${base}${cleanPath}`;
};

/**
 * Attaches Bearer JWT and X-Tenant-Id headers from browser storage.
 */
const applyAuthHeaders = (headers: Headers): void => {
  if (typeof window === 'undefined') return;
  const token = getStoredAuthToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const tenantId = getStoredTenantId();
  if (tenantId && !headers.has('X-Tenant-Id')) {
    headers.set('X-Tenant-Id', tenantId);
  }
};

const toApiError = async (response: Response): Promise<ApiError> => {
  const text = await response.text();
  let errorData: ApiErrorResponse | string;
  try {
    errorData = text ? (JSON.parse(text) as ApiErrorResponse) : `HTTP ${response.status}`;
  } catch {
    errorData = text || `HTTP ${response.status}`;
  }
  return new ApiError(response.status, errorData);
};

/**
 * Extracts the file name from a Content-Disposition header, if present.
 */
export const parseContentDispositionFileName = (header: string | null): string | null => {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      // fall through to plain filename
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || null;
};

export interface DownloadedFile {
  blob: Blob;
  fileName: string;
}

/**
 * Authenticated binary fetch for API downloads (ZIP bundles, HTML reports).
 * Uses the same URL resolution and auth/tenant headers as customInstance but
 * returns the raw Blob instead of parsing text/JSON.
 */
export const fetchApiBlob = async (
  url: string,
  fallbackFileName: string,
  options?: RequestInit
): Promise<DownloadedFile> => {
  const headers = new Headers(options?.headers);
  applyAuthHeaders(headers);
  const response = await fetch(resolveApiUrl(url), {
    ...options,
    headers,
    credentials: 'include',
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  const blob = await response.blob();
  const fileName =
    parseContentDispositionFileName(response.headers.get('Content-Disposition')) ||
    fallbackFileName;
  return { blob, fileName };
};

/**
 * Hands a Blob to the browser as a file download via a temporary object URL.
 */
export const saveBlobAsFile = ({ blob, fileName }: DownloadedFile): void => {
  if (typeof window === 'undefined') return;
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    // Defer revocation so the browser can start the download.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
};

/**
 * Fetches an authenticated API file and triggers a browser download.
 */
export const downloadApiFile = async (
  url: string,
  fallbackFileName: string
): Promise<DownloadedFile> => {
  const file = await fetchApiBlob(url, fallbackFileName);
  saveBlobAsFile(file);
  return file;
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
  applyAuthHeaders(headers);

  const response = await fetch(fullUrl, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    throw await toApiError(response);
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
