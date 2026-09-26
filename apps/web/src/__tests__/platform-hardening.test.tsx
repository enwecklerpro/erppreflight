import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '../test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/projects/p/findings',
  useSearchParams: () => new URLSearchParams(),
}));

import { NotificationLanguage } from '../components/notifications/notification-language';
import { FocusedFinding } from '../components/findings/focused-finding';
import { FocusedFindingSchema, NotificationLocaleSchema, focusedFindingId } from '../lib/api/platform-hardening';

const PROJECT = '22222222-2222-4222-8222-222222222222';
const FINDING = '33333333-3333-4333-8333-333333333333';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function withClient(ui: React.ReactElement, locale: 'en' | 'de' = 'en') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>, { locale });
}

const FINDING_BODY = {
  id: FINDING,
  projectId: PROJECT,
  analysisId: 'a1',
  engineType: 'FORM_DOCTOR',
  ruleId: 'FORM_FIELD_MISSING_IN_XML',
  severity: 'CRITICAL',
  category: 'Data Binding',
  title: "Field 'TaxNumber' missing in runtime XML",
  description: 'd',
  confidence: 'VERIFIED',
  confidenceScore: 1,
  remediation: 'r',
  affectedObjects: [],
  technicalDetails: {},
  evidence: [{ artifactPath: 'ZRECHNUNG_FORMULAR.xdp', lineNumber: 12, sha256: 'ab'.repeat(32) }],
};

afterEach(() => vi.unstubAllGlobals());

describe('platform hardening: API contracts', () => {
  it('accepts only UUIDs as deep-link targets', () => {
    expect(focusedFindingId(FINDING)).toBe(FINDING);
    expect(focusedFindingId('../../admin')).toBeNull();
    expect(focusedFindingId(null)).toBeNull();
  });

  it('validates the notification language and the focused finding payloads', () => {
    expect(NotificationLocaleSchema.parse({ locale: 'de', explicit: true })).toEqual({ locale: 'de', explicit: true });
    expect(NotificationLocaleSchema.safeParse({ locale: 'fr', explicit: true }).success).toBe(false);
    expect(FocusedFindingSchema.safeParse(FINDING_BODY).success).toBe(true);
    expect(FocusedFindingSchema.safeParse({ ...FINDING_BODY, severity: 'SCARY' }).success).toBe(false);
  });
});

describe('NotificationLanguage', () => {
  it('shows the default, saves a choice and announces it (DE)', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT' ? jsonResponse({ locale: 'de', explicit: true }) : jsonResponse({ locale: 'en', explicit: false })
    );
    vi.stubGlobal('fetch', fetchMock);
    withClient(<NotificationLanguage />, 'de');
    expect(await screen.findByText('Noch nicht gewählt – es wird Englisch verwendet.')).toBeInTheDocument();
    const german = screen.getByRole('radio', { name: 'Deutsch' });
    expect(screen.getByRole('radio', { name: 'Englisch' })).toBeChecked();
    fireEvent.click(german);
    expect(await screen.findByText('Sprache gespeichert.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Deutsch' })).toBeChecked();
    const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')!;
    expect(String(put[0])).toContain('/notifications/locale');
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({ locale: 'de' });
  });

  it('shows an actionable error when loading fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ statusCode: 500, message: 'boom' }, 500)));
    withClient(<NotificationLanguage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The notification language could not be loaded.');
    expect(screen.getByRole('button', { name: /retry|try again/i })).toBeInTheDocument();
  });
});

describe('FocusedFinding (notification deep link target)', () => {
  it('renders the finding with severity as text and focuses its heading', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(FINDING_BODY)));
    withClient(<FocusedFinding projectId={PROJECT} findingId={FINDING} onClose={() => undefined} />);
    expect(await screen.findByText("Field 'TaxNumber' missing in runtime XML")).toBeInTheDocument();
    const heading = screen.getByRole('heading', { name: /Finding from your notification/ });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveTextContent(/Critical/i);
  });

  it('treats a finding of another project or a 404 as not found', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...FINDING_BODY, projectId: 'other' })));
    withClient(<FocusedFinding projectId={PROJECT} findingId={FINDING} onClose={() => undefined} />);
    expect(await screen.findByText('This finding no longer exists or you have no access to it.')).toBeInTheDocument();
  });

  it('offers an explicit organization switch when the link names another organization of the user', async () => {
    const ORG = '55555555-5555-4555-8555-555555555555';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).endsWith('/organizations')
          ? jsonResponse([{ id: ORG, name: 'Kunde Nord', role: 'MIGRATION_CONSULTANT', isHome: false }])
          : jsonResponse({ statusCode: 404, message: 'x' }, 404)
      )
    );
    withClient(<FocusedFinding projectId={PROJECT} findingId={FINDING} organizationId={ORG} onClose={() => undefined} />, 'de');
    expect(await screen.findByRole('button', { name: 'Zu Kunde Nord wechseln' })).toBeInTheDocument();
    expect(screen.getByText(/Dieser Befund gehört zur Organisation „Kunde Nord“/)).toBeInTheDocument();
  });

  it('closes via an explicit button (keyboard reachable)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ statusCode: 404, message: 'x' }, 404)));
    const onClose = vi.fn();
    withClient(<FocusedFinding projectId={PROJECT} findingId={FINDING} onClose={onClose} />, 'de');
    expect(await screen.findByText('Dieser Befund existiert nicht mehr oder Sie haben keinen Zugriff darauf.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Alle Befunde anzeigen' }));
    expect(onClose).toHaveBeenCalled();
  });
});
