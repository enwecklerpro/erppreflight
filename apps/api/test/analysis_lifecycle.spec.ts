import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  decideCancel,
  decideFinalization,
  decideRerun,
  canControlAnalyses,
  LAB_RUN_STALE_MS,
} from '../src/modules/analyses/analysis-lifecycle.state';
import { AnalysisLifecycleService } from '../src/modules/analyses/analysis-lifecycle.service';
import { AnalysisExecutor } from '../src/modules/jobs/analysis-executor';
import { RunCancellation } from '../src/modules/jobs/run-cancellation';
import { JobsService } from '../src/modules/jobs/jobs.service';
import { applyTransition, initialProgressState } from '../src/modules/jobs/analysis-progress';
import { labRunStatus } from '../src/modules/lab/lab-analysis-recorder';
import { GeneratedTestsService, mapGeneratedTest } from '../src/modules/lab/generated-tests.service';
import { renderNotification } from '../src/modules/notifications/notification-renderer';

const ORG = 'b2222222-2222-4222-8222-222222222222';
const OTHER_ORG = 'b9999999-9999-4999-8999-999999999999';
const PROJ = 'c3333333-3333-4333-8333-333333333333';
const USER = 'd4444444-4444-4444-8444-444444444444';
const A1 = 'a1111111-1111-4111-8111-111111111111';
const FILE_A = 'f1111111-1111-4111-8111-111111111111';
const FILE_B = 'f2222222-2222-4222-8222-222222222222';
const SHA = 'a'.repeat(64);
const NOW = new Date('2026-09-26T12:00:00Z');
const OWNER = { id: USER, role: 'ORGANIZATION_OWNER', systemRole: null };

// ---------------------------------------------------------------------------------------------
// Pure state machine
// ---------------------------------------------------------------------------------------------

