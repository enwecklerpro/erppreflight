/**
 * ERP Preflight — Production Custom Fetch Mutator for Orval & TanStack Query v5
 * Location: apps/web/src/lib/api/custom-instance.ts
 *
 * Implements:
 * - Intelligent base URL normalization (prevents duplicate /api/v1 prefixes)
 * - Multi-tenant isolation: Automatic X-Tenant-Id header injection
 * - Authentication: HttpOnly session cookie only (credentials: 'include'); no token
 *   is ever stored in or read from localStorage / sessionStorage / script cookies
 * - CSRF: X-CSRF-Token on POST/PUT/PATCH/DELETE (signed double-submit token)
 * - Query cancellation: AbortSignal forwarding from TanStack Query
 * - SSR safety: Safe execution in both browser and Next.js App Router SSR
 * - Structured ApiError parsing matching NestJS HttpExceptionFilter
 * - Clean HTTP 204 / empty payload guards
 */

import { applyLocaleHeader } from './locale-header';

export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  error?: string;
  correlationId?: string;
  timestamp?: string;
  path?: string;
  /** Machine-readable error code, e.g. EMAIL_NOT_VERIFIED or MFA_ENROLLMENT_REQUIRED. */
  code?: string;
}

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly correlationId?: string;
  public readonly details?: string | string[];
  public readonly timestamp?: string;
  public readonly path?: string;
  public readonly code?: string;

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
      this.code = typeof data.code === 'string' ? data.code : undefined;
    }
  }
}

export const TENANT_ID_KEY = 'erppreflight_tenant_id';

/**
 * Legacy storage key of the bearer token. Browser sessions are cookie-only
 * (HttpOnly `erppreflight_session`, spec C §8.2 / §68): the web app never stores,
 * reads or sends a session token itself. The key is only kept to delete tokens
 * left behind by older releases (purgeLegacyAuthToken, run on app start).
 */
export const LEGACY_AUTH_TOKEN_KEY = 'erppreflight_token';

/**
 * Non-sensitive cross-tab signal (a random nonce, no credential): written on sign-in
 * and sign-out so other tabs evict their query cache (storage event).
 */
export const SESSION_EPOCH_KEY = 'erppreflight_session_epoch';

/** Removes bearer tokens stored by releases before cookie-only sessions. */
export const purgeLegacyAuthToken = (): void => {
  if (typeof window === 'undefined') return;
  for (const storage of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      storage().removeItem(LEGACY_AUTH_TOKEN_KEY);
    } catch {
      // storage disabled
    }
  }
};

/**
 * Non-sensitive marker cookie (no token inside) telling the Next.js middleware that
 * a sign-in exists, so private routes can redirect anonymous visitors to /login
 * before rendering. The API remains the only authority on authentication.
 */
export const AUTH_HINT_COOKIE = 'erp_auth';
const AUTH_HINT_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export const setAuthHintCookie = (present: boolean): void => {
  if (typeof document === 'undefined') return;
  try {
    const secure = window.location.protocol === 'https:' ? '; secure' : '';
    document.cookie = present
      ? `${AUTH_HINT_COOKIE}=1; path=/; max-age=${AUTH_HINT_MAX_AGE_SECONDS}; samesite=lax${secure}`
      : `${AUTH_HINT_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`;
  } catch {
    // cookies disabled
  }
};

const readDocumentCookie = (name: string): string | null => {
  if (typeof document === 'undefined') return null;
  try {
    for (const part of document.cookie.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1 || part.slice(0, idx).trim() !== name) continue;
      const value = part.slice(idx + 1).trim();
      return value ? decodeURIComponent(value) : null;
    }
  } catch {
    // cookies disabled / malformed value
  }
  return null;
};

/** True when this browser believes a sign-in exists (marker cookie; the API decides). */
export const hasAuthHint = (): boolean => readDocumentCookie(AUTH_HINT_COOKIE) === '1';

