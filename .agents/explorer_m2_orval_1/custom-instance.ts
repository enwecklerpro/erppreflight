export interface CustomInstanceConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, any>;
  data?: any;
  responseType?: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

export const customInstance = async <T>(
  config: CustomInstanceConfig,
  options?: RequestInit
): Promise<T> => {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
  let url = config.url.startsWith('http') ? config.url : `${baseUrl}${config.url.startsWith('/') ? config.url : `/${config.url}`}`;
  
  if (config.params) {
    const searchParams = new URLSearchParams();
    Object.entries(config.params).forEach(([key, val]) => {
      if (val !== undefined && val !== null) {
        searchParams.append(key, String(val));
      }
    });
    const qs = searchParams.toString();
    if (qs) {
      url += (url.includes('?') ? '&' : '?') + qs;
    }
  }

  const headers = new Headers(options?.headers || config.headers || {});
  if (!headers.has('Content-Type') && config.data && typeof config.data === 'object' && !(config.data instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  // Retrieve token from client storage or auth context if in browser
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

  const body = config.data
    ? config.data instanceof FormData
      ? config.data
      : JSON.stringify(config.data)
    : undefined;

  const res = await fetch(url, {
    ...options,
    method: config.method,
    headers,
    body,
    signal: config.signal || options?.signal,
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(errorBody.message || `API Error: ${res.status}`);
  }

  if (res.status === 204) {
    return undefined as unknown as T;
  }

  return (await res.json()) as T;
};

export default customInstance;