describe('analysis lifecycle state machine', () => {
  it('decideCancel: queued/running request, idempotent repeats, finished and publishing are rejected', () => {
    expect(decideCancel({ status: 'QUEUED', cancelRequestedAt: null, publishedAt: null })).toEqual({ kind: 'REQUEST' });
    expect(decideCancel({ status: 'RUNNING', cancelRequestedAt: null, publishedAt: null })).toEqual({ kind: 'REQUEST' });
    expect(decideCancel({ status: 'RUNNING', cancelRequestedAt: NOW, publishedAt: null })).toEqual({ kind: 'ALREADY_REQUESTED' });
    expect(decideCancel({ status: 'CANCELLED', cancelRequestedAt: NOW, publishedAt: null })).toEqual({ kind: 'ALREADY_CANCELLED' });
    for (const status of ['COMPLETED', 'PARTIAL', 'FAILED']) {
      expect(decideCancel({ status, cancelRequestedAt: null, publishedAt: NOW })).toEqual({ kind: 'REJECT_FINISHED', status });
    }
    expect(decideCancel({ status: 'RUNNING', cancelRequestedAt: null, publishedAt: NOW })).toEqual({ kind: 'REJECT_PUBLISHING' });
    expect(decideCancel({ status: 'WHATEVER', cancelRequestedAt: null, publishedAt: null }).kind).toBe('REJECT_FINISHED');
  });

  it('decideFinalization: queued runs end at once unless a worker holds the job; running runs are cooperative', () => {
    const base = { kind: 'STANDARD', lastActivityAt: NOW, now: NOW };
    expect(decideFinalization({ ...base, status: 'QUEUED', job: 'REMOVED' })).toBe('FINALIZE_NOW');
    expect(decideFinalization({ ...base, status: 'QUEUED', job: 'NOT_FOUND' })).toBe('FINALIZE_NOW');
    expect(decideFinalization({ ...base, status: 'QUEUED', job: 'NO_QUEUE' })).toBe('FINALIZE_NOW');
    expect(decideFinalization({ ...base, status: 'QUEUED', job: 'ACTIVE' })).toBe('COOPERATIVE');
    expect(decideFinalization({ ...base, status: 'RUNNING', job: 'ACTIVE' })).toBe('COOPERATIVE');
    expect(decideFinalization({ ...base, status: 'RUNNING', job: 'NO_QUEUE' })).toBe('COOPERATIVE');
    // The job is gone (finished in BullMQ, removed, scheduled-run container): nobody will finalise it.
    expect(decideFinalization({ ...base, status: 'RUNNING', job: 'FINISHED' })).toBe('FINALIZE_NOW');
    expect(decideFinalization({ ...base, status: 'RUNNING', job: 'NOT_FOUND' })).toBe('FINALIZE_NOW');
  });

  it('decideFinalization: Test Lab runs are cooperative while active and finalised when their request is gone', () => {
    const fresh = new Date(NOW.getTime() - 1000);
    const stale = new Date(NOW.getTime() - LAB_RUN_STALE_MS - 1);
    expect(decideFinalization({ status: 'RUNNING', kind: 'LAB_REGRESSION', job: null, lastActivityAt: fresh, now: NOW })).toBe('COOPERATIVE');
    expect(decideFinalization({ status: 'RUNNING', kind: 'LAB_SCENARIO', job: null, lastActivityAt: stale, now: NOW })).toBe('FINALIZE_NOW');
    expect(decideFinalization({ status: 'RUNNING', kind: 'LAB_REGRESSION', job: null, lastActivityAt: null, now: NOW })).toBe('FINALIZE_NOW');
  });

  it('decideRerun: only terminal runs (incl. CANCELLED and FAILED) can be re-run', () => {
    expect(decideRerun('QUEUED')).toEqual({ kind: 'REJECT_ACTIVE', status: 'QUEUED' });
    expect(decideRerun('RUNNING')).toEqual({ kind: 'REJECT_ACTIVE', status: 'RUNNING' });
    for (const s of ['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED']) expect(decideRerun(s)).toEqual({ kind: 'ALLOWED' });
  });

  it('canControlAnalyses: VIEWER and AUDITOR are read-only; super admins and API keys may control runs', () => {
    expect(canControlAnalyses('VIEWER')).toBe(false);
    expect(canControlAnalyses('AUDITOR')).toBe(false);
    expect(canControlAnalyses(null)).toBe(false);
    expect(canControlAnalyses('VIEWER', 'SUPER_ADMIN')).toBe(true);
    for (const r of ['ORGANIZATION_OWNER', 'SECURITY_ADMIN', 'LEAD_ARCHITECT', 'MIGRATION_CONSULTANT', 'API_CLIENT']) {
      expect(canControlAnalyses(r)).toBe(true);
    }
  });

  it('progress: a CANCELLED stage keeps the reached percentage and is not counted as finished', () => {
    let st = initialProgressState();
    st = applyTransition(st, 'UPLOAD_VALIDATED', 'COMPLETED', {}, NOW.toISOString());
    st = applyTransition(st, 'PARSING', 'COMPLETED', {}, NOW.toISOString());
    st = applyTransition(st, 'RUNNING_RULES', 'STARTED', { done: 1, total: 2 }, NOW.toISOString());
    const running = st.percent;
    st = applyTransition(st, 'RUNNING_RULES', 'CANCELLED', { reason: 'x' }, NOW.toISOString());
    expect(st.stages.RUNNING_RULES.state).toBe('CANCELLED');
    expect(st.percent).toBe(running);
    expect(st.stages.FINALIZING.state).toBe('PENDING');
  });

  it('Test Lab status: executed verdicts complete the run; errors make it partial or failed', () => {
    expect(labRunStatus({ total: 3, errored: 0 })).toBe('COMPLETED');
    expect(labRunStatus({ total: 3, errored: 1 })).toBe('PARTIAL');
    expect(labRunStatus({ total: 3, errored: 3 })).toBe('FAILED');
    expect(labRunStatus({ total: 0, errored: 0 })).toBe('COMPLETED');
  });

  it('notifications deep-link to the analysis detail page', () => {
    expect(renderNotification('analysis.completed', A1, { projectId: PROJ, status: 'COMPLETED' })?.link).toBe(`/projects/${PROJ}/analyses/${A1}`);
    expect(renderNotification('finding.critical', 'x', { projectId: PROJ, analysisId: A1, blockerCount: 1 })?.link).toBe(
      `/projects/${PROJ}/analyses/${A1}`
    );
  });
});

// ---------------------------------------------------------------------------------------------
// In-memory analyses table (tenant-scoped) for the service tests
// ---------------------------------------------------------------------------------------------

interface Row {
  [k: string]: any;
}

