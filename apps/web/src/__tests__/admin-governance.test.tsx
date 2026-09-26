import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '../test/render';
import {
  AiOverviewSchema,
  AiTaskFormSchema,
  RuleInventorySchema,
  SourcesOverviewSchema,
  aiTaskToForm,
} from '../lib/api/governance';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/sources', useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

// Shapes captured from the live API (stack ws4), trimmed.
const AI_TASK = {
  task: 'intent_classification',
  usedBy: 'Intent classification (POST /ai/classify-intent)',
  configured: true,
  config: {
    enabled: true, provider: 'OLLAMA_LOCAL', effectiveProvider: 'OLLAMA_LOCAL', primaryModel: 'stub-model', effectiveModel: 'stub-model',
    fallbackProvider: null, fallbackModel: null, maxTokens: 256, temperature: 0.1, privacyMode: 'SELF_HOSTED_ONLY',
    costCeilingEurMonthly: 0.5, inputPriceEurPer1k: 1, outputPriceEurPer1k: 1,
  },
  spend: { periodMonth: '2026-09', requests: 2, blockedRequests: 1, inputTokens: 240, outputTokens: 80, costEur: 0.32, byProvider: [] },
  ceilingReached: false,
  updatedAt: '2026-09-26T13:02:59.532Z',
};

const SOURCES = {
  checkedAt: '2026-09-26T13:03:47.064Z',
  knowledgeObjects: { total: 68627, published: 68627 },
  adapters: [
    {
      adapterId: 'SAP_CLOUDIFICATION_REPOSITORY', title: 'SAP Cloudification Repository', documents: [], retriable: true,
      settings: { critical: true, freshnessThresholdHours: 192, alertsEnabled: true, configured: false },
      lastRun: { id: 'r1', status: 'NOOP', trigger: 'ADMIN', triggeredBy: 'admin-retry:root@example.com', error: null, startedAt: '2026-09-26T13:03:58.000Z', finishedAt: '2026-09-26T13:04:10.000Z' },
      lastSuccessAt: '2026-09-26T13:04:10.000Z', freshness: 'FRESH', ageHours: 0,
      errors: { failedLast30Days: 0, lastFailedAt: null },
      items: { documents: 13, records: 341247, rejected: 0 },
      latestSnapshot: { id: 's1', seq: 1, publishedAt: '2026-09-26T13:03:22.809Z', stats: {}, changes: { statesAdded: 341247, statesChanged: 0, statesRemoved: 0, objectsCreated: 68627 } },
      openAlert: null,
    },
    {
      adapterId: 'ROSA_FILE_IMPORT', title: 'ROSA export (file import)', documents: [], retriable: false,
      settings: { critical: true, freshnessThresholdHours: 1, alertsEnabled: true, configured: true },
      lastRun: null, lastSuccessAt: null, freshness: 'NEVER_SYNCED', ageHours: null,
      errors: { failedLast30Days: 0, lastFailedAt: null }, items: { documents: 0, records: 0, rejected: 0 }, latestSnapshot: null,
      openAlert: {
        id: 'a1', adapterId: 'ROSA_FILE_IMPORT', alertType: 'STALE', status: 'OPEN', severity: 'CRITICAL', lastSuccessAt: null,
        thresholdHours: 1, ageHours: null, message: 'Critical knowledge source ROSA export has never completed a successful sync.',
        notifiedUsers: 1, openedAt: '2026-09-26T13:05:00.000Z', resolvedAt: null, resolvedReason: null,
      },
    },
  ],
  alerts: [],
};

describe('platform governance client contracts', () => {
  it('parses the AI overview and round-trips a task into the edit form', () => {
    const overview = AiOverviewSchema.parse({ defaultProvider: null, confidenceCap: 0.6, periodMonth: '2026-09', tasks: [AI_TASK], providers: [] });
    const form = aiTaskToForm(overview.tasks[0]);
    expect(form).toMatchObject({ provider: 'OLLAMA_LOCAL', temperature: '0.1', costCeilingEurMonthly: '0.5', privacyMode: 'SELF_HOSTED_ONLY' });
    expect(AiTaskFormSchema.safeParse(form).success).toBe(true);
  });

  it('rejects AI configurations the API would refuse', () => {
    const form = aiTaskToForm(AiOverviewSchema.parse({ defaultProvider: null, confidenceCap: 0.6, periodMonth: '2026-09', tasks: [AI_TASK], providers: [] }).tasks[0]);
    expect(AiTaskFormSchema.safeParse({ ...form, provider: 'OPENAI' }).success).toBe(false); // self-hosted only
    expect(AiTaskFormSchema.safeParse({ ...form, inputPriceEurPer1k: 0, outputPriceEurPer1k: 0 }).success).toBe(false); // ceiling needs prices
    expect(AiTaskFormSchema.safeParse({ ...form, temperature: '3' }).success).toBe(false);
    expect(AiTaskFormSchema.safeParse({ ...form, fallbackModel: 'x', fallbackProvider: '' }).success).toBe(false);
  });

  it('parses the source overview and rule inventory contracts', () => {
    expect(SourcesOverviewSchema.parse(SOURCES).adapters).toHaveLength(2);
    expect(() => RuleInventorySchema.parse({ manifestVersion: '1', goldenCases: 1, summary: {}, engines: [], items: [] })).toThrow();
  });
});

describe('Source Sync Admin UI', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/admin/sources')) return new Response(JSON.stringify(SOURCES), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response('{}', { status: 404 });
    });
  });

  it('shows freshness, criticality and the open stale alert with text and icons (not color alone)', async () => {
    const { SourceAdmin } = await import('../components/admin/governance/source-admin');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SourceAdmin />
      </QueryClientProvider>
    );
    const cr = await screen.findByRole('article', { name: 'SAP Cloudification Repository' });
    expect(within(cr).getByText('Fresh')).toBeInTheDocument();
    expect(within(cr).getByText('Critical source')).toBeInTheDocument();
    expect(within(cr).getByRole('button', { name: /Retry sync/ })).toBeEnabled();
    const rosa = screen.getByRole('article', { name: 'ROSA export (file import)' });
    expect(within(rosa).getByText('Never synced')).toBeInTheDocument();
    expect(within(rosa).getByText('Open')).toBeInTheDocument();
    expect(within(rosa).queryByRole('button', { name: /Retry sync/ })).toBeNull();
    expect(within(rosa).getByText(/upload a new export/)).toBeInTheDocument();
  });

  it('renders German labels', async () => {
    const { SourceAdmin } = await import('../components/admin/governance/source-admin');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SourceAdmin />
      </QueryClientProvider>,
      { locale: 'de' }
    );
    expect(await screen.findByRole('heading', { name: 'Quellen-Synchronisierung' })).toBeInTheDocument();
    expect(await screen.findByText('Nie synchronisiert')).toBeInTheDocument();
  });
});
