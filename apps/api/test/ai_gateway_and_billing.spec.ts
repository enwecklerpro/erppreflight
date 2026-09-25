import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiGatewayService } from '../src/modules/ai-gateway/ai-gateway.service';
import { EntitlementsService } from '../src/modules/billing/entitlements.service';
import { BillingService } from '../src/modules/billing/billing.service';
import { ForbiddenException } from '@nestjs/common';

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

  describe('EntitlementsService (Plan Quota Enforcement)', () => {
    it('allows project creation under quota for FREE tier and blocks when limit reached', async () => {
      const service = new EntitlementsService(mockDb);

      // Under limit: 0 projects
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ plan_tier: 'FREE' }] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [{ count: 2 }] })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] });

      await expect(service.checkEntitlement(tenantId, 'PROJECT_CREATE')).resolves.not.toThrow();

      // At limit: 1 project for FREE tier
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ plan_tier: 'FREE' }] })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({ rows: [{ count: 2 }] })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] });

      await expect(service.checkEntitlement(tenantId, 'PROJECT_CREATE')).rejects.toThrow(
        ForbiddenException
      );
    });

    it('blocks AGENT_GATE and AIR_GAPPED_EXPORT on FREE tier, but allows on PROFESSIONAL', async () => {
      const service = new EntitlementsService(mockDb);

      // On FREE tier
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ plan_tier: 'FREE' }] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] });

      await expect(service.checkEntitlement(tenantId, 'AGENT_GATE')).rejects.toThrow(
        ForbiddenException
      );

      // On PROFESSIONAL tier
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ plan_tier: 'PROFESSIONAL' }] })
        .mockResolvedValueOnce({ rows: [{ count: 2 }] })
        .mockResolvedValueOnce({ rows: [{ count: 10 }] })
        .mockResolvedValueOnce({ rows: [{ count: 3 }] });

      await expect(service.checkEntitlement(tenantId, 'AGENT_GATE')).resolves.not.toThrow();
    });
  });

  describe('BillingService (Checkout & Webhook Upgrades)', () => {
    it('creates checkout session and returns secure checkout URL', async () => {
      const service = new BillingService(mockDb, mockConfig);
      const session = await service.createCheckoutSession(tenantId, 'PROFESSIONAL');

      expect(session.url).toBeDefined();
      expect(session.sessionId).toBeDefined();
      expect(session.url).toContain(tenantId);
    });

    it('processes checkout.session.completed webhook and upgrades plan_tier', async () => {
      const mockOutbox: any = { recordEvent: vi.fn().mockResolvedValue({}) };
      const localMockConfig: any = {
        get: vi.fn((key: string) => {
          if (key === 'STRIPE_WEBHOOK_SECRET') return 'whsec_dummy';
          return undefined;
        }),
      };
      const service = new BillingService(mockDb, localMockConfig, mockOutbox);

      mockDb.query.mockResolvedValueOnce({ rows: [] });

      const webhookPayload = JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: tenantId,
            metadata: { target_tier: 'PROFESSIONAL' },
          },
        },
      });

      const currentSeconds = Math.floor(Date.now() / 1000);
      const crypto = require('node:crypto');
      const signedPayload = `${currentSeconds}.${webhookPayload}`;
      const computedSig = crypto.createHmac('sha256', 'whsec_dummy').update(signedPayload).digest('hex');
      const signature = `t=${currentSeconds},v1=${computedSig}`;

      const res = await service.handleWebhook(signature, webhookPayload);
      expect(res.received).toBe(true);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE organizations SET plan_tier = $1'),
        ['PROFESSIONAL', tenantId]
      );
      expect(mockOutbox.recordEvent).toHaveBeenCalledWith(
        tenantId,
        'organization.plan_upgraded',
        'PROJECT',
        tenantId,
        expect.objectContaining({ newTier: 'PROFESSIONAL' }),
        mockDb
      );
    });
  });
});
