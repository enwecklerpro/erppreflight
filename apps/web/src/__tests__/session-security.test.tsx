import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '../test/render';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const push = vi.fn();
const replace = vi.fn();
let search = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn() }),
  usePathname: () => '/login',
  useSearchParams: () => search,
}));

import {
  CSRF_COOKIE_NAME,
  LEGACY_AUTH_TOKEN_KEY,
  SESSION_EPOCH_KEY,
  TENANT_ID_KEY,
  clearClientSession,
  customInstance,
  hasAuthHint,
  markSignedIn,
  purgeLegacyAuthToken,
  setCsrfToken,
} from '../lib/api/custom-instance';
import { storeSession, requestMagicLink, verifyMagicLink } from '../lib/account-api';
import { MagicLinkRequest } from '../components/account/magic-link-request';
import MagicLinkPage from '../app/login/magic/page';

const BASE = 'https://api.example.test';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function clearCookies() {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
}

function withClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('cookie-only browser session (spec C §8.2 / §68)', () => {
  const originalEnv = process.env.NEXT_PUBLIC_API_URL;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = BASE;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
    sessionStorage.clear();
    clearCookies();
    setCsrfToken(null);
    push.mockReset();
    replace.mockReset();
    search = new URLSearchParams();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalEnv !== undefined) process.env.NEXT_PUBLIC_API_URL = originalEnv;
    else delete process.env.NEXT_PUBLIC_API_URL;
  });

  it('never sends a bearer token, even when an old release left one in storage', async () => {
    localStorage.setItem(LEGACY_AUTH_TOKEN_KEY, 'legacy-jwt');
    sessionStorage.setItem(LEGACY_AUTH_TOKEN_KEY, 'legacy-jwt');
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await customInstance('/projects');
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).get('Authorization')).toBeNull();
    expect(init.credentials).toBe('include');
  });

  it('purges legacy tokens from localStorage and sessionStorage', () => {
    localStorage.setItem(LEGACY_AUTH_TOKEN_KEY, 'a');
    sessionStorage.setItem(LEGACY_AUTH_TOKEN_KEY, 'b');
    purgeLegacyAuthToken();
    expect(localStorage.getItem(LEGACY_AUTH_TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(LEGACY_AUTH_TOKEN_KEY)).toBeNull();
  });

  it('storeSession keeps no credential: only marker cookie, tenant, CSRF token and a cross-tab signal', async () => {
    storeSession({ user: { id: 'u', email: 'a@b.co', organizationId: 'org-1', role: 'VIEWER' }, csrfToken: 'csrf-1' } as any);
    expect(hasAuthHint()).toBe(true);
    expect(localStorage.getItem(TENANT_ID_KEY)).toBe('org-1');
    expect(localStorage.getItem(SESSION_EPOCH_KEY)).toBeTruthy();
    expect(localStorage.getItem(LEGACY_AUTH_TOKEN_KEY)).toBeNull();
    const stored = [...Object.keys(localStorage).map((k) => localStorage.getItem(k)), document.cookie].join(' ');
    expect(stored).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./); // no JWT anywhere

    fetchMock.mockResolvedValue(jsonResponse({ id: 'p1' }));
    await customInstance('/projects', { method: 'POST', body: JSON.stringify({ name: 'x' }) });
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('X-CSRF-Token')).toBe('csrf-1');
  });

  it('prefers the API-set erp_csrf cookie when this origin can read it', async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=from-cookie; path=/`;
    setCsrfToken('stale-memory');
    fetchMock.mockResolvedValue(jsonResponse({}));
    await customInstance('/projects/p1', { method: 'DELETE' });
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('X-CSRF-Token')).toBe('from-cookie');
  });

  it('fetches the token from GET /auth/csrf when signed in without a readable cookie; GETs carry none', async () => {
    markSignedIn({ organizationId: 'org-1' });
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/api/v1/auth/csrf') ? jsonResponse({ csrfToken: 'fetched' }) : jsonResponse({ ok: true })
    );
    await customInstance('/projects');
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('X-CSRF-Token')).toBeNull();
    await customInstance('/projects', { method: 'PATCH', body: '{}' });
    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls).toContain(`${BASE}/api/v1/auth/csrf`);
    const patch = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/projects') && c[1]?.method === 'PATCH')!;
    expect(new Headers(patch[1].headers).get('X-CSRF-Token')).toBe('fetched');
  });

  it('retries once with a fresh token after 403 CSRF_REJECTED (session rotated elsewhere)', async () => {
    setCsrfToken('old');
    let posts = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (String(url).endsWith('/auth/csrf')) return jsonResponse({ csrfToken: 'new' });
      posts += 1;
      const header = new Headers(init.headers).get('X-CSRF-Token');
      return header === 'new'
        ? jsonResponse({ id: 'ok' })
        : jsonResponse({ statusCode: 403, message: 'Request rejected', code: 'CSRF_REJECTED' }, 403);
    });
    const result = await customInstance<{ id: string }>('/projects', { method: 'POST', body: '{}' });
    expect(result.id).toBe('ok');
    expect(posts).toBe(2);
  });

  it('does not loop when the refreshed token is rejected again', async () => {
    setCsrfToken('old');
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/auth/csrf')
        ? jsonResponse({ csrfToken: 'new' })
        : jsonResponse({ statusCode: 403, message: 'Request rejected', code: 'CSRF_REJECTED' }, 403)
    );
    await expect(customInstance('/projects', { method: 'POST', body: '{}' })).rejects.toMatchObject({ statusCode: 403, code: 'CSRF_REJECTED' });
    expect(fetchMock.mock.calls.filter((c) => !String(c[0]).endsWith('/auth/csrf'))).toHaveLength(2);
  });

  it('session-issuing responses update the in-memory CSRF token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ user: { id: 'u' }, csrfToken: 'issued' }));
    await customInstance('/auth/switch-organization', { method: 'POST', body: '{}' });
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await customInstance('/projects', { method: 'POST', body: '{}' });
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('X-CSRF-Token')).toBe('issued');
  });

  it('clearClientSession forgets marker, tenant and CSRF token', async () => {
    markSignedIn({ organizationId: 'org-1', csrfToken: 'x' });
    clearClientSession();
    expect(hasAuthHint()).toBe(false);
    expect(localStorage.getItem(TENANT_ID_KEY)).toBeNull();
    fetchMock.mockResolvedValue(jsonResponse({}));
    await customInstance('/auth/magic-link', { method: 'POST', body: '{}' });
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('X-CSRF-Token')).toBeNull();
  });

  it('magic-link API helpers validate responses', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ accepted: true, message: 'sent', expiresInMinutes: 15 }));
    expect((await requestMagicLink('a@b.co', '/projects/1')).expiresInMinutes).toBe(15);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'a@b.co', next: '/projects/1' });
    fetchMock.mockResolvedValueOnce(jsonResponse({ mfaRequired: true, challengeToken: 'c', expiresIn: 300 }));
    expect(await verifyMagicLink('a'.repeat(43))).toMatchObject({ mfaRequired: true });
    fetchMock.mockResolvedValueOnce(jsonResponse({ nonsense: true }));
    await expect(requestMagicLink('a@b.co')).rejects.toThrow();
  });

  it('request form shows the neutral confirmation (no account enumeration)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ accepted: true, message: 'sent', expiresInMinutes: 15 }));
    withClient(<MagicLinkRequest initialEmail="ann@example.com" onUsePassword={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /send sign-in link/i }));
    await waitFor(() => expect(screen.getByTestId('magic-link-sent')).toBeTruthy());
    expect(screen.getByTestId('magic-link-sent').textContent).toContain('ann@example.com');
    expect(screen.getByTestId('magic-link-sent').textContent).toContain('15');
  });

  it('landing page shows an invalid-link state for malformed tokens without calling the API', async () => {
    search = new URLSearchParams('token=short');
    withClient(<MagicLinkPage />);
    await waitFor(() => expect(screen.getByTestId('magic-link-invalid')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('landing page previews, then signs in only after the explicit click', async () => {
    const token = 'b'.repeat(43);
    search = new URLSearchParams(`token=${token}&next=/projects/p1`);
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/auth/magic-link/preview')) {
        return jsonResponse({ valid: true, email: 'ann@example.com', expiresAt: '2030-01-01T00:00:00.000Z' });
      }
      return jsonResponse({ user: { id: 'u', email: 'ann@example.com', organizationId: 'org-1', role: 'VIEWER' }, csrfToken: 'c1' });
    });
    withClient(<MagicLinkPage />);
    await waitFor(() => expect(screen.getByTestId('magic-link-ready')).toBeTruthy());
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/verify'))).toBe(false);
    fireEvent.click(screen.getByTestId('magic-link-continue'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/projects/p1'));
    expect(hasAuthHint()).toBe(true);
    expect(localStorage.getItem(TENANT_ID_KEY)).toBe('org-1');
  });

  it('landing page reports used/expired links from the API', async () => {
    search = new URLSearchParams(`token=${'c'.repeat(43)}`);
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/preview')
        ? jsonResponse({ valid: true, email: 'ann@example.com' })
        : jsonResponse({ statusCode: 401, message: 'This sign-in link is invalid', code: 'MAGIC_LINK_INVALID' }, 401)
    );
    withClient(<MagicLinkPage />);
    await waitFor(() => expect(screen.getByTestId('magic-link-ready')).toBeTruthy());
    fireEvent.click(screen.getByTestId('magic-link-continue'));
    await waitFor(() => expect(screen.getByTestId('magic-link-invalid')).toBeTruthy());
  });
});
