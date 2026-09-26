import { describe, it, expect, vi } from 'vitest';
import { RouterService } from '../src/modules/router/router.service';
import { AiGatewayService, AiUnavailableError } from '../src/modules/ai-gateway/ai-gateway.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const PROJ = '33333333-3333-4333-8333-333333333333';

function makeDb(project: any = null) {
  const queries: Array<{ sql: string; params: any[]; options: any }> = [];
  const db: any = {
    query: vi.fn(async (sql: string, params: any[], options: any) => {
      queries.push({ sql, params, options });
      if (sql.includes('FROM projects')) return { rows: project ? [project] : [] };
      return { rows: [] };
    }),
  };
  return { db, queries };
}

const catalog: any = {
  getContracts: vi.fn(async () =>
    new Map([
      ['OPD_GUARD', { engine: 'OPD_GUARD', name: 'OPD Guard', acceptedFormats: ['JSON', 'XML'], summary: 'decision tables', required: ['At least one decision table'], notes: [] }],
    ])
  ),
};
const profiler: any = { profileProjectArtifacts: vi.fn(async () => ({ artifacts: [], files: [], skipped: [] })) };

describe('RouterService', () => {
  it('routes deterministically, attaches required inputs from contracts and persists the routing tenant-scoped', async () => {
    const { db, queries } = makeDb();
    const svc = new RouterService(db, catalog, profiler);
    const res = await svc.route(ORG, USER, { problem: 'Purchase order is created but supplier email is not sent.' });
    expect(res.suggestions[0]).toMatchObject({
      engine: 'OPD_GUARD',
      role: 'PRIMARY',
      confidenceClass: 'RULE_DERIVED',
      requiredInputs: [{ description: 'At least one decision table', satisfiedBy: [] }],
    });
    expect(res.ai.status).toBe('NOT_REQUESTED');
    const insert = queries.find((q) => q.sql.includes('INSERT INTO problem_routings'));
    expect(insert?.params[1]).toBe(ORG);
    expect(insert?.options).toEqual({ tenantId: ORG });
    expect(insert?.params[9]).toBeNull();
  });

  it('rejects invalid payloads and fileIds without a project', async () => {
    const { db } = makeDb();
    const svc = new RouterService(db, catalog, profiler);
    await expect(svc.route(ORG, USER, { problem: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.route(ORG, USER, { problem: 'valid text', evil: 1 })).rejects.toMatchObject({ status: 400 });
    await expect(
      svc.route(ORG, USER, { problem: 'valid text', fileIds: ['44444444-4444-4444-8444-444444444444'] })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('returns 404 for a project of another tenant', async () => {
    const { db } = makeDb(null);
    const svc = new RouterService(db, catalog, profiler);
    await expect(svc.route(ORG, USER, { problem: 'email not sent', projectId: PROJ })).rejects.toMatchObject({ status: 404 });
  });

  it('does not call any model when the data policy forbids AI', async () => {
    const { db } = makeDb();
    const ai: any = { aiAllowed: vi.fn(async () => ({ allowed: false, reason: 'POLICY' })), completeJson: vi.fn() };
    const res = await new RouterService(db, catalog, profiler, ai).route(ORG, USER, { problem: 'supplier email is not sent', useAi: true });
    expect(res.ai.status).toBe('DISABLED_BY_POLICY');
    expect(ai.completeJson).not.toHaveBeenCalled();
    expect(res.suggestions[0].engine).toBe('OPD_GUARD');
  });

  it('labels AI refinement INFERRED ≤ 0.60, keeps rule routes and reports conflicts', async () => {
    const { db, queries } = makeDb();
    const ai: any = {
      aiAllowed: vi.fn(async () => ({ allowed: true, reason: null })),
      completeJson: vi.fn(async () => ({
        provider: 'OPENAI',
        model: 'gpt-test',
        tokens: 42,
        latencyMs: 12,
        purpose: 'problem_routing',
        json: { engines: [{ engine: 'FORM_DOCTOR', reason: 'PDF form may be wrong' }] },
      })),
    };
    const res = await new RouterService(db, catalog, profiler, ai).route(ORG, USER, { problem: 'supplier email is not sent', useAi: true });
    expect(res.suggestions.map((s) => s.engine)).toEqual(['OPD_GUARD']);
    expect(res.ai).toMatchObject({ status: 'APPLIED', model: 'gpt-test', tokens: 42 });
    expect(res.ai.suggestions).toEqual([
      { engine: 'FORM_DOCTOR', reason: 'PDF form may be wrong', confidence: 0.6, confidenceClass: 'INFERRED', agreesWithDeterministic: false },
    ]);
    expect(res.ai.conflicts.join(' ')).toMatch(/rule-based route stands/);
    expect(ai.completeJson.mock.calls[0][0].purpose).toBe('problem_routing');
    const insert = queries.find((q) => q.sql.includes('INSERT INTO problem_routings'));
    expect(JSON.parse(insert!.params[9]).status).toBe('APPLIED');
  });

  it('discards schema-invalid model output', async () => {
    const { db } = makeDb();
    const ai: any = {
      aiAllowed: vi.fn(async () => ({ allowed: true, reason: null })),
      completeJson: vi.fn(async () => ({ provider: 'OPENAI', model: 'm', tokens: 1, latencyMs: 1, json: { engines: [{ engine: 'DROP_TABLE', reason: 'x' }] } })),
    };
    const res = await new RouterService(db, catalog, profiler, ai).route(ORG, USER, { problem: 'supplier email is not sent', useAi: true });
    expect(res.ai.status).toBe('REJECTED_INVALID_OUTPUT');
    expect(res.ai.suggestions).toEqual([]);
  });

  it('falls back to rule-based routing when the provider is unavailable', async () => {
    const { db } = makeDb();
    const ai: any = {
      aiAllowed: vi.fn(async () => ({ allowed: true, reason: null })),
      completeJson: vi.fn(async () => {
        throw new AiUnavailableError('PROVIDER_UNAVAILABLE', 'down');
      }),
    };
    const res = await new RouterService(db, catalog, profiler, ai).route(ORG, USER, { problem: 'supplier email is not sent', useAi: true });
    expect(res.ai.status).toBe('PROVIDER_UNAVAILABLE');
    expect(res.suggestions[0].engine).toBe('OPD_GUARD');
  });
});

describe('AiGatewayService.completeJson', () => {
  it('refuses when the tenant policy disallows AI and records model/tokens/purpose when allowed', async () => {
    const usage: any = { recordSafe: vi.fn(async () => true) };
    const config: any = { get: (k: string) => ({ AI_DEFAULT_PROVIDER: 'OLLAMA_LOCAL', OLLAMA_BASE_URL: 'http://llm.local:11434', AI_OLLAMA_MODEL: 'test-model' } as any)[k] };
    const denied = new AiGatewayService(undefined, config, usage);
    await expect(
      denied.completeJson({ purpose: 'p', system: 's', user: 'u' }, { tenantId: ORG, dataPolicy: { allowAiAssistance: false } })
    ).rejects.toBeInstanceOf(AiUnavailableError);

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ model: 'test-model', choices: [{ message: { content: '{"engines":[]}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    }));
    const original = global.fetch;
    global.fetch = fetchMock as any;
    try {
      const gw = new AiGatewayService(undefined, config, usage);
      const out = await gw.completeJson(
        { purpose: 'problem_routing', system: 's', user: 'mail me at a@b.com password=hunter2' },
        { tenantId: ORG, dataPolicy: { allowAiAssistance: true } }
      );
      expect(out).toMatchObject({ provider: 'OLLAMA_LOCAL', model: 'test-model', tokens: 15, json: { engines: [] } });
      const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
      expect(body.messages[1].content).not.toContain('a@b.com');
      expect(body.messages[1].content).not.toContain('hunter2');
      expect(usage.recordSafe).toHaveBeenCalledWith(ORG, 'AI_TOKENS', 15, expect.objectContaining({ metadata: expect.objectContaining({ purpose: 'problem_routing', model: 'test-model', provider: 'OLLAMA_LOCAL' }) }));
    } finally {
      global.fetch = original;
    }
  });
});
