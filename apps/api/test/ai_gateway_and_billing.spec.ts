import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiGatewayService } from '../src/modules/ai-gateway/ai-gateway.service';

describe('AI Gateway & Entitlements Billing Suite', () => {
  const tenantId = '00000000-0000-0000-0000-000000000001';
  let mockDb: any;
  let mockConfig: any;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
      withTenantTransaction: vi.fn(async (_tenantIdOrCb: any, maybeCb?: any) => {
        const cb = typeof _tenantIdOrCb === 'function' ? _tenantIdOrCb : maybeCb;
        return await cb(mockDb);
      }),
    };
    mockConfig = {
      get: vi.fn(),
    };
  });

  describe('AiGatewayService (Governance & Epistemic Boundaries)', () => {
    it('strictly bypasses LLMs and returns deterministic explanation when tenant dataPolicy has deterministicOnly=true', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [{ data_policy: { deterministicOnly: true } }],
      });

      const service = new AiGatewayService(mockDb, mockConfig);
      const res = await service.explainFinding(
        {
          ruleId: 'CLEAN_CORE_TIER3_DIRECT_DB_MUTATION',
          category: 'Clean Core',
          title: 'Direct update to BKPF',
          description: 'Custom program modifies accounting table directly',
          affectedObjects: ['ZFI_POST_DOCUMENT'],
        },
        { tenantId }
      );

      expect(res.deterministicBypass).toBe(true);
      expect(res.providerUsed).toBe('DETERMINISTIC_FALLBACK');
      expect(res.confidenceScore).toBeLessThanOrEqual(0.60);
      expect(res.remediationSteps.length).toBeGreaterThan(0);
      expect(res.caveats[0]).toContain('zero external cloud LLMs contacted');
    });

    it('strictly bypasses LLMs when allowAiAssistance=false', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [{ data_policy: { allowAiAssistance: false } }],
      });

      const service = new AiGatewayService(mockDb, mockConfig);
      const res = await service.explainFinding(
        {
          ruleId: 'OPD_DETERMINATION_STEP_MISSING',
          category: 'Output Determination',
          title: 'Missing routing step in OPD',
          description: 'No channel configured for billing document',
          affectedObjects: ['OPD_TABLE'],
        },
        { tenantId }
      );

      expect(res.deterministicBypass).toBe(true);
      expect(res.providerUsed).toBe('DETERMINISTIC_FALLBACK');
    });

    it('caps AI confidence score at 0.60 (INFERRED) ceiling per Cardinal Axiom 2', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'AI_DEFAULT_PROVIDER') return 'ANTHROPIC';
        if (key === 'ANTHROPIC_API_KEY') return 'sk-ant-test-key';
        return null;
      });
      mockDb.query.mockResolvedValueOnce({
        rows: [{ data_policy: { deterministicOnly: false, allowAiAssistance: true } }],
      });

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: '{"explanation": "mocked", "remediationSteps": ["step1"]}' }],
          usage: { input_tokens: 10, output_tokens: 10 }
        })
      });

      try {
        const service = new AiGatewayService(mockDb, mockConfig);
        const res = await service.explainFinding(
          {
            ruleId: 'CUSTOM_FIELD_BINDING_BROKEN',
            category: 'Extensibility',
            title: 'Missing CDS field',
            description: 'Field removed',
            affectedObjects: ['YY1_FIELD'],
          },
          { tenantId, preferredProvider: 'ANTHROPIC' }
        );

        expect(res.confidenceScore).toBeLessThanOrEqual(0.60);
        expect(res.confidenceClass).toBe('INFERRED');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('deterministically classifies intent for Adobe Form XDP files', async () => {
      const service = new AiGatewayService(mockDb, mockConfig);
      const res = await service.classifyIntent(
        {
          problemDescription: 'Check output formatting and font rendering',
          artifactFilenames: ['purchase_order.xdp'],
        },
        { tenantId, dataPolicy: { deterministicOnly: true } }
      );

      expect(res.deterministicBypass).toBe(true);
      expect(res.recommendedEngines[0].engine).toBe('FORM_DOCTOR');
      expect(res.confidenceScore).toBeLessThanOrEqual(0.60);
    });
  });

});