const broadcastSessionChange = (): void => {
  if (typeof window === 'undefined') return;
  try {
    const nonce =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    window.localStorage.setItem(SESSION_EPOCH_KEY, nonce);
  } catch {
    // storage disabled
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

// ------------------------------------------------------------------ CSRF (double-submit)

/** Non-HttpOnly cookie the API issues with every session (signed double-submit token). */
export const CSRF_COOKIE_NAME = 'erp_csrf';
export const CSRF_HEADER_NAME = 'X-CSRF-Token';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** In-memory copy (never persisted) for deployments where the API cookie is not readable here. */
let csrfTokenMemory: string | null = null;
let csrfRefresh: Promise<string | null> | null = null;

export const setCsrfToken = (token: string | null | undefined): void => {
  csrfTokenMemory = typeof token === 'string' && token ? token : null;
};

/** Fetches the CSRF token of the current cookie session (null when signed out). */
export const refreshCsrfToken = (): Promise<string | null> => {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (!csrfRefresh) {
    csrfRefresh = (async () => {
      try {
        const res = await fetch(resolveApiUrl('/auth/csrf'), { credentials: 'include', cache: 'no-store' });
        if (!res.ok) return null;
        const data = (await res.json()) as { csrfToken?: unknown };
        setCsrfToken(typeof data?.csrfToken === 'string' ? data.csrfToken : null);
        return csrfTokenMemory;
      } catch {
        return null;
      } finally {
        csrfRefresh = null;
      }
    })();
  }
  return csrfRefresh;
};

/**
 * CSRF token for an unsafe request: the API-set cookie when this origin can read it
 * (same host or shared SESSION_COOKIE_DOMAIN), else the in-memory copy, else
 * GET /auth/csrf when a sign-in exists.
 */
export const getCsrfToken = async (): Promise<string | null> => {
  const fromCookie = readDocumentCookie(CSRF_COOKIE_NAME);
  if (fromCookie) return fromCookie;
  if (csrfTokenMemory) return csrfTokenMemory;
  return hasAuthHint() ? refreshCsrfToken() : null;
};

/**
 * Records a new browser session: marker cookie for the navigation guard, active
 * organization, CSRF token from the response body, cross-tab broadcast. The session
 * credential itself is only in the API's HttpOnly cookie.
 */
export const markSignedIn = (session?: { organizationId?: string | null; csrfToken?: string | null }): void => {
  purgeLegacyAuthToken();
  setAuthHintCookie(true);
  if (session?.organizationId) setStoredTenantId(session.organizationId);
  if (session?.csrfToken) setCsrfToken(session.csrfToken);
  broadcastSessionChange();
};

/** Forgets every client-side trace of the session (the API clears its cookies on logout). */
export const clearClientSession = (): void => {
  purgeLegacyAuthToken();
  setAuthHintCookie(false);
  setStoredTenantId(null);
  setCsrfToken(null);
  broadcastSessionChange();
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
 * Attaches the active organization (X-Tenant-Id), the UI language (Accept-Language) and,
 * for unsafe methods, the CSRF token. Authentication itself is the HttpOnly session cookie (credentials: 'include').
 */
const applyBrowserHeaders = async (headers: Headers, method: string): Promise<void> => {
  if (typeof window === 'undefined') return;
  applyLocaleHeader(headers);
  const tenantId = getStoredTenantId();
  if (tenantId && !headers.has('X-Tenant-Id')) {
    headers.set('X-Tenant-Id', tenantId);
  }
  if (UNSAFE_METHODS.has(method) && !headers.has(CSRF_HEADER_NAME) && !headers.has('Authorization')) {
    const csrf = await getCsrfToken();
    if (csrf) headers.set(CSRF_HEADER_NAME, csrf);
  }
};

const isReplayableBody = (body: unknown): boolean =>
  body === undefined ||
  body === null ||
  typeof body === 'string' ||
  (typeof FormData !== 'undefined' && body instanceof FormData) ||
  (typeof Blob !== 'undefined' && body instanceof Blob) ||
  (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams);

/** Sends a browser request with cookie credentials; retries once after a CSRF token refresh. */
const browserFetch = async (url: string, options: RequestInit | undefined, headers: Headers): Promise<Response> => {
  const method = String(options?.method || 'GET').toUpperCase();
  await applyBrowserHeaders(headers, method);
  const send = () => fetch(url, { ...options, headers, credentials: 'include' });
  const response = await send();
  if (
    response.status === 403 &&
    UNSAFE_METHODS.has(method) &&
    typeof window !== 'undefined' &&
    isReplayableBody(options?.body)
  ) {
    const code = await response
      .clone()
      .json()
      .then((b: { code?: unknown }) => b?.code)
      .catch(() => undefined);
    if (code === 'CSRF_REJECTED') {
      // Session rotated (sign-in in another tab, organization switch, password change):
      // fetch the token of the current cookie session and retry once.
      setCsrfToken(null);
      const fresh = await refreshCsrfToken();
      if (fresh && fresh !== headers.get(CSRF_HEADER_NAME)) {
        headers.set(CSRF_HEADER_NAME, fresh);
        return send();
      }
    }
  }
  return response;
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
  const response = await browserFetch(resolveApiUrl(url), options, headers);
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

  // Tenant + CSRF headers in the browser; the session is the HttpOnly cookie.
  const response = await browserFetch(fullUrl, options, headers);

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

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text as unknown as T;
  }
  // Session-issuing endpoints return the CSRF token of the new session.
  if (parsed && typeof parsed === 'object' && typeof (parsed as { csrfToken?: unknown }).csrfToken === 'string') {
    setCsrfToken((parsed as { csrfToken: string }).csrfToken);
  }
  return parsed as T;
};

export default customInstance;