function makeDb(rows: Row[]) {
  const log: Array<{ text: string; params: any[] }> = [];
  const find = (org: string, id: string) => rows.find((r) => r.organization_id === org && r.id === id);
  const exec = async (text: string, params: any[] = []) => {
    log.push({ text, params });
    if (/FROM analyses a\s+JOIN projects p/.test(text)) {
      const r = find(params[0], params[1]);
      return { rows: r ? [{ ...r, project_name: 'P', findings_count: 0 }] : [] };
    }
    if (text.includes('FROM analyses WHERE id = $1 AND organization_id = $2 FOR UPDATE')) {
      const r = find(params[1], params[0]);
      return { rows: r ? [{ ...r }] : [] };
    }
    if (text.includes('SET cancel_requested_at = NOW()')) {
      const r = find(params[1], params[0])!;
      r.cancel_requested_at = NOW;
      r.cancel_requested_by = params[2];
      r.cancel_reason = params[3];
      return { rows: [{ cancel_requested_at: NOW }] };
    }
    if (text.includes("SET status = 'CANCELLED'")) {
      const r = find(params[1], params[0]);
      if (!r || !['QUEUED', 'RUNNING'].includes(r.status) || r.published_at) return { rows: [] };
      r.status = 'CANCELLED';
      r.cancelled_at = NOW;
      return { rows: [{ project_id: r.project_id, engine_types: r.engine_types, triggered_by: r.triggered_by }] };
    }
    if (text.includes('SELECT progress FROM analyses')) return { rows: [{ progress: {} }] };
    if (text.includes('SELECT knowledge_snapshot_id FROM analyses')) return { rows: [{ knowledge_snapshot_id: 'e1111111-1111-4111-8111-111111111111' }] };
    return { rows: [] };
  };
  const db: any = {
    query: vi.fn((text: string, params?: any[]) => exec(text, params)),
    withTenantTransaction: vi.fn(async (_t: string, cb: any) => cb({ query: (text: string, params?: any[]) => exec(text, params) })),
  };
  return { db, log };
}

function analysisRow(overrides: Row = {}): Row {
  return {
    id: A1,
    organization_id: ORG,
    project_id: PROJ,
    status: 'QUEUED',
    kind: 'STANDARD',
    engine_types: ['OPD_GUARD', 'FORM_DOCTOR'],
    target_release: 'S4H_2023',
    triggered_by: USER,
    created_at: NOW,
    started_at: null,
    completed_at: null,
    cancel_requested_at: null,
    published_at: null,
    progress: {},
    orchestration: {},
    inputs: {
      version: 1,
      files: [
        { fileId: FILE_A, fileName: 'opd.xml', artifactType: 'XML', sha256: SHA, sizeBytes: 10 },
        { fileId: FILE_B, fileName: 'form.xdp', artifactType: 'XDP', sha256: SHA, sizeBytes: 20 },
      ],
      requestedConfiguration: { strict: true },
      effectiveConfiguration: { strict: true, deterministicOnly: false, allowAiAssistance: true },
      assignmentMode: 'AUTO',
      assignments: [{ engine: 'OPD_GUARD', fileId: FILE_A, companions: [] }],
      stages: [['OPD_GUARD'], ['FORM_DOCTOR']],
      trigger: 'API',
    },
    knowledge_snapshot_id: null,
    ...overrides,
  };
}

function makeService(rows: Row[], job: string = 'REMOVED') {
  const { db, log } = makeDb(rows);
  const jobs = { rerunAnalysis: vi.fn(async () => ({ analysisId: 'a2222222-2222-4222-8222-222222222222', status: 'QUEUED', engineTypes: ['OPD_GUARD'], targetRelease: 'S4H_2023' })) };
  const jobControl = { removeQueuedJob: vi.fn(async () => job) };
  const regressionLab = { rerunLabAnalysis: vi.fn(async () => ({ analysisId: 'a3333333-3333-4333-8333-333333333333', status: 'COMPLETED', engineTypes: ['OPD_GUARD'], targetRelease: 'S4H_2023' })) };
  const audit = { recordSafe: vi.fn(async () => true) };
  const outbox = { recordEvent: vi.fn(async () => undefined) };
  const service = new AnalysisLifecycleService(
    db,
    jobs as any,
    jobControl as any,
    regressionLab as any,
    undefined,
    undefined,
    audit as any,
    outbox as any,
    undefined
  );
  return { service, db, log, jobs, jobControl, regressionLab, audit, outbox };
}

