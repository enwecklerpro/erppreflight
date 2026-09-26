import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { publishBlocker, canTransitionRule, UpdateRuleGovernanceSchema } from '../src/modules/governance/rule-governance.types';
import { RuleGovernanceService } from '../src/modules/governance/rule-governance.service';
import { alertDecision, freshnessOf } from '../src/modules/governance/source-sync.types';
import { SourceSyncAdminService } from '../src/modules/governance/source-sync-admin.service';
import { defaultAiTaskPolicy, routeAiCandidates } from '../src/modules/ai-gateway/ai-governance.routing';
import { AiGovernanceService } from '../src/modules/ai-gateway/ai-governance.service';
import { AiTaskConfigSchema, AiProviderControlSchema, type ResolvedAiTaskPolicy } from '../src/modules/ai-gateway/ai-governance.types';
import { AiGatewayService, AiUnavailableError } from '../src/modules/ai-gateway/ai-gateway.service';

const ORG = '00000000-0000-0000-0000-0000000000aa';
const V1 = '1.0.0#aaaaaaaaaaaaaaaa';
const V2 = '1.0.0#bbbbbbbbbbbbbbbb';
const latest = (status: 'PASSED' | 'FAILED' | 'NO_FIXTURES' | 'ERROR', ruleVersion = V1) => ({
  id: '11111111-1111-1111-1111-111111111111',
  status,
  ruleVersion,
  resultDigest: 'a'.repeat(64),
  positiveCount: 1,
  negativeCount: 3,
  createdAt: new Date().toISOString(),
});

