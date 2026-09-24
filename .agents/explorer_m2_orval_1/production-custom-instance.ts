/**
 * Custom fetch client for Orval-generated React Query hooks.
 * Handles base URL routing, JWT authorization, multi-tenant X-Tenant-Id header,
 * query parameter formatting, and error handling for ERP Preflight SaaS.
 */

export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  error?: string;
  correlationId?: string;
}

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly correlationId?: string;
  public readonly details?: string | string[];

  constructor(status: number, data: ApiErrorResponse | string) {
    const message = typeof data === 'string' ? data : (Array.isArray(data.message) ? data.message.join(', ') : data.message);
    super(message || `API request failed with status ${status}`);
    this.name = 'ApiError';
    this.statusCode = status;
    if (typeof data !== 'string') {
      this.correlationId = data.correlationId;
      this.details = data.message;
    }
  }
}

export const customInstance = async <T>(
  url: string,
  options?: RequestInit
): Promise<T> => {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
  const cleanBase = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
  const cleanPath = url.startsWith('/') ? url : `/${url}`;
  const fullUrl = url.startsWith('http://') || url.startsWith('https://')
    ? url
    : `${cleanBase}${cleanPath}`;

  const headers = new Headers(options?.headers);

  // Default content-type for mutations sending JSON
  if (
    options?.body &&
    typeof options.body === 'string' &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  // Multi-tenant & Auth headers in browser environment
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('erppreflight_token');
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const tenantId = localStorage.getItem('erppreflight_tenant_id');
    if (tenantId && !headers.has('X-Tenant-Id')) {
      headers.set('X-Tenant-Id', tenantId);
    }
  }

  const response = await fetch(fullUrl, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorData: ApiErrorResponse | string;
    try {
      errorData = await response.json();
    } catch {
      errorData = await response.text();
    }
    throw new ApiError(response.status, errorData);
  }

  // 204 No Content
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  // Empty response body guard
  const text = await response.text();
  if (!text) {
    return undefined as unknown as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
};

export default customInstance;