describe('AnalysisLifecycleService.cancel', () => {
  it('QUEUED: removes the BullMQ job and finalises CANCELLED at once (audit + outbox event)', async () => {
    const rows = [analysisRow()];
    const { service, jobControl, audit, outbox } = makeService(rows, 'REMOVED');
    const res = await service.cancel(ORG, OWNER, A1, { reason: 'wrong files' });
    expect(res.outcome).toBe('CANCELLED');
    expect(res.status).toBe('CANCELLED');
    expect(jobControl.removeQueuedJob).toHaveBeenCalledWith(A1);
    expect(rows[0].cancel_reason).toBe('wrong files');
    expect(rows[0].cancel_requested_by).toBe(USER);
    expect(audit.recordSafe).toHaveBeenCalledWith(expect.objectContaining({ action: 'analysis.cancelled', resourceId: A1 }));
    expect(outbox.recordEvent).toHaveBeenCalledWith(ORG, 'analysis.cancelled', 'ANALYSIS', A1, expect.objectContaining({ status: 'CANCELLED' }));
  });

  it('RUNNING with an active worker: records the request, stays RUNNING (cooperative) and signals local runs', async () => {
    const rows = [analysisRow({ status: 'RUNNING', started_at: NOW })];
    const { service } = makeService(rows, 'ACTIVE');
    const spy = vi.spyOn(RunCancellation, 'signalLocal');
    const res = await service.cancel(ORG, OWNER, A1, {});
    expect(res.outcome).toBe('CANCELLATION_REQUESTED');
    expect(res.status).toBe('RUNNING');
    expect(res.cancelRequestedAt).toBe(NOW.toISOString());
    expect(spy).toHaveBeenCalledWith(A1);
    // Idempotent repeat.
    const again = await service.cancel(ORG, OWNER, A1, {});
    expect(again.outcome).toBe('ALREADY_REQUESTED');
    expect(rows[0].status).toBe('RUNNING');
    spy.mockRestore();
  });

  it('is idempotent on a cancelled run and rejects finished / publishing runs with 409', async () => {
    const { service } = makeService([analysisRow({ status: 'CANCELLED', cancelled_at: NOW, cancel_requested_at: NOW })]);
    await expect(service.cancel(ORG, OWNER, A1, {})).resolves.toMatchObject({ outcome: 'ALREADY_CANCELLED', status: 'CANCELLED' });

    const done = makeService([analysisRow({ status: 'COMPLETED', published_at: NOW })]);
    await expect(done.service.cancel(ORG, OWNER, A1, {})).rejects.toBeInstanceOf(ConflictException);
    await expect(done.service.cancel(ORG, OWNER, A1, {})).rejects.toMatchObject({ response: { code: 'ANALYSIS_NOT_CANCELLABLE' } });

    const publishing = makeService([analysisRow({ status: 'RUNNING', published_at: NOW })]);
    await expect(publishing.service.cancel(ORG, OWNER, A1, {})).rejects.toMatchObject({ response: { code: 'ANALYSIS_FINALIZING' } });
  });

  it('is tenant-scoped: another organisation (or an unknown id) gets 404 and nothing changes', async () => {
    const rows = [analysisRow()];
    const { service, jobControl } = makeService(rows);
    await expect(service.cancel(OTHER_ORG, OWNER, A1, {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.cancel(ORG, OWNER, 'not-a-uuid', {})).rejects.toBeInstanceOf(NotFoundException);
    expect(rows[0].status).toBe('QUEUED');
    expect(rows[0].cancel_requested_at).toBeNull();
    expect(jobControl.removeQueuedJob).not.toHaveBeenCalled();
  });
});

describe('AnalysisLifecycleService.rerun', () => {
  it('re-runs with the identical recorded inputs and links the source', async () => {
    const { service, jobs } = makeService([analysisRow({ status: 'COMPLETED', knowledge_snapshot_id: 'e0000000-0000-4000-8000-000000000000' })]);
    const res = await service.rerun(ORG, OWNER, A1);
    expect(jobs.rerunAnalysis).toHaveBeenCalledWith(
      ORG,
      USER,
      expect.objectContaining({
        id: A1,
        projectId: PROJ,
        kind: 'STANDARD',
        engineTypes: ['OPD_GUARD', 'FORM_DOCTOR'],
        targetRelease: 'S4H_2023',
        fileIds: [FILE_A, FILE_B],
        requestedConfiguration: { strict: true },
        assignmentMode: 'AUTO',
        assignments: [{ engine: 'OPD_GUARD', fileId: FILE_A, companions: [] }],
        stages: [['OPD_GUARD'], ['FORM_DOCTOR']],
      })
    );
    expect(res.rerunOfAnalysisId).toBe(A1);
    expect(res.knowledgeSnapshotId).toBe('e1111111-1111-4111-8111-111111111111');
    expect(res.previousKnowledgeSnapshotId).toBe('e0000000-0000-4000-8000-000000000000');
  });

  it('refuses active runs (409) and recovers the artifacts of legacy runs from the orchestration record', async () => {
    const active = makeService([analysisRow({ status: 'RUNNING' })]);
    await expect(active.service.rerun(ORG, OWNER, A1)).rejects.toMatchObject({ response: { code: 'ANALYSIS_STILL_ACTIVE' } });

    const legacy = makeService([
      analysisRow({
        status: 'FAILED',
        inputs: {},
        orchestration: { calls: [{ engine: 'OPD_GUARD', fileId: FILE_B }, { engine: 'FORM_DOCTOR', fileId: FILE_B }] },
      }),
    ]);
    await legacy.service.rerun(ORG, OWNER, A1);
    expect(legacy.jobs.rerunAnalysis).toHaveBeenCalledWith(ORG, USER, expect.objectContaining({ fileIds: [FILE_B], assignmentMode: 'CROSS' }));
  });

  it('delegates Test Lab runs to the Test Lab with the same test cases', async () => {
    const tc = 'c9999999-9999-4999-8999-999999999999';
    const { service, regressionLab, jobs } = makeService([
      analysisRow({ status: 'COMPLETED', kind: 'LAB_REGRESSION', inputs: { version: 1, files: [], testCaseIds: [tc], trigger: 'BATCH' } }),
    ]);
    const res = await service.rerun(ORG, OWNER, A1);
    expect(regressionLab.rerunLabAnalysis).toHaveBeenCalledWith(ORG, OWNER, { id: A1, projectId: PROJ, testCaseIds: [tc], trigger: 'BATCH' });
    expect(jobs.rerunAnalysis).not.toHaveBeenCalled();
    expect(res.kind).toBe('LAB_REGRESSION');
  });

  it('is tenant-scoped (404 for another organisation)', async () => {
    const { service, jobs } = makeService([analysisRow({ status: 'COMPLETED' })]);
    await expect(service.rerun(OTHER_ORG, OWNER, A1)).rejects.toBeInstanceOf(NotFoundException);
    expect(jobs.rerunAnalysis).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// JobsService.rerunAnalysis: new record, inputs, snapshot, BullMQ job id
// ---------------------------------------------------------------------------------------------

describe('JobsService.rerunAnalysis', () => {
  function jobsDb(fileRows: any[]) {
    const queries: Array<{ text: string; params: any[] }> = [];
    const db: any = {
      query: vi.fn(async (text: string, params: any[] = []) => {
        queries.push({ text, params });
        if (text.includes('FROM uploaded_files') && text.includes('quarantine_status')) return { rows: fileRows };
        if (text.includes('checksum_sha256, file_size')) return { rows: fileRows.map((f) => ({ id: f.id, checksum_sha256: SHA, file_size: 5 })) };
        if (text.includes("FROM knowledge_snapshots WHERE status = 'PUBLISHED'")) return { rows: [{ id: 'e2222222-2222-4222-8222-222222222222' }] };
        return { rows: [] };
      }),
      withTenantTransaction: vi.fn(async (_t: string, cb: any) => cb({ query: vi.fn(async () => ({ rows: [] })) })),
    };
    return { db, queries };
  }
  const config: any = { get: () => 'http://analysis:8000' };
  const source = {
    id: A1,
    projectId: PROJ,
    kind: 'STANDARD' as const,
    engineTypes: ['OPD_GUARD' as const],
    targetRelease: 'S4H_2023' as const,
    fileIds: [FILE_A],
    requestedConfiguration: { strict: true },
    assignmentMode: 'CROSS' as const,
  };

  it('creates a new QUEUED analysis with rerun link, recorded inputs and knowledge snapshot; job id = analysis id', async () => {
    const { db, queries } = jobsDb([{ id: FILE_A, file_name: 'opd.xml', storage_path: 'k/opd.xml', quarantine_status: 'CLEAN', metadata: { detectedFormat: 'XML' } }]);
    const queue = { add: vi.fn(async () => ({})) };
    const svc = new JobsService(db, config, queue as any);
    const res = await svc.rerunAnalysis(ORG, USER, source);
    const insert = queries.find((q) => q.text.includes('INSERT INTO analyses'))!;
    expect(insert.text).toContain('rerun_of_analysis_id');
    expect(insert.params[8]).toBe(A1);
    expect(insert.params[7]).toBe('e2222222-2222-4222-8222-222222222222');
    const inputs = JSON.parse(insert.params[6]);
    expect(inputs).toMatchObject({ version: 1, trigger: 'RERUN', requestedConfiguration: { strict: true } });
    expect(inputs.files).toEqual([{ fileId: FILE_A, fileName: 'opd.xml', artifactType: 'XML', sha256: SHA, sizeBytes: 5 }]);
    expect(queue.add).toHaveBeenCalledWith('analyze', expect.objectContaining({ analysisId: res.analysisId }), expect.objectContaining({ jobId: res.analysisId }));
    expect(res.rerunOfAnalysisId).toBe(A1);
    expect(res.analysisId).not.toBe(A1);
  });

  it('refuses when an input artifact is no longer CLEAN / present (409 RERUN_INPUTS_UNAVAILABLE)', async () => {
    const gone = jobsDb([]);
    await expect(new JobsService(gone.db, config, { add: vi.fn() } as any).rerunAnalysis(ORG, USER, source)).rejects.toMatchObject({
      response: { code: 'RERUN_INPUTS_UNAVAILABLE' },
    });
    const quarantined = jobsDb([{ id: FILE_A, file_name: 'opd.xml', storage_path: 'k', quarantine_status: 'QUARANTINED', metadata: {} }]);
    await expect(new JobsService(quarantined.db, config, { add: vi.fn() } as any).rerunAnalysis(ORG, USER, source)).rejects.toBeInstanceOf(
      ConflictException
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Executor: cooperative cancellation, aborted engine call, publish gate
// ---------------------------------------------------------------------------------------------

describe('AnalysisExecutor cooperative cancellation', () => {
  const storage: any = { getCleanStream: vi.fn(async () => Readable.from([Buffer.from('<a/>')])) };
  const logger: any = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const finding = {
    id: 'e5555555-5555-4555-8555-555555555555',
    ruleId: 'R1',
    severity: 'MAJOR',
    category: 'Cat',
    title: 'T',
    description: 'D',
    confidence: 'VERIFIED',
    confidenceScore: 1,
    remediation: 'R',
    affectedObjects: [{ name: 'OBJ' }],
    evidence: [{ artifactPath: 'a.xml', lineNumber: 3, sha256: SHA }],
  };
  const ok = (engine: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ job_id: A1, engine_type: engine, status: 'COMPLETED', findings: [finding] }),
  });

  function execDb(state: { cancel: boolean; publishedAllowed?: boolean }) {
    const queries: Array<{ text: string; params: any[] }> = [];
    const tx: Array<{ text: string; params: any[] }> = [];
    const db: any = {
      query: vi.fn(async (text: string, params: any[] = []) => {
        queries.push({ text, params });
        if (text.includes('SELECT status, cancel_requested_at FROM analyses')) {
          return { rows: [{ status: 'RUNNING', cancel_requested_at: state.cancel ? NOW : null }] };
        }
        if (text.includes("SET status = 'RUNNING'")) return { rows: [{ created_at: NOW }] };
        if (text.includes('SET published_at = NOW()')) return { rows: state.cancel || state.publishedAllowed === false ? [] : [{ id: A1 }] };
        if (text.includes("SET status = 'CANCELLED'")) return { rows: [{ id: A1 }] };
        return { rows: [] };
      }),
      withTenantTransaction: vi.fn(async (_t: string, cb: any) =>
        cb({
          query: vi.fn(async (text: string, params: any[] = []) => {
            tx.push({ text, params });
            return { rows: [] };
          }),
        })
      ),
    };
    return { db, queries, tx };
  }

  const input = (cancellation: RunCancellation) => ({
    analysisId: A1,
    organizationId: ORG,
    projectId: PROJ,
    engineTypes: ['OPD_GUARD', 'FORM_DOCTOR'] as any,
    targetRelease: 'S4H_2023' as const,
    files: [{ fileId: FILE_A, fileName: 'a.xml', storagePath: 'k/a.xml', artifactType: 'XML' as const }],
    cancellation,
  });

  beforeEach(() => vi.clearAllMocks());

  it('a run cancelled while queued never calls an engine and ends CANCELLED', async () => {
    const state = { cancel: true };
    const { db, queries } = execDb(state);
    global.fetch = vi.fn() as any;
    const result = await new AnalysisExecutor(db, storage, 'http://py', logger).run(input(new RunCancellation(db, ORG, A1, logger, 0)));
    expect(result.finalStatus).toBe('CANCELLED');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(queries.some((q) => q.text.includes("SET status = 'CANCELLED'"))).toBe(true);
    expect(queries.some((q) => q.text.includes("SET status = 'RUNNING'"))).toBe(false);
  });

  it('stops between engine steps and discards (never publishes) the findings already reported', async () => {
    const state = { cancel: false };
    const { db, queries, tx } = execDb(state);
    global.fetch = vi.fn(async (_url: string, init: any) => {
      const engine = JSON.parse(init.body).engine_type;
      // The user cancels while the first engine runs.
      state.cancel = true;
      RunCancellation.signalLocal(A1);
      return ok(engine);
    }) as any;
    const cancellation = new RunCancellation(db, ORG, A1, logger, 0);
    const result = await new AnalysisExecutor(db, storage, 'http://py', logger).run(input(cancellation));
    expect(result.finalStatus).toBe('CANCELLED');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.discardedFindings).toBe(1); // reported by the call that was running, never published
    expect(tx.some((q) => q.text.includes('INSERT INTO findings'))).toBe(false);
    expect(queries.some((q) => q.text.includes('SET published_at = NOW()'))).toBe(false);
    expect(queries.some((q) => q.text.includes('UPDATE analyses SET status = $1'))).toBe(false);
  });

  it('aborts the in-flight analysis-service call through the abort signal', async () => {
    const state = { cancel: false };
    const { db } = execDb(state);
    let seenSignal: AbortSignal | undefined;
    global.fetch = vi.fn(
      (_url: string, init: any) =>
        new Promise((_resolve, reject) => {
          seenSignal = init.signal;
          init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          setTimeout(() => {
            state.cancel = true;
            RunCancellation.signalLocal(A1);
          }, 5);
        })
    ) as any;
    const result = await new AnalysisExecutor(db, storage, 'http://py', logger).run(input(new RunCancellation(db, ORG, A1, logger, 0)));
    expect(seenSignal?.aborted).toBe(true);
    expect(result.finalStatus).toBe('CANCELLED');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('a cancellation that arrives after the last engine call loses nothing: the publish gate rejects it', async () => {
    const state = { cancel: false };
    const { db, tx } = execDb(state);
    let calls = 0;
    global.fetch = vi.fn(async (_url: string, init: any) => {
      calls++;
      if (calls === 2) state.cancel = true; // request lands after the final engine step, before the gate
      return ok(JSON.parse(init.body).engine_type);
    }) as any;
    const result = await new AnalysisExecutor(db, storage, 'http://py', logger).run(input(new RunCancellation(db, ORG, A1, logger, 0)));
    expect(result.finalStatus).toBe('CANCELLED');
    expect(result.discardedFindings).toBe(2);
    expect(tx.some((q) => q.text.includes('INSERT INTO findings'))).toBe(false);
  });

  it('without a cancellation the findings are published in deterministic work-unit order after the gate', async () => {
    const state = { cancel: false };
    const { db, queries, tx } = execDb(state);
    global.fetch = vi.fn(async (_url: string, init: any) => ok(JSON.parse(init.body).engine_type)) as any;
    const result = await new AnalysisExecutor(db, storage, 'http://py', logger).run(input(new RunCancellation(db, ORG, A1, logger, 0)));
    expect(result.finalStatus).toBe('COMPLETED');
    expect(result.totalFindings).toBe(2);
    const gateIdx = queries.findIndex((q) => q.text.includes('SET published_at = NOW()'));
    expect(gateIdx).toBeGreaterThan(-1);
    const inserts = tx.filter((q) => q.text.includes('INSERT INTO findings'));
    expect(inserts.map((q) => q.params[4])).toEqual(['OPD_GUARD', 'FORM_DOCTOR']);
    const final = queries.find((q) => q.text.includes('UPDATE analyses SET status = $1'))!;
    expect(final.text).toContain("status <> 'CANCELLED'");
  });
});

// ---------------------------------------------------------------------------------------------
// Generated tests ↔ Test Lab
// ---------------------------------------------------------------------------------------------

describe('GeneratedTestsService (generated tests → Test Lab regression cases)', () => {
  const GT = 'a7777777-7777-4777-8777-777777777777';
  const CASE = 'a8888888-8888-4888-8888-888888888888';
  const FINDING = 'a9999999-9999-4999-8999-999999999999';

  function svc(testRow: any) {
    const tx: Array<{ text: string; params: any[] }> = [];
    const client = {
      query: vi.fn(async (text: string, params: any[] = []) => {
        tx.push({ text, params });
        if (text.includes('FROM tests WHERE id = $1')) return { rows: testRow ? [testRow] : [] };
        return { rows: [] };
      }),
    };
    const db: any = { query: vi.fn(async () => ({ rows: [] })), withTenantTransaction: vi.fn(async (_t: string, cb: any) => cb(client)) };
    const lab = { createFromFinding: vi.fn(async () => ({ id: CASE })) };
    return { service: new GeneratedTestsService(db, lab as any), lab, tx };
  }

  it('promotes a generated test into a regression case exactly once (idempotent) and links both rows', async () => {
    const a = svc({ id: GT, finding_id: FINDING, title: 'Regression: R1 on OBJ', regression_test_case_id: null });
    const res = await a.service.promote(ORG, OWNER, GT, {});
    expect(res).toEqual({ generatedTestId: GT, regressionTestCaseId: CASE, created: true });
    expect(a.lab.createFromFinding).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      OWNER,
      { findingId: FINDING, expectedOutcome: 'FINDING_ABSENT', title: 'Regression: R1 on OBJ' },
      GT
    );
    const upd = a.tx.find((q) => q.text.includes('UPDATE tests SET regression_test_case_id'))!;
    expect(upd.params).toEqual([GT, ORG, CASE, USER]);

    const b = svc({ id: GT, finding_id: FINDING, title: 'x', regression_test_case_id: CASE });
    await expect(b.service.promote(ORG, OWNER, GT, {})).resolves.toEqual({ generatedTestId: GT, regressionTestCaseId: CASE, created: false });
    expect(b.lab.createFromFinding).not.toHaveBeenCalled();
  });

  it('rejects VIEWER, unknown ids and tests whose finding is gone', async () => {
    const a = svc({ id: GT, finding_id: FINDING, title: 'x', regression_test_case_id: null });
    await expect(a.service.promote(ORG, { id: USER, role: 'VIEWER', systemRole: null }, GT, {})).rejects.toMatchObject({ status: 403 });
    await expect(svc(null).service.promote(ORG, OWNER, GT, {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc({ id: GT, finding_id: null, title: 'x', regression_test_case_id: null }).service.promote(ORG, OWNER, GT, {})).rejects.toMatchObject({
      response: { code: 'GENERATED_TEST_NOT_PROMOTABLE' },
    });
  });

  it('maps rows with promotion state and promotability', () => {
    const base = {
      id: GT,
      project_id: PROJ,
      analysis_id: A1,
      finding_id: FINDING,
      title: 't',
      test_type: 'REGRESSION',
      steps: JSON.stringify([{ order: 1, action: 'Open a.xml' }]),
      expected_result: 'gone',
      status: 'PENDING',
      created_at: NOW,
      finding_source_file_id: FILE_A,
      source_file_status: 'CLEAN',
    };
    const m = mapGeneratedTest(base);
    expect(m.promotable).toBe(true);
    expect(m.promotion).toBeNull();
    expect(m.steps).toEqual([{ order: 1, action: 'Open a.xml' }]);
    const p = mapGeneratedTest({ ...base, regression_test_case_id: CASE, last_run_status: 'PASSED', source_file_status: null });
    expect(p.promotion).toMatchObject({ regressionTestCaseId: CASE, lastRunStatus: 'PASSED' });
    expect(p.promotable).toBe(false);
  });
});