describe('Rule Admin publish gate (spec 10.10)', () => {
  it('allows publishing only a covered rule in review whose latest self-test of the current version passed', () => {
    const base = { status: 'IN_REVIEW' as const, currentVersion: V1, covered: true, reviewer: 'reviewer@example.com' };
    expect(publishBlocker({ ...base, latest: latest('PASSED') })).toBeNull();
    expect(publishBlocker({ ...base, latest: null })).toBe('NO_SELF_TEST');
    expect(publishBlocker({ ...base, latest: latest('FAILED') })).toBe('SELF_TEST_NOT_PASSED');
    expect(publishBlocker({ ...base, latest: latest('ERROR') })).toBe('SELF_TEST_NOT_PASSED');
    expect(publishBlocker({ ...base, latest: latest('PASSED', V2) })).toBe('SELF_TEST_OUTDATED');
    expect(publishBlocker({ ...base, covered: false, latest: latest('NO_FIXTURES') })).toBe('COVERAGE_GAP');
    expect(publishBlocker({ ...base, reviewer: null, latest: latest('PASSED') })).toBe('REVIEWER_REQUIRED');
    expect(publishBlocker({ ...base, status: 'DRAFT', latest: latest('PASSED') })).toBe('NOT_IN_REVIEW');
  });

  it('only permits the documented lifecycle transitions', () => {
    expect(canTransitionRule('DRAFT', 'IN_REVIEW')).toBe(true);
    expect(canTransitionRule('DRAFT', 'PUBLISHED')).toBe(false);
    expect(canTransitionRule('IN_REVIEW', 'PUBLISHED')).toBe(true);
    expect(canTransitionRule('PUBLISHED', 'DEPRECATED')).toBe(true);
    expect(canTransitionRule('DEPRECATED', 'PUBLISHED')).toBe(false);
  });

  it('rejects empty governance updates', () => {
    expect(UpdateRuleGovernanceSchema.safeParse({}).success).toBe(false);
    expect(UpdateRuleGovernanceSchema.safeParse({ reviewer: 'Jane Doe' }).success).toBe(true);
    expect(UpdateRuleGovernanceSchema.safeParse({ reviewer: 'Jane', extra: 1 }).success).toBe(false);
  });

  function makeService(opts: { gov: any; latestRun: any | null; covered?: boolean }) {
    const queries: Array<{ sql: string; params: any[] }> = [];
    const db: any = {
      query: vi.fn(async (sql: string, params: any[] = []) => {
        queries.push({ sql, params });
        if (sql.includes('FROM rule_governance WHERE rule_code')) return { rows: opts.gov ? [opts.gov] : [] };
        if (sql.includes('DISTINCT ON (rule_code)')) return { rows: opts.latestRun ? [opts.latestRun] : [] };
        if (sql.includes('WITH up AS')) return { rows: [{ id: 'ev1' }] };
        return { rows: [] };
      }),
    };
    const client: any = {
      engineCatalog: vi.fn(async () => [
        {
          engine_type: 'OPD_GUARD',
          name: 'OPD Guard',
          version: '1.0.0',
          domain: 'Output',
          rules: [{ code: 'OPD_RULE_X', title: 'X', defaultSeverity: 'MAJOR', category: '', remediation: 'fix', version: V1 }],
          input_validation_rule_codes: [],
        },
      ]),
      coverage: vi.fn(async () => ({
        manifestVersion: '1',
        totalCases: 2,
        summary: {},
        rules: [
          {
            ruleCode: 'OPD_RULE_X',
            engineType: 'OPD_GUARD',
            ruleVersion: V1,
            inputValidationRule: false,
            positiveCases: opts.covered === false ? [] : ['p1'],
            negativeCases: ['n1'],
            covered: opts.covered !== false,
            gap: opts.covered === false ? 'NO_POSITIVE_FIXTURE' : null,
          },
        ],
      })),
      selfTest: vi.fn(),
    };
    return { service: new RuleGovernanceService(db, client), db, queries };
  }

  const actor = { id: null, email: 'admin@example.com' };
  const gov = { rule_code: 'OPD_RULE_X', engine_type: 'OPD_GUARD', status: 'IN_REVIEW', reviewer: 'Jane Reviewer' };
  const run = (status: string, version = V1) => ({
    id: '22222222-2222-2222-2222-222222222222',
    rule_code: 'OPD_RULE_X',
    status,
    rule_version: version,
    result_digest: 'b'.repeat(64),
    positive_count: 1,
    negative_count: 1,
    created_at: new Date(),
  });

  it('blocks publishing after a failed self-test and records a PUBLISH_BLOCKED event', async () => {
    const { service, queries } = makeService({ gov, latestRun: run('FAILED') });
    await expect(service.transition('OPD_RULE_X', { to: 'PUBLISHED' }, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(queries.some((q) => q.sql.includes("'PUBLISH_BLOCKED'"))).toBe(true);
    expect(queries.some((q) => q.sql.includes('WITH up AS'))).toBe(false);
  });

  it('blocks publishing when the passing self-test ran against an older rule version', async () => {
    const { service } = makeService({ gov, latestRun: run('PASSED', V2) });
    await expect(service.transition('OPD_RULE_X', { to: 'PUBLISHED' }, actor)).rejects.toMatchObject({
      response: { code: 'RULE_PUBLISH_BLOCKED_SELF_TEST_OUTDATED' },
    });
  });

  it('blocks publishing a rule without golden fixtures (coverage gap)', async () => {
    const { service } = makeService({ gov, latestRun: run('NO_FIXTURES'), covered: false });
    await expect(service.transition('OPD_RULE_X', { to: 'PUBLISHED' }, actor)).rejects.toMatchObject({
      response: { code: 'RULE_PUBLISH_BLOCKED_COVERAGE_GAP' },
    });
  });

  it('publishes with the passing self-test id and the current rule version', async () => {
    const { service, queries } = makeService({ gov, latestRun: run('PASSED') });
    await service.transition('OPD_RULE_X', { to: 'PUBLISHED' }, actor).catch(() => undefined);
    const upd = queries.find((q) => q.sql.includes('WITH up AS'))!;
    expect(upd).toBeDefined();
    expect(upd.params[3]).toBe('PUBLISHED');
    expect(upd.params[4]).toBe(V1);
    expect(upd.params[5]).toBe('22222222-2222-2222-2222-222222222222');
    // The gate is re-checked inside the UPDATE: a self-test recorded after the approved run blocks it.
    expect(upd.sql).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM rule_self_test_runs r, rule_self_test_runs g/);
  });

  it('refuses the publish when a newer self-test was recorded between gate check and update', async () => {
    const { service, queries } = makeService({ gov, latestRun: run('PASSED') });
    // The atomic UPDATE matches no row (a newer run exists): nothing is published.
    const db = (service as any).db;
    const original = db.query.getMockImplementation();
    db.query.mockImplementation(async (sql: string, params: any[] = []) =>
      sql.includes('WITH up AS') ? (queries.push({ sql, params }), { rows: [] }) : original(sql, params)
    );
    await expect(service.transition('OPD_RULE_X', { to: 'PUBLISHED' }, actor)).rejects.toMatchObject({
      response: { code: 'RULE_CONCURRENT_UPDATE' },
    });
  });
});

describe('Source Sync Admin freshness (spec 10.12)', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  it('classifies freshness against the threshold', () => {
    expect(freshnessOf(null, 24, now)).toEqual({ state: 'NEVER_SYNCED', ageHours: null });
    expect(freshnessOf(new Date('2026-09-26T00:00:00Z'), 24, now).state).toBe('FRESH');
    expect(freshnessOf(new Date('2026-09-24T00:00:00Z'), 24, now)).toEqual({ state: 'STALE', ageHours: 60 });
  });

  it('opens an alert only for critical sources with alerting, and resolves it idempotently', () => {
    expect(alertDecision({ critical: true, alertsEnabled: true, state: 'STALE', hasOpenAlert: false })).toBe('OPEN');
    expect(alertDecision({ critical: true, alertsEnabled: true, state: 'NEVER_SYNCED', hasOpenAlert: true })).toBe('KEEP');
    expect(alertDecision({ critical: false, alertsEnabled: true, state: 'STALE', hasOpenAlert: false })).toBe('NONE');
    expect(alertDecision({ critical: true, alertsEnabled: false, state: 'STALE', hasOpenAlert: true })).toBe('RESOLVE');
    expect(alertDecision({ critical: true, alertsEnabled: true, state: 'FRESH', hasOpenAlert: true })).toBe('RESOLVE');
  });

  function sourceService(lastSuccess: Date | null) {
    const inserted: any[] = [];
    const db: any = {
      query: vi.fn(async (sql: string, params: any[] = []) => {
        if (sql.includes('UNION SELECT adapter_id')) return { rows: [] };
        if (sql.includes("status IN ('PUBLISHED', 'NOOP')"))
          return lastSuccess
            ? { rows: [{ id: 'r1', adapter_id: 'SAP_CLOUDIFICATION_REPOSITORY', status: 'NOOP', source_results: [{ records: 5 }], finished_at: lastSuccess }] }
            : { rows: [] };
        if (sql.includes('INSERT INTO knowledge_source_alerts')) {
          inserted.push(params);
          return { rows: [{ id: '33333333-3333-3333-3333-333333333333' }] };
        }
        if (sql.includes("system_role = 'SUPER_ADMIN'")) return { rows: [{ id: 'u1', email: 'root@example.com', org_id: ORG }] };
        if (sql.includes('COUNT(*)::int AS objects')) return { rows: [{ objects: 0, published: 0 }] };
        return { rows: [] };
      }),
      withTenantTransaction: vi.fn(async (_org: string, cb: any) => cb({ query: vi.fn(async () => ({ rows: [] })) })),
    };
    const sync: any = {
      cloudificationSource: () => ({ describe: () => ({ title: 'SAP Cloudification Repository', documents: [] }) }),
      enqueueSync: vi.fn(async () => ({ jobId: '7', queued: true })),
    };
    const mail: any = { send: vi.fn(async () => ({})), link: (p: string) => `http://app.local${p}` };
    return { service: new SourceSyncAdminService(db, sync, mail), db, sync, mail, inserted };
  }

  it('opens a stale alert for the critical Cloudification source and notifies super admins in-app and by e-mail', async () => {
    const { service, db, mail, inserted } = sourceService(new Date('2026-09-10T00:00:00Z'));
    const res = await service.checkFreshness(now);
    expect(res.opened).toHaveLength(1);
    expect(res.opened[0]).toMatchObject({ adapterId: 'SAP_CLOUDIFICATION_REPOSITORY', notifiedUsers: 1 });
    expect(inserted[0][0]).toBe('SAP_CLOUDIFICATION_REPOSITORY');
    expect(db.withTenantTransaction).toHaveBeenCalledWith(ORG, expect.any(Function));
    expect(mail.send).toHaveBeenCalledWith('root@example.com', expect.objectContaining({ template: 'KNOWLEDGE_SOURCE_STALE' }));
  });

  it('does not alert for a fresh source and refuses to retry a file import', async () => {
    const { service, sync } = sourceService(new Date('2026-09-26T10:00:00Z'));
    expect((await service.checkFreshness(now)).opened).toHaveLength(0);
    await expect(service.retry('ROSA_FILE_IMPORT', 'a@b.c')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.retry('SAP_CLOUDIFICATION_REPOSITORY', 'a@b.c')).resolves.toMatchObject({ queued: true, jobId: '7' });
    expect(sync.enqueueSync).toHaveBeenCalledWith('admin-retry:a@b.c');
  });
});

