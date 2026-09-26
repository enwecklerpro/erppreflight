import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/settings/security',
  useSearchParams: () => new URLSearchParams(),
}));

import {
  LoginResponseSchema,
  SessionResponseSchema,
  apiErrorCode,
  safeNextPath,
  fetchMyOrganizations,
} from '../lib/account-api';
import { ApiError, TENANT_ID_KEY } from '../lib/api/custom-instance';
import { groupSecret, toFactor } from '../components/account/two-factor-panel';
import { describeUserAgent } from '../components/account/sessions-panel';
import { OrganizationSwitcher } from '../components/account/organization-switcher';
import { AccountStatusBanner } from '../components/account/account-status-banner';
import { SettingsNav } from '../components/account/settings-nav';
import { Notice } from '../components/account/ui';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function withClient(ui: React.ReactElement, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

describe('account-api helpers', () => {
  it('only accepts same-origin relative redirect targets', () => {
    expect(safeNextPath('/accept-invite?token=abc')).toBe('/accept-invite?token=abc');
    expect(safeNextPath('https://evil.example')).toBe('/projects');
    expect(safeNextPath('//evil.example/x')).toBe('/projects');
    expect(safeNextPath('/\\evil.example')).toBe('/projects');
    expect(safeNextPath(null)).toBe('/projects');
  });

  it('distinguishes MFA challenges from sessions in login responses', () => {
    const challenge = LoginResponseSchema.parse({ mfaRequired: true, challengeToken: 'c', expiresIn: 300 });
    expect('mfaRequired' in challenge).toBe(true);
    const session = LoginResponseSchema.parse({
      accessToken: 't',
      user: { id: 'u', email: 'a@b.co', organizationId: 'o', role: 'VIEWER' },
    });
    expect('accessToken' in session).toBe(true);
    expect(() => SessionResponseSchema.parse({ user: {} })).toThrow();
  });

  it('exposes machine-readable API error codes', () => {
    const err = new ApiError(403, { statusCode: 403, message: 'Verify', code: 'EMAIL_NOT_VERIFIED' });
    expect(apiErrorCode(err)).toBe('EMAIL_NOT_VERIFIED');
    expect(apiErrorCode(new Error('x'))).toBeUndefined();
  });

  it('formats 2FA inputs and device labels', () => {
    expect(toFactor(' 123456 ')).toEqual({ code: '123456' });
    expect(toFactor('abcde-12345')).toEqual({ recoveryCode: 'abcde-12345' });
    expect(groupSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36')).toBe('Chrome on Windows');
    expect(describeUserAgent(null)).toBe('Unknown device');
  });
});

describe('Notice', () => {
  it('announces errors assertively with a text label (not color only)', () => {
    render(<Notice tone="error" title="Failed">Details</Notice>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Error:');
    expect(alert).toHaveTextContent('Failed');
  });
});

describe('SettingsNav', () => {
  it('marks the current settings page', () => {
    render(<SettingsNav />);
    expect(screen.getByRole('link', { name: /Security/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Members/ })).not.toHaveAttribute('aria-current');
  });
});

describe('OrganizationSwitcher', () => {
  const orgs = [
    { id: 'org-a', name: 'Org A', role: 'ORGANIZATION_OWNER' },
    { id: 'org-b', name: 'Org B', role: 'AUDITOR' },
  ];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    push.mockReset();
    fetchMock = vi.fn(async () => jsonResponse(orgs));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('validates the organization list with Zod', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 1 }]));
    await expect(fetchMyOrganizations()).rejects.toThrow();
  });

  it('switches tenant: clears the query cache, stores X-Tenant-Id and navigates', async () => {
    const { client } = withClient(<OrganizationSwitcher homeOrganizationId="org-a" />);
    client.setQueryData(['projects', 'list'], [{ id: 'secret-project-of-org-a' }]);
    const select = await screen.findByRole('combobox');
    expect((select as HTMLSelectElement).value).toBe('org-a');

    fireEvent.change(select, { target: { value: 'org-b' } });

    await waitFor(() => expect(localStorage.getItem(TENANT_ID_KEY)).toBe('org-b'));
    expect(client.getQueryData(['projects', 'list'])).toBeUndefined();
    expect(push).toHaveBeenCalledWith('/projects');
  });

  it('shows a plain label when the user belongs to one organization', async () => {
    fetchMock.mockResolvedValue(jsonResponse([orgs[0]]));
    withClient(<OrganizationSwitcher homeOrganizationId="org-a" />);
    expect(await screen.findByText('Org A')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('AccountStatusBanner', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(me: Record<string, unknown>, org: Record<string, unknown>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/auth/me')
          ? jsonResponse({ user: { id: 'u', organizationId: 'o', email: 'a@b.co', ...me } })
          : jsonResponse({ id: 'o', name: 'Org', ...org })
      )
    );
  }

  it('asks unverified users to verify (analyses locked) with a resend action', async () => {
    stub({ emailVerified: false, mfaEnabled: false }, { require_2fa: false });
    withClient(<AccountStatusBanner signedIn />);
    expect(await screen.findByText(/Verify your e-mail address/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resend verification e-mail/ })).toBeInTheDocument();
  });

  it('prompts 2FA enrollment when the organization requires it', async () => {
    stub({ emailVerified: true, mfaEnabled: false }, { require_2fa: true });
    withClient(<AccountStatusBanner signedIn />);
    expect(await screen.findByText(/Two-factor authentication required/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Enable it now/ })).toHaveAttribute('href', '/settings/security');
  });

  it('renders nothing for verified users without pending requirements', async () => {
    stub({ emailVerified: true, mfaEnabled: true }, { require_2fa: true });
    const { container } = withClient(<AccountStatusBanner signedIn />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container).toBeEmptyDOMElement();
  });
});
