import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '../test/render';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  usePathname: () => '/projects',
  useSearchParams: () => new URLSearchParams(),
}));

import { ImpersonationBanner, formatRemaining } from '../components/tenant-access/impersonation-banner';
import { TenantAccessNotice, shouldRedirectToAccessPage } from '../components/tenant-access/tenant-access-notice';
import { AllowlistFormSchema, isPlausibleCidr } from '../components/tenant-access/ip-allowlist-panel';
import { TenantActionSchema, ExtendTrialFormSchema } from '../components/tenant-access/tenant-access-admin';
import { ApiError } from '../lib/api/custom-instance';
import { localizeError } from '../i18n/validation';
import { getT } from '../i18n/translate';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function withClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const status = (over: Record<string, unknown> = {}) => ({
  organizationId: 'o',
  organizationName: 'Acme',
  status: 'ACTIVE',
  suspended: false,
  suspendedAt: null,
  suspensionReason: null,
  ipAllowlist: { enforced: false, clientIp: '192.0.2.1', clientIpAllowed: true },
  impersonating: false,
  ...over,
});

describe('tenant access helpers', () => {
  it('formats the countdown', () => {
    expect(formatRemaining(5 * 60_000)).toBe('05:00');
    expect(formatRemaining(61_500)).toBe('01:02');
    expect(formatRemaining(-5)).toBe('00:00');
    expect(formatRemaining(3_600_000 + 1000)).toBe('1:00:01');
  });

  it('checks CIDR plausibility before the request', () => {
    for (const ok of ['203.0.113.0/24', '198.51.100.7', '2001:db8::/32', '::1', '10.0.0.0/8']) expect(isPlausibleCidr(ok)).toBe(true);
    for (const bad of ['10.0.0.0/33', '300.1.1.1', 'abc', '10.0.0.0/0', '2001:db8::/129', '1::2::3', '10.0.0.0/8/1', '']) expect(isPlausibleCidr(bad)).toBe(false);
  });

  it('rejects duplicate allowlist entries and more than 50', () => {
    expect(AllowlistFormSchema.safeParse({ entries: [{ cidr: '10.0.0.0/8', label: '' }, { cidr: '10.0.0.0/8', label: 'x' }] }).success).toBe(false);
    expect(AllowlistFormSchema.safeParse({ entries: Array.from({ length: 51 }, (_, i) => ({ cidr: `10.${i}.0.0/16`, label: '' })) }).success).toBe(false);
    expect(AllowlistFormSchema.safeParse({ entries: [{ cidr: '10.0.0.0/8', label: 'office' }] }).success).toBe(true);
  });

  it('admin actions require a reason and bounded days', () => {
    expect(TenantActionSchema.safeParse({ reason: 'short' }).success).toBe(false);
    expect(TenantActionSchema.safeParse({ reason: 'Unpaid invoices since July' }).success).toBe(true);
    expect(ExtendTrialFormSchema.safeParse({ reason: 'Pilot extended by sales', days: '91' }).success).toBe(false);
    expect(ExtendTrialFormSchema.safeParse({ reason: 'Pilot extended by sales', days: '14' }).success).toBe(true);
  });

  it('redirects blocked members from organization pages only', () => {
    const suspended = status({ suspended: true });
    expect(shouldRedirectToAccessPage('/projects/x', suspended as any)).toBe(true);
    expect(shouldRedirectToAccessPage('/settings/account', suspended as any)).toBe(false);
    expect(shouldRedirectToAccessPage('/suspended', suspended as any)).toBe(false);
    expect(shouldRedirectToAccessPage('/en/pricing', suspended as any)).toBe(false);
    expect(shouldRedirectToAccessPage('/projects', status() as any)).toBe(false);
    expect(shouldRedirectToAccessPage('/projects', status({ suspended: true, impersonating: true }) as any)).toBe(false);
    expect(shouldRedirectToAccessPage('/dashboard', status({ ipAllowlist: { enforced: true, clientIp: '1.2.3.4', clientIpAllowed: false } }) as any)).toBe(true);
  });

  it('localizes tenant access error codes (EN + DE)', () => {
    const err = new ApiError(403, { statusCode: 403, message: 'This organization has been suspended.', code: 'TENANT_SUSPENDED' });
    expect(localizeError(err, getT('de'))).toMatch(/Organisation ist gesperrt/);
    const ro = new ApiError(403, { statusCode: 403, message: 'x', code: 'IMPERSONATION_READ_ONLY' });
    expect(localizeError(ro, getT('en'))).toMatch(/read-only/);
  });
});

describe('ImpersonationBanner', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows who is impersonated, the mode, the countdown and ends the session', async () => {
    const now = Date.now();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/impersonation/end')) return jsonResponse({ ended: true, returnTo: '/admin' });
      return jsonResponse({
        active: true,
        serverTime: new Date(now).toISOString(),
        session: {
          id: 's',
          organizationId: 'o',
          organizationName: 'Acme',
          targetUserId: 'u',
          targetEmail: 'member@acme.test',
          targetFullName: null,
          memberRole: 'ORGANIZATION_OWNER',
          impersonatorEmail: 'ops@example.com',
          mode: 'READ_ONLY',
          reason: 'Ticket 4711',
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 5 * 60_000).toISOString(),
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    withClient(<ImpersonationBanner signedIn />);
    expect(await screen.findByText('You are impersonating member@acme.test')).toBeInTheDocument();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent(/Ends in 0[45]:\d\d/);
    fireEvent.click(screen.getByRole('button', { name: 'End impersonation' }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/impersonation/end'))).toBe(true));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/admin'));
  });

  it('renders nothing when no impersonation is active', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ active: false, serverTime: new Date().toISOString() })));
    const { container } = withClient(<ImpersonationBanner signedIn />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container).toBeEmptyDOMElement();
  });
});

describe('TenantAccessNotice', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('explains the suspension and redirects organization pages to /suspended', async () => {
    replace.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(status({ suspended: true, status: 'SUSPENDED', suspensionReason: 'Unpaid' }))));
    withClient(<TenantAccessNotice signedIn />);
    expect(await screen.findByText('This organization is suspended')).toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/suspended'));
  });
});
