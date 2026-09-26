import { describe, it, expect, vi } from 'vitest';
import { lastValueFrom, of, throwError } from 'rxjs';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { computeAuditChainHash } from '@erppreflight/evidence';
import { AuditInterceptor } from '../src/modules/audit/audit.interceptor';
import { AUDITED_KEY, AuditSpec } from '../src/modules/audit/audited.decorator';
import { AuditService } from '../src/modules/audit/audit.service';
import { UsageInterceptor } from '../src/modules/usage/usage.interceptor';
import { METERED_KEY } from '../src/modules/usage/metered.decorator';
import { evaluateFlag, rolloutBucket } from '../src/modules/feature-flags/feature-flags.service';
import { selectFindingsForReport } from '../src/modules/export/export.service';
import { RetentionService } from '../src/modules/retention/retention.service';
import { SupportService } from '../src/modules/support/support.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const TARGET = '33333333-3333-4333-8333-333333333333';

function httpContext(request: any, meta: Record<string, unknown>) {
  const handler = () => undefined;
  for (const [k, v] of Object.entries(meta)) Reflect.defineMetadata(k, v, handler);
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

const reflector: any = { get: (key: string, target: any) => Reflect.getMetadata(key, target) };

describe('AuditInterceptor (business-event audit trail)', () => {
  const spec: AuditSpec = {
    action: 'project.created',
    targetType: 'PROJECT',
    targetId: ({ result }) => result.id,
    payload: ({ result }) => ({ name: result.name }),
  };
  const request = { tenantId: ORG, user: { id: USER, role: 'ORGANIZATION_OWNER' }, headers: { 'user-agent': 'vitest' }, ip: '::ffff:10.0.0.1', params: {}, body: { secret: 'never-audited' } };

  it('records the event with target, actor, IP and an explicit payload only', async () => {
    const audit: any = { recordEvent: vi.fn().mockResolvedValue({}) };
    const out = await lastValueFrom(
      new AuditInterceptor(reflector, audit).intercept(httpContext(request, { [AUDITED_KEY]: spec }), { handle: () => of({ id: TARGET, name: 'P' }) })
    );
    expect(out).toEqual({ id: TARGET, name: 'P' });
    const call = audit.recordEvent.mock.calls[0][0];
    expect(call).toMatchObject({ organizationId: ORG, action: 'project.created', resourceType: 'PROJECT', resourceId: TARGET, actorId: USER, actorType: 'HUMAN', clientIp: '10.0.0.1' });
    expect(call.payload).toEqual({ name: 'P', outcome: 'SUCCESS' });
    expect(JSON.stringify(call)).not.toContain('never-audited');
  });

  it('is fail-closed for security events (503, response withheld) and fail-open otherwise', async () => {
    const audit: any = { recordEvent: vi.fn().mockRejectedValue(new Error('db down')) };
    const sec = new AuditInterceptor(reflector, audit).intercept(httpContext(request, { [AUDITED_KEY]: { ...spec, security: true } }), {
      handle: () => of({ id: TARGET, name: 'P', accessToken: 'tok' }),
    });
    await expect(lastValueFrom(sec)).rejects.toBeInstanceOf(ServiceUnavailableException);
    const ops = new AuditInterceptor(reflector, audit).intercept(httpContext(request, { [AUDITED_KEY]: spec }), { handle: () => of({ id: TARGET, name: 'P' }) });
    await expect(lastValueFrom(ops)).resolves.toMatchObject({ id: TARGET });
  });

  it('records failed logins in the account tenant ledger and rethrows the original error', async () => {
    const audit: any = {
      recordEvent: vi.fn().mockResolvedValue({}),
      resolveAccountForEmail: vi.fn().mockResolvedValue({ userId: USER, organizationId: ORG }),
    };
    const loginReq = { headers: {}, params: {}, body: { email: 'Alice@Example.com', password: 'x' } };
    const obs = new AuditInterceptor(reflector, audit).intercept(
      httpContext(loginReq, { [AUDITED_KEY]: { action: 'auth.login.succeeded', targetType: 'USER', security: true, failureAction: 'auth.login.failed', failureTenant: 'loginEmail' } }),
      { handle: () => throwError(() => new UnauthorizedException('Invalid email or password')) }
    );
    await expect(lastValueFrom(obs)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(audit.resolveAccountForEmail).toHaveBeenCalledWith('alice@example.com');
    const call = audit.recordEvent.mock.calls[0][0];
    expect(call).toMatchObject({ organizationId: ORG, action: 'auth.login.failed', actorId: USER });
    expect(call.payload).toMatchObject({ outcome: 'FAILURE', httpStatus: 401, email: 'alice@example.com' });
    expect(JSON.stringify(call)).not.toContain('"password"');
  });
});

describe('UsageInterceptor (metering)', () => {
  it('records metered quantities after success and skips zero quantities', async () => {
    const usage: any = { recordSafe: vi.fn().mockResolvedValue(true) };
    const meta = {
      [METERED_KEY]: [
        { metric: 'ARTIFACT_UPLOAD', quantity: ({ result }: any) => (result.status === 'CLEAN' ? 1 : 0) },
        { metric: 'ARTIFACT_BYTES', quantity: () => 0 },
      ],
    };
    await lastValueFrom(
      new UsageInterceptor(reflector, usage).intercept(httpContext({ tenantId: ORG, user: { id: USER } }, meta), { handle: () => of({ status: 'CLEAN' }) })
    );
    expect(usage.recordSafe).toHaveBeenCalledTimes(1);
    expect(usage.recordSafe).toHaveBeenCalledWith(ORG, 'ARTIFACT_UPLOAD', 1, expect.objectContaining({ actorId: USER }));
  });
});

describe('Audit chain verification with per-tenant chain_seq', () => {
  const svc = new AuditService({} as any);
  const genesis = AuditService.GENESIS_PREV_HASH;
  const mk = (seq: number, prev: string, globalSeq: number, extra: Record<string, unknown> = {}) => {
    const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
    const t = `2026-09-26T00:00:0${seq}.000Z`;
    const payload = { _ref: { targetType: 'PROJECT', targetId: null, actorType: 'SYSTEM', actorId: null } };
    const h = computeAuditChainHash(prev, id, ORG, `A${seq}`, t, payload);
    return { id, organization_id: ORG, action: `A${seq}`, created_at: t, payload, prev_hash: prev, current_hash: h, sequence_num: seq, global_sequence_num: globalSeq, target_type: 'PROJECT', target_id: null, actor_id: null, ...extra };
  };
  it('accepts a contiguous tenant chain even when the global sequence has gaps', () => {
    const a = mk(1, genesis, 10);
    const b = mk(2, a.current_hash, 57);
    expect(svc.verifyChain([a, b]).isValid).toBe(true);
  });
  it('detects tampering with indexed target/actor columns', () => {
    const a = mk(1, genesis, 1, { target_type: 'REPORT' });
    const res = svc.verifyChain([a]);
    expect(res.isValid).toBe(false);
    expect(res.anomalies[0].anomalyType).toBe('CORRUPTED_PAYLOAD');
  });
});

describe('Feature flag evaluation', () => {
  const base = {
    key: 'beta.graph',
    description: '',
    enabled: true,
    environments: [] as any[],
    planTiers: [] as any[],
    allowOrganizations: [] as string[],
    denyOrganizations: [] as string[],
    rolloutPercentage: 100,
    betaOnly: false,
    updatedBy: null,
    updatedAt: new Date().toISOString(),
  };
  const ctx = { environment: 'production', organizationId: ORG, userId: USER, planTier: 'FREE' as const };
  it('applies kill switch, environment, deny/allow, plan, beta and rollout in order', () => {
    expect(evaluateFlag({ ...base, enabled: false }, ctx).reason).toBe('KILL_SWITCH_OFF');
    expect(evaluateFlag({ ...base, environments: ['development'] }, ctx).reason).toBe('ENVIRONMENT_EXCLUDED');
    expect(evaluateFlag({ ...base, denyOrganizations: [ORG], allowOrganizations: [ORG] }, ctx).reason).toBe('ORGANIZATION_DENIED');
    expect(evaluateFlag({ ...base, allowOrganizations: [ORG], planTiers: ['ENTERPRISE'] }, ctx)).toMatchObject({ enabled: true, reason: 'ORGANIZATION_ALLOWED' });
    expect(evaluateFlag({ ...base, planTiers: ['ENTERPRISE'] }, ctx).reason).toBe('PLAN_EXCLUDED');
    expect(evaluateFlag({ ...base, betaOnly: true }, ctx).reason).toBe('BETA_ONLY');
    expect(evaluateFlag({ ...base, betaOnly: true }, { ...ctx, betaOptIn: true }).enabled).toBe(true);
    expect(evaluateFlag({ ...base, rolloutPercentage: 0 }, ctx).reason).toBe('OUTSIDE_ROLLOUT');
  });
  it('buckets users deterministically and roughly proportionally', () => {
    expect(rolloutBucket('k', USER)).toBe(rolloutBucket('k', USER));
    let on = 0;
    for (let i = 0; i < 2000; i++) if (rolloutBucket('k', `user-${i}`) < 30) on++;
    expect(on).toBeGreaterThan(500);
    expect(on).toBeLessThan(700);
  });
});

describe('Report type selection', () => {
  const findings = [
    { id: '1', severity: 'BLOCKER', engine: 'OPD_GUARD' },
    { id: '2', severity: 'MINOR', engine: 'CLEAN_CORE_OBJECT_GUARD' },
    { id: '3', severity: 'CRITICAL', rule_id: 'CLEAN_CORE_TIER3_DIRECT_DB_MUTATION' },
  ];
  it('is deterministic per type', () => {
    expect(selectFindingsForReport('MIGRATION_BLOCKER', findings).map((f) => f.id)).toEqual(['1', '3']);
    expect(selectFindingsForReport('CLEAN_CORE', findings).map((f) => f.id)).toEqual(['2', '3']);
    expect(selectFindingsForReport('TECHNICAL', findings)).toHaveLength(3);
  });
});

describe('RetentionService', () => {
  function fixture(policy: { artifact_retention_days: number | null; report_retention_days: number | null }, files: any[], reports: any[], failKeys: string[] = []) {
    const deleted: string[] = [];
    const db: any = {
      query: vi.fn(async (sql: string, params: any[]) => {
        if (sql.startsWith('DELETE')) {
          deleted.push(...params[1]);
          return { rows: [] };
        }
        if (sql.includes('SELECT artifact_retention_days, report_retention_days')) return { rows: [policy] };
        if (sql.includes('SELECT artifact_retention_days FROM')) return { rows: [policy] };
        if (sql.includes('FROM uploaded_files')) return { rows: files };
        if (sql.includes('FROM reports')) return { rows: reports };
        if (sql.startsWith('DELETE')) {
          deleted.push(...params[1]);
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };
    const send = vi.fn(async (cmd: any) => {
      if (failKeys.includes(cmd.input.Key)) throw new Error('s3 down');
      return {};
    });
    const storage: any = { getClient: () => ({ send }), cleanBucket: 'clean', quarantineBucket: 'q', reportsBucket: 'reports' };
    const audit: any = { recordSafe: vi.fn().mockResolvedValue(true) };
    return { svc: new RetentionService(db, storage, audit), db, send, audit, deleted };
  }

  it('purges expired artifacts and reports from storage then rows, and audits it', async () => {
    const f = fixture(
      { artifact_retention_days: 7, report_retention_days: 30 },
      [{ id: 'f1', storage_path: 'tenants/o/p/f1', file_size: 100 }],
      [{ id: 'r1', s3_key: 'tenants/o/p/reports/r1', file_size: 50 }]
    );
    const sum = await f.svc.purgeTenant(ORG, new Date('2026-09-26T00:00:00Z'));
    expect(sum).toMatchObject({ artifactsPurged: 1, artifactBytes: 100, reportsPurged: 1, reportBytes: 50, storageErrors: 0 });
    expect(f.deleted).toEqual(['f1', 'r1']);
    const cutoff = f.db.query.mock.calls.find((c: any[]) => c[0].includes('FROM uploaded_files'))[1][1];
    expect(cutoff).toBe('2026-09-19T00:00:00.000Z');
    expect(f.audit.recordSafe).toHaveBeenCalledWith(expect.objectContaining({ action: 'retention.artifacts.purged' }));
    expect(f.audit.recordSafe).toHaveBeenCalledWith(expect.objectContaining({ action: 'retention.reports.purged' }));
  });

  it('keeps rows whose object deletion failed so the next sweep retries', async () => {
    const f = fixture({ artifact_retention_days: 1, report_retention_days: null }, [
      { id: 'ok', storage_path: 'k-ok', file_size: 1 },
      { id: 'bad', storage_path: 'k-bad', file_size: 1 },
    ], [], ['k-bad']);
    const sum = await f.svc.purgeTenant(ORG);
    expect(f.deleted).toEqual(['ok']);
    expect(sum.storageErrors).toBe(1);
  });

  it('delete-after-analysis only applies to policy 0', async () => {
    const zero = fixture({ artifact_retention_days: 0, report_retention_days: null }, [{ id: 'f1', storage_path: 'k', file_size: 1 }], []);
    expect(await zero.svc.purgeAfterAnalysis(ORG, ['f1'], 'a1')).toBe(1);
    const keep = fixture({ artifact_retention_days: null, report_retention_days: null }, [{ id: 'f1', storage_path: 'k', file_size: 1 }], []);
    expect(await keep.svc.purgeAfterAnalysis(ORG, ['f1'], 'a1')).toBe(0);
    expect(keep.send).not.toHaveBeenCalled();
  });
});

describe('SupportService', () => {
  it('requires a finding for incorrect-finding reports and rejects foreign analyses', async () => {
    const db: any = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const svc = new SupportService(db);
    await expect(svc.createTicket(ORG, USER, { subject: 'Wrong result', description: 'This finding is wrong', category: 'INCORRECT_FINDING' })).rejects.toThrow(/findingId/);
    await expect(svc.createTicket(ORG, USER, { subject: 'Wrong result', description: 'This finding is wrong', category: 'QUESTION', analysisId: TARGET })).rejects.toThrow(/Analysis not found/);
  });
});
