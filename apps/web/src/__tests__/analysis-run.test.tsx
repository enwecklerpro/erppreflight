import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/projects/p/analyses/a',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

import { AnalysisDetailSchema, type AnalysisDetail } from '@erppreflight/schemas';
import { I18nProvider } from '../i18n/client';
import { RunStatusBadge, CallOutcome, LabVerdict } from '../components/analysis-run/run-status';
import { RunActions } from '../components/analysis-run/run-actions';
import { AnalysisRunDetail } from '../components/analysis-run/analysis-run-detail';
import { RunHistoryRowExtras } from '../components/analysis-run/run-links';
import { ProgressStepperView } from '../components/analysis/analysis-progress-stepper';

const PROJECT = 'c3333333-3333-4333-8333-333333333333';
const RUN = 'a1111111-1111-4111-8111-111111111111';
const PARENT = 'a0000000-0000-4000-8000-000000000000';
const SHA = 'b'.repeat(64);

function detailFixture(overrides: Partial<AnalysisDetail['analysis']> = {}, extra: Partial<AnalysisDetail> = {}): AnalysisDetail {
  return AnalysisDetailSchema.parse({
    analysis: {
      id: RUN,
      projectId: PROJECT,
      projectName: 'S/4 Migration',
      status: 'COMPLETED',
      kind: 'STANDARD',
      engineTypes: ['OPD_GUARD', 'FORM_DOCTOR'],
      targetRelease: 'S4H_2023',
      findingsCount: 0,
      isBaseline: false,
      problemStatement: null,
      routingId: null,
      triggeredBy: { id: 'd4444444-4444-4444-8444-444444444444', name: 'Ada', email: 'ada@example.test' },
      createdAt: '2026-09-26T10:00:00.000Z',
      startedAt: '2026-09-26T10:00:01.000Z',
      completedAt: '2026-09-26T10:00:05.000Z',
      durationMs: 4000,
      currentStage: 'FINALIZING',
      progressPercent: 100,
      errorMessage: null,
      ...overrides,
    },
    cancellation: null,
    lineage: { rerunOf: { id: PARENT, status: 'CANCELLED', createdAt: '2026-09-26T09:00:00.000Z' }, reruns: [] },
    knowledgeSnapshot: {
      id: 'e1111111-1111-4111-8111-111111111111',
      seq: 7,
      adapterId: 'sap-cloudification',
      status: 'PUBLISHED',
      publishedAt: '2026-09-20T00:00:00.000Z',
      contentSha256: 'c'.repeat(64),
      superseded: true,
    },
    inputs: {
      recorded: true,
      assignmentMode: 'CROSS',
      files: [{ fileId: 'f1111111-1111-4111-8111-111111111111', fileName: 'opd.json', artifactType: 'JSON', sha256: SHA, sizeBytes: 2048, currentStatus: 'CLEAN', changed: false }],
      requestedConfiguration: { strict: true },
      effectiveConfiguration: { strict: true, deterministicOnly: false },
      assignments: [],
      stages: [],
      testCaseIds: [],
    },
    telemetry: { engineCalls: 2, completedCalls: 1, partialCalls: 0, failedCalls: 1, rulesEvaluated: 17, totalEngineMs: 120, queueWaitMs: 1000 },
    calls: [
      { engine: 'OPD_GUARD', fileId: 'f1111111-1111-4111-8111-111111111111', fileName: 'opd.json', outcome: 'COMPLETED', findings: 0, rulesEvaluated: 17, durationMs: 80, engineVersion: '2.1.0', error: null },
      { engine: 'FORM_DOCTOR', fileId: 'f1111111-1111-4111-8111-111111111111', fileName: 'opd.json', outcome: 'FAILED', findings: 0, rulesEvaluated: 0, durationMs: 40, engineVersion: null, error: 'JSON not accepted' },
    ],
    summary: null,
    plan: null,
    lab: null,
    labResults: [],
    generatedTests: { total: 0, promoted: 0 },
    permissions: { canCancel: false, canRerun: true, canExport: true },
    ...extra,
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderWith(ui: React.ReactElement, locale: 'en' | 'de' = 'en') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale={locale}>{ui}</I18nProvider>
    </QueryClientProvider>
  );
}

let fetchMock: ReturnType<typeof vi.fn>;
let routes: Array<[RegExp, (init?: RequestInit) => Response]>;
beforeEach(() => {
  push.mockReset();
  routes = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    for (const [re, handler] of routes) if (re.test(u)) return handler(init);
    return jsonResponse({ message: 'not mocked ' + u }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('run status badges (text + icon, never colour alone)', () => {
  it('labels every status in English and German, and shows "Cancelling" for a pending cancellation', () => {
    const { rerender } = renderWith(
      <>
        <RunStatusBadge status="COMPLETED" testId="s1" />
        <RunStatusBadge status="CANCELLED" testId="s2" />
        <RunStatusBadge status="RUNNING" cancelRequested testId="s3" />
        <CallOutcome outcome="PARTIAL" />
        <LabVerdict status="ERROR" />
      </>
    );
    expect(screen.getByTestId('s1').textContent).toBe('Completed');
    expect(screen.getByTestId('s2').textContent).toBe('Cancelled');
    expect(screen.getByTestId('s3').textContent).toBe('Cancelling…');
    expect(screen.getByTestId('s1').querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Partial')).toBeTruthy();
    expect(screen.getByText('Error')).toBeTruthy();
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <I18nProvider locale="de">
          <RunStatusBadge status="CANCELLED" testId="s4" />
        </I18nProvider>
      </QueryClientProvider>
    );
    expect(screen.getByTestId('s4').textContent).toBe('Abgebrochen');
  });

  it('run history row: Test Lab badge, re-run marker and a details link to the detail page', () => {
    renderWith(<RunHistoryRowExtras projectId={PROJECT} run={{ id: RUN, kind: 'LAB_REGRESSION', rerunOfAnalysisId: PARENT }} />);
    expect(screen.getByTestId(`run-kind-${RUN}`).textContent).toContain('Test Lab');
    expect(screen.getByText('Re-run')).toBeTruthy();
    expect(screen.getByTestId(`run-detail-link-${RUN}`).getAttribute('href')).toBe(`/projects/${PROJECT}/analyses/${RUN}`);
  });
});

describe('progress stepper: cancelled stage', () => {
  it('shows the CANCELLED state with icon + text and translates coded server reasons', () => {
    renderWith(
      <ProgressStepperView
        progress={{
          analysisId: RUN,
          status: 'CANCELLED',
          kind: 'STANDARD',
          currentStage: 'RUNNING_RULES',
          percent: 38,
          terminal: true,
          updatedAt: null,
          stages: {
            UPLOAD_VALIDATED: { state: 'COMPLETED' },
            PARSING: { state: 'COMPLETED' },
            RUNNING_RULES: { state: 'CANCELLED', detail: { reason: 'Cancelled on request; 2 finding(s)…', code: 'CANCELLED', discardedFindings: 2 } },
            MATCHING_EVIDENCE: { state: 'PENDING' },
            GENERATING_TESTS: { state: 'PENDING' },
            FINALIZING: { state: 'PENDING' },
          },
        }}
      />,
      'de'
    );
    const item = screen.getAllByRole('listitem')[2];
    expect(item.getAttribute('data-state')).toBe('CANCELLED');
    expect(within(item).getByText('Abgebrochen')).toBeTruthy();
    expect(within(item).getByText(/2 vor dem Abbruch gemeldete Befunde wurden verworfen/)).toBeTruthy();
    expect(item.querySelector('svg')).not.toBeNull();
  });
});

describe('RunActions', () => {
  it('cancels a queued run through the confirm dialog with an optional reason', async () => {
    let body: any = null;
    routes.push([
      /\/analyses\/[^/]+\/cancel$/,
      (init) => {
        body = JSON.parse(String(init?.body));
        return jsonResponse({ analysisId: RUN, outcome: 'CANCELLED', status: 'CANCELLED', cancelRequestedAt: '2026-09-26T10:00:00.000Z', cancelledAt: '2026-09-26T10:00:00.000Z' });
      },
    ]);
    const onMessage = vi.fn();
    const detail = detailFixture({ status: 'QUEUED', completedAt: null, durationMs: null }, { permissions: { canCancel: true, canRerun: false, canExport: false } });
    renderWith(<RunActions detail={detail} onMessage={onMessage} />);
    expect(screen.queryByTestId('analysis-rerun')).toBeNull();
    fireEvent.click(screen.getByTestId('analysis-cancel'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/removed from the queue/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Wrong file' } });
    fireEvent.click(within(dialog).getByTestId('analysis-cancel-confirm'));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith({ tone: 'info', text: 'The run was cancelled.' }));
    expect(body).toEqual({ reason: 'Wrong file' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('re-runs after confirmation and navigates to the new run', async () => {
    const NEW = 'a2222222-2222-4222-8222-222222222222';
    routes.push([
      /\/analyses\/[^/]+\/rerun$/,
      () =>
        jsonResponse({
          analysisId: NEW,
          status: 'QUEUED',
          kind: 'STANDARD',
          engineTypes: ['OPD_GUARD'],
          targetRelease: 'S4H_2023',
          rerunOfAnalysisId: RUN,
          knowledgeSnapshotId: null,
          previousKnowledgeSnapshotId: null,
        }, 202),
    ]);
    renderWith(<RunActions detail={detailFixture()} onMessage={vi.fn()} />);
    expect(screen.queryByTestId('analysis-cancel')).toBeNull();
    fireEvent.click(screen.getByTestId('analysis-rerun'));
    expect(within(screen.getByRole('dialog')).getByText(/same 1 artifact, 2 engines/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('analysis-rerun-confirm'));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/projects/${PROJECT}/analyses/${NEW}`));
  });

  it('shows the API error when the plan limit blocks a re-run', async () => {
    routes.push([/\/rerun$/, () => jsonResponse({ statusCode: 402, message: 'Plan limit reached: analysesPerMonth', code: 'PLAN_LIMIT_EXCEEDED' }, 402)]);
    const onMessage = vi.fn();
    renderWith(<RunActions detail={detailFixture()} onMessage={onMessage} />);
    fireEvent.click(screen.getByTestId('analysis-rerun'));
    fireEvent.click(screen.getByTestId('analysis-rerun-confirm'));
    await waitFor(() => expect(onMessage).toHaveBeenCalled());
    expect(onMessage.mock.calls[0][0].tone).toBe('error');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('AnalysisRunDetail', () => {
  function mockRun(detail: AnalysisDetail, findings: unknown[] = []) {
    routes.push([/\/analyses\/[^/]+\/detail$/, () => jsonResponse(detail)]);
    routes.push([/\/analyses\/[^/]+\/findings$/, () => jsonResponse(findings)]);
    routes.push([/\/analyses\/[^/]+\/events$/, () => new Response('', { status: 503 })]);
    routes.push([
      /\/analyses\/[^/]+\/progress$/,
      () =>
        jsonResponse({
          analysisId: RUN,
          status: detail.analysis.status,
          kind: detail.analysis.kind,
          currentStage: 'FINALIZING',
          percent: 100,
          terminal: true,
          updatedAt: null,
          stages: {},
        }),
    ]);
    routes.push([/\/lab\/generated-tests/, () => jsonResponse({ items: [] })]);
    routes.push([/\/reports|\/exports/, () => jsonResponse([])]);
  }

  it('renders inputs with SHA-256, knowledge snapshot, engine calls, lineage and the findings empty state', async () => {
    mockRun(detailFixture());
    renderWith(<AnalysisRunDetail projectId={PROJECT} analysisId={RUN} />);
    await screen.findByTestId('analysis-detail');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Analysis run');
    expect(screen.getByTestId('analysis-status').textContent).toBe('Completed');
    expect(screen.getByTestId('analysis-input-sha').getAttribute('title')).toBe(SHA);
    expect(screen.getAllByTestId('analysis-call-row')).toHaveLength(2);
    expect(screen.getByText('JSON not accepted')).toBeTruthy();
    expect(screen.getByTestId('analysis-rerun-of').getAttribute('href')).toBe(`/projects/${PROJECT}/analyses/${PARENT}`);
    expect(screen.getByText(/newer knowledge snapshot/)).toBeTruthy();
    expect(await screen.findByText('No findings in this run')).toBeTruthy();
    expect(screen.getByTestId('analysis-rerun')).toBeTruthy();
  });

  it('explains a cancelled run: reason, discarded findings, no published findings', async () => {
    mockRun(
      detailFixture(
        { status: 'CANCELLED', progressPercent: 40 },
        {
          cancellation: {
            requestedAt: '2026-09-26T10:00:02.000Z',
            requestedBy: { id: 'd4444444-4444-4444-8444-444444444444', name: 'Ada', email: null },
            reason: 'Wrong artifact',
            cancelledAt: '2026-09-26T10:00:03.000Z',
            discardedFindings: 3,
          },
          permissions: { canCancel: false, canRerun: true, canExport: false },
        }
      )
    );
    renderWith(<AnalysisRunDetail projectId={PROJECT} analysisId={RUN} />);
    const banner = await screen.findByTestId('analysis-cancelled-banner');
    expect(banner.textContent).toContain('by Ada');
    expect(banner.textContent).toContain('Reason: Wrong artifact');
    expect(banner.textContent).toContain('3 findings reported before the stop were discarded');
    expect(await screen.findByText('No findings published')).toBeTruthy();
    expect(screen.getByText(/Reports are available for completed/)).toBeTruthy();
  });

  it('shows Test Lab results instead of findings for lab runs (German)', async () => {
    mockRun(
      detailFixture(
        { kind: 'LAB_REGRESSION' },
        {
          lab: { type: 'REGRESSION', trigger: 'BATCH', batchId: null, total: 1, passed: 0, failed: 1, errored: 0 },
          labResults: [
            {
              runId: 'a3333333-3333-4333-8333-333333333333',
              testCaseId: 'a4444444-4444-4444-8444-444444444444',
              title: 'Fix verification: OPD_RULE on PO',
              engine: 'OPD_GUARD',
              ruleId: 'OPD_RULE',
              expectedOutcome: 'FINDING_ABSENT',
              status: 'FAILED',
              findingPresent: true,
              artifactSha256: SHA,
              engineVersion: '2.1.0',
              executionTimeMs: 50,
              errorMessage: null,
              baselineVerdict: null,
            },
          ],
          permissions: { canCancel: false, canRerun: true, canExport: false },
        }
      )
    );
    renderWith(<AnalysisRunDetail projectId={PROJECT} analysisId={RUN} />, 'de');
    await screen.findByTestId('analysis-lab-results');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Testlabor-Lauf');
    const row = screen.getByTestId('analysis-lab-row');
    expect(within(row).getByText('Nicht bestanden')).toBeTruthy();
    expect(within(row).getByText('Befund vorhanden')).toBeTruthy();
    expect(screen.queryByTestId('analysis-findings-section')).toBeNull();
  });

  it('renders a not-found state for unknown or foreign runs and when the run belongs to another project', async () => {
    routes.push([/\/detail$/, () => jsonResponse({ statusCode: 404, message: 'not found' }, 404)]);
    renderWith(<AnalysisRunDetail projectId={PROJECT} analysisId={RUN} />);
    expect(await screen.findByTestId('analysis-not-found')).toBeTruthy();
  });

  it('renders a retryable error state for server errors', async () => {
    routes.push([/\/detail$/, () => jsonResponse({ statusCode: 500, message: 'boom' }, 500)]);
    renderWith(<AnalysisRunDetail projectId={PROJECT} analysisId={RUN} />);
    // Server errors are retried twice (1 s + 2 s back-off) before the error state appears.
    expect(await screen.findByText('The analysis run could not be loaded.', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Try again|Retry/ })).toBeTruthy();
  }, 15000);
});