describe('AI Admin governance (spec 10.11)', () => {
  const config: any = { get: (k: string) => ({ OLLAMA_BASE_URL: 'http://llm.local:11434', AI_OLLAMA_MODEL: 'env-model' } as any)[k] };
  const policy = (over: Partial<ResolvedAiTaskPolicy> = {}): ResolvedAiTaskPolicy => ({
    ...defaultAiTaskPolicy('intent_classification', config),
    configured: true,
    provider: 'OLLAMA_LOCAL',
    primaryModel: 'primary-model',
    ...over,
  });

  it('never routes to a killed provider and falls back to the configured fallback', () => {
    const r = routeAiCandidates(policy({ fallbackProvider: 'OPENAI', fallbackModel: 'fb-model', killedProviders: ['OLLAMA_LOCAL'] }), null, config);
    expect(r.candidates.map((c) => c.provider)).toEqual(['OPENAI']);
    expect(r.killed).toEqual(['OLLAMA_LOCAL']);
    const all = routeAiCandidates(policy({ killedProviders: ['OLLAMA_LOCAL'] }), null, config);
    expect(all).toMatchObject({ candidates: [], blocked: 'KILL_SWITCH' });
  });

  it('enforces SELF_HOSTED_ONLY privacy mode, disabled tasks and endpoint overrides', () => {
    expect(routeAiCandidates(policy({ provider: 'OPENAI', privacyMode: 'SELF_HOSTED_ONLY' }), null, config).blocked).toBe('PRIVACY_MODE');
    expect(routeAiCandidates(policy({ enabled: false }), null, config).blocked).toBe('TASK_DISABLED');
    const r = routeAiCandidates(policy({ endpointOverrides: { OLLAMA_LOCAL: 'http://10.0.0.5:8080/' } }), null, config);
    expect(r.candidates[0]).toMatchObject({ provider: 'OLLAMA_LOCAL', model: 'primary-model', endpoint: 'http://10.0.0.5:8080' });
  });

  it('validates task configuration and kill switch input', () => {
    const base = {
      enabled: true,
      provider: 'OPENAI',
      primaryModel: 'm',
      fallbackProvider: null,
      fallbackModel: null,
      maxTokens: 512,
      temperature: 0.2,
      privacyMode: 'STANDARD',
      costCeilingEurMonthly: null,
      inputPriceEurPer1k: 0,
      outputPriceEurPer1k: 0,
    };
    expect(AiTaskConfigSchema.safeParse(base).success).toBe(true);
    expect(AiTaskConfigSchema.safeParse({ ...base, privacyMode: 'SELF_HOSTED_ONLY' }).success).toBe(false);
    expect(AiTaskConfigSchema.safeParse({ ...base, costCeilingEurMonthly: 10 }).success).toBe(false);
    expect(AiTaskConfigSchema.safeParse({ ...base, maxTokens: 10_000 }).success).toBe(false);
    expect(AiProviderControlSchema.safeParse({ killSwitch: true }).success).toBe(false);
    expect(AiProviderControlSchema.safeParse({ killSwitch: true, reason: 'incident 42' }).success).toBe(true);
    expect(AiProviderControlSchema.safeParse({ killSwitch: false, endpointUrl: 'http://169.254.169.254/' }).success).toBe(false);
  });

  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });

  const RESERVATION = { task: 'intent_classification', periodMonth: '2026-09-01', amountEur: 0.5 };
  function gateway(p: ResolvedAiTaskPolicy, reservation: any = RESERVATION) {
    const governance: any = {
      resolvePolicy: vi.fn(async () => p),
      reserveBudget: vi.fn(async () => reservation),
      releaseBudget: vi.fn(async () => undefined),
      recordCall: vi.fn(async () => 0),
      recordBlocked: vi.fn(async () => undefined),
    };
    const usage: any = { recordSafe: vi.fn(async () => true) };
    return { gw: new AiGatewayService(undefined, config, usage, undefined, governance), governance };
  }
  const allow = { tenantId: ORG, dataPolicy: { allowAiAssistance: true } };
  const okResponse = () => ({
    ok: true,
    json: async () => ({ model: 'primary-model', choices: [{ message: { content: '{"engines":[{"engine":"OPD_GUARD","reason":"x"}]}' } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }),
  });

  it('kill switch: the provider is never called and the call is counted as blocked', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    global.fetch = fetchMock as any;
    const { gw, governance } = gateway(policy({ killedProviders: ['OLLAMA_LOCAL'] }));
    await expect(gw.completeJson({ purpose: 'intent_classification', system: 's', user: 'u' }, allow)).rejects.toMatchObject({ code: 'KILL_SWITCH' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(governance.recordBlocked).toHaveBeenCalledWith('intent_classification', 'OLLAMA_LOCAL');
    const res = await gw.classifyIntent({ problemDescription: 'output not sent' }, allow);
    expect(res).toMatchObject({ providerUsed: 'DETERMINISTIC_FALLBACK', aiUnavailableReason: 'KILL_SWITCH' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cost ceiling: refuses the call once spend plus the worst-case projection exceeds the ceiling', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    global.fetch = fetchMock as any;
    const p = policy({ costCeilingEurMonthly: 1, inputPriceEurPer1k: 1, outputPriceEurPer1k: 1, maxTokens: 512 });
    const { gw, governance } = gateway(p, null);
    await expect(gw.completeJson({ purpose: 'intent_classification', system: 's', user: 'u' }, allow)).rejects.toMatchObject({ code: 'COST_CEILING' });
    expect(fetchMock).not.toHaveBeenCalled();
    // Worst case reserved before any call: 1 input token + 512 output tokens at 1 EUR / 1k.
    expect(governance.reserveBudget).toHaveBeenCalledWith(p, (1 + 512) / 1000);
    expect(governance.recordBlocked).toHaveBeenCalledWith('intent_classification', 'OLLAMA_LOCAL');
  });

  it('cost ceiling: fails closed when the reservation cannot be written', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    global.fetch = fetchMock as any;
    const { gw, governance } = gateway(policy({ costCeilingEurMonthly: 5, inputPriceEurPer1k: 1, outputPriceEurPer1k: 1 }));
    governance.reserveBudget.mockRejectedValueOnce(new Error('db down'));
    await expect(gw.completeJson({ purpose: 'intent_classification', system: 's', user: 'u' }, allow)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cost ceiling: settles the reservation with the actual cost, releases it when no provider answered', async () => {
    const p = policy({ costCeilingEurMonthly: 5, inputPriceEurPer1k: 1, outputPriceEurPer1k: 1 });
    global.fetch = vi.fn(async () => okResponse()) as any;
    const ok = gateway(p);
    await ok.gw.completeJson({ purpose: 'intent_classification', system: 's', user: 'u' }, allow);
    expect(ok.governance.recordCall).toHaveBeenCalledWith(p, 'OLLAMA_LOCAL', 'primary-model', 100, 50, RESERVATION);
    expect(ok.governance.releaseBudget).not.toHaveBeenCalled();

    global.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) as any;
    const failing = gateway(p);
    await expect(failing.gw.completeJson({ purpose: 'intent_classification', system: 's', user: 'u' }, allow)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(failing.governance.releaseBudget).toHaveBeenCalledWith(RESERVATION);
    expect(failing.governance.recordCall).not.toHaveBeenCalled();
  });

  it('cost ceiling reservation is one conditional upsert evaluated on the locked budget row', async () => {
    const db: any = { query: vi.fn(async () => ({ rows: [] })) };
    const svc = new AiGovernanceService(db);
    const p = policy({ costCeilingEurMonthly: 2, inputPriceEurPer1k: 1, outputPriceEurPer1k: 1 });
    expect(await svc.reserveBudget(p, 0.75)).toBeNull();
    const [sql, params, opts] = db.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO ai_task_budget/);
    expect(sql).toMatch(/ON CONFLICT \(task_type, period_month\) DO UPDATE/);
    expect(sql).toMatch(/WHERE b\.spent_eur \+ b\.reserved_eur \+ EXCLUDED\.reserved_eur <= \$3::numeric/);
    expect(params).toEqual(['intent_classification', 0.75, 2]);
    expect(opts).toEqual({ bypassRls: true });
    db.query.mockResolvedValueOnce({ rows: [{ period_month: '2026-09-01' }] });
    expect(await svc.reserveBudget(p, 0.75)).toEqual({ task: 'intent_classification', periodMonth: '2026-09-01', amountEur: 0.75 });
    // No ceiling: nothing is reserved and the database is not touched.
    db.query.mockClear();
    expect(await svc.reserveBudget(policy({ costCeilingEurMonthly: null }), 1)).toEqual({ task: 'intent_classification', periodMonth: null, amountEur: 0 });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('uses the configured model, token cap and temperature, records spend, and falls back when the primary fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce(okResponse());
    global.fetch = fetchMock as any;
    const p = policy({ maxTokens: 256, temperature: 0.1, fallbackProvider: 'OLLAMA_LOCAL', fallbackModel: 'fallback-model' });
    const { gw, governance } = gateway(p);
    const out = await gw.completeJson({ purpose: 'intent_classification', system: 's', user: 'u', maxTokens: 2000 }, allow);
    const first = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    const second = JSON.parse((fetchMock.mock.calls[1] as any)[1].body);
    expect(first).toMatchObject({ model: 'primary-model', max_tokens: 256, temperature: 0.1 });
    expect(second.model).toBe('fallback-model');
    expect(out.tokens).toBe(150);
    expect(governance.recordCall).toHaveBeenCalledWith(p, 'OLLAMA_LOCAL', 'primary-model', 100, 50, null);
  });

  it('keeps AI-assisted explanations capped at INFERRED 0.60', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"explanation":"e","remediationSteps":["s"]}' } }], usage: {} }),
    })) as any;
    const { gw } = gateway(policy());
    const res = await gw.explainFinding(
      { ruleId: 'OPD_X', category: 'c', title: 't', description: 'd', affectedObjects: [] },
      allow
    );
    expect(res).toMatchObject({ confidenceClass: 'INFERRED', providerUsed: 'OLLAMA_LOCAL' });
    expect(res.confidenceScore).toBeLessThanOrEqual(0.6);
  });

  it('computes cost from per-1k token prices', () => {
    expect(AiGovernanceService.costOf({ inputPriceEurPer1k: 2, outputPriceEurPer1k: 4 }, 500, 250)).toBeCloseTo(2);
  });
});
