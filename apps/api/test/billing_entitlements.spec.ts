import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as nodeCrypto from 'node:crypto';
import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { PLAN_CATALOG, PLAN_TIERS } from '@erppreflight/schemas';
import { EntitlementsService, resolvePlanState } from '../src/modules/billing/entitlements.service';
import { BillingService, mapStripeStatus } from '../src/modules/billing/billing.service';
import { PlanLimitExceededException } from '../src/modules/billing/plan-limit.exception';

const tenantId = '00000000-0000-4000-8000-000000000001';

/** Routes SQL text to canned rows so tests do not depend on query order. */
function routedDb(state: { org: any; projects?: number; landscapes?: number; members?: number }) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM organizations WHERE id')) return { rows: [state.org] };
      if (sql.includes('UPDATE organizations')) return { rows: [] };
      if (sql.includes('FROM projects')) return { rows: [{ count: state.projects ?? 0 }] };
      if (sql.includes('FROM landscapes')) return { rows: [{ count: state.landscapes ?? 0 }] };
      if (sql.includes('FROM organization_members')) return { rows: [{ count: state.members ?? 1 }] };
      return { rows: [] };
    }),
  } as any;
}

function usageStub(usage: Record<string, number> = {}, stored = 0) {
  return {
    getTotalsSince: vi.fn(async () => ({
      ANALYSIS_RUN: 0,
      ENGINE_EXECUTION: 0,
      ARTIFACT_UPLOAD: 0,
      ARTIFACT_BYTES: 0,
      REPORT_EXPORT: 0,
      AI_TOKENS: 0,
      ...usage,
    })),
    getStoredBytes: vi.fn(async () => stored),
  } as any;
}

const noTrial = { get: (k: string) => (k === 'TRIAL_DAYS' ? 0 : undefined) } as any;

describe('Plan catalog (@erppreflight/schemas plans.ts)', () => {
  it('defines every tier with all limit keys and no invented contact-sales prices', () => {
    for (const tier of PLAN_TIERS) {
      const plan = PLAN_CATALOG[tier];
      expect(plan.tier).toBe(tier);
      expect(Object.keys(plan.limits).sort()).toEqual(
        ['aiTokensPerMonth', 'analysesPerMonth', 'exportsPerMonth', 'landscapes', 'projects', 'storageBytes', 'teamMembers'].sort()
      );
      if (!plan.selfServe && tier !== 'FREE') expect(plan.monthlyPriceEur).toBeNull();
    }
  });
});

describe('EntitlementsService (plan quota enforcement)', () => {
  it('allows project creation under quota for FREE and returns 402 PLAN_LIMIT_EXCEEDED at the limit', async () => {
    await expect(
      new EntitlementsService(routedDb({ org: { plan_tier: 'FREE' }, projects: 0 }), usageStub(), noTrial).checkEntitlement(
        tenantId,
        'PROJECT_CREATE'
      )
    ).resolves.not.toThrow();

    const err = await new EntitlementsService(routedDb({ org: { plan_tier: 'FREE' }, projects: 1 }), usageStub(), noTrial)
      .checkEntitlement(tenantId, 'PROJECT_CREATE')
      .catch((e) => e);
    expect(err).toBeInstanceOf(PlanLimitExceededException);
    expect(err.getStatus()).toBe(402);
    expect(err.getResponse()).toMatchObject({ code: 'PLAN_LIMIT_EXCEEDED', limitKey: 'projects', used: 1, limit: 1 });
  });

  it('meters monthly analyses from the usage ledger and honours per-tenant overrides', async () => {
    const svc = new EntitlementsService(
      routedDb({ org: { plan_tier: 'PROFESSIONAL', limit_overrides: { analysesPerMonth: 1 } } }),
      usageStub({ ANALYSIS_RUN: 1 }),
      noTrial
    );
    const usage = await svc.getTenantUsage(tenantId);
    expect(usage.limits.limits.analysesPerMonth).toBe(1);
    expect(usage.hasLimitOverrides).toBe(true);
    expect(usage.meters.find((m) => m.key === 'analysesPerMonth')).toMatchObject({ used: 1, limit: 1, exceeded: true });
    await expect(svc.checkEntitlement(tenantId, 'RUN_ANALYSIS')).rejects.toBeInstanceOf(PlanLimitExceededException);
  });

  it('enforces storage and monthly export quotas', async () => {
    const storage = new EntitlementsService(
      routedDb({ org: { plan_tier: 'FREE' } }),
      usageStub({}, PLAN_CATALOG.FREE.limits.storageBytes),
      noTrial
    );
    await expect(storage.checkEntitlement(tenantId, 'UPLOAD_ARTIFACT')).rejects.toMatchObject({
      response: expect.objectContaining({ limitKey: 'storageBytes' }),
    });
    const exports = new EntitlementsService(
      routedDb({ org: { plan_tier: 'FREE' } }),
      usageStub({ REPORT_EXPORT: PLAN_CATALOG.FREE.limits.exportsPerMonth }),
      noTrial
    );
    await expect(exports.checkEntitlement(tenantId, 'EXPORT_REPORT')).rejects.toBeInstanceOf(PlanLimitExceededException);
  });

  it('blocks AGENT_GATE (403) on FREE tier, but allows on PROFESSIONAL', async () => {
    await expect(
      new EntitlementsService(routedDb({ org: { plan_tier: 'FREE' } }), usageStub(), noTrial).checkEntitlement(tenantId, 'AGENT_GATE')
    ).rejects.toThrow(ForbiddenException);
    await expect(
      new EntitlementsService(routedDb({ org: { plan_tier: 'PROFESSIONAL' } }), usageStub(), noTrial).checkEntitlement(
        tenantId,
        'AGENT_GATE'
      )
    ).resolves.not.toThrow();
  });

  it('enforces the team member limit (402) when inviting beyond the plan', async () => {
    const atLimit = new EntitlementsService(
      routedDb({ org: { plan_tier: 'FREE' }, members: PLAN_CATALOG.FREE.limits.teamMembers }),
      usageStub(),
      noTrial
    );
    await expect(atLimit.checkEntitlement(tenantId, 'ADD_TEAM_MEMBER')).rejects.toMatchObject({
      limitKey: 'teamMembers',
      used: PLAN_CATALOG.FREE.limits.teamMembers,
    });
    await expect(
      new EntitlementsService(routedDb({ org: { plan_tier: 'FREE' }, members: 1 }), usageStub(), noTrial).checkEntitlement(
        tenantId,
        'ADD_TEAM_MEMBER'
      )
    ).resolves.not.toThrow();
  });

  it('enforces the monthly AI token limit from the usage ledger', async () => {
    const svc = new EntitlementsService(
      routedDb({ org: { plan_tier: 'PROFESSIONAL', limit_overrides: { aiTokensPerMonth: 1000 } } }),
      usageStub({ AI_TOKENS: 1000 }),
      noTrial
    );
    await expect(svc.checkEntitlement(tenantId, 'AI_TOKENS')).rejects.toMatchObject({ limitKey: 'aiTokensPerMonth', used: 1000 });
  });

  it('gates plan features: Cloud ALM sync, air-gapped export and What-If simulation', async () => {
    const free = new EntitlementsService(routedDb({ org: { plan_tier: 'FREE' } }), usageStub(), noTrial);
    await expect(free.checkEntitlement(tenantId, 'CLOUD_ALM_SYNC')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(free.checkEntitlement(tenantId, 'AIR_GAPPED_EXPORT')).rejects.toBeInstanceOf(ForbiddenException);
    const expectWhatIf = PLAN_CATALOG.FREE.features.whatIfSimulation
      ? expect(free.checkEntitlement(tenantId, 'WHAT_IF_SIMULATION')).resolves.not.toThrow()
      : expect(free.checkEntitlement(tenantId, 'WHAT_IF_SIMULATION')).rejects.toBeInstanceOf(ForbiddenException);
    await expectWhatIf;
    const pro = new EntitlementsService(routedDb({ org: { plan_tier: 'PROFESSIONAL' } }), usageStub(), noTrial);
    if (PLAN_CATALOG.PROFESSIONAL.features.cloudAlmSync) {
      await expect(pro.checkEntitlement(tenantId, 'CLOUD_ALM_SYNC')).resolves.not.toThrow();
    }
  });

  it('starts the trial anchored at organization creation and audits it', async () => {
    const created = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const trialEnds = new Date(Date.parse(created) + 14 * 86_400_000).toISOString();
    const db: any = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('UPDATE organizations')) {
          return {
            rows: [
              {
                plan_tier: 'FREE',
                subscription_status: 'NONE',
                trial_tier: 'PROFESSIONAL',
                trial_started_at: created,
                trial_ends_at: trialEnds,
                created_at: created,
              },
            ],
          };
        }
        if (sql.includes('FROM organizations WHERE id')) {
          return { rows: [{ plan_tier: 'FREE', subscription_status: 'NONE', created_at: created }] };
        }
        return { rows: [{ count: 0 }] };
      }),
    };
    const audit: any = { recordSafe: vi.fn().mockResolvedValue(true) };
    const svc = new EntitlementsService(db, usageStub(), { get: () => undefined } as any, audit);
    const state = await svc.getPlanState(tenantId);
    expect(state.effectiveTier).toBe('PROFESSIONAL');
    expect(state.trial.active).toBe(true);
    expect(state.trial.daysRemaining).toBe(12);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('trial_started_at = created_at'), [tenantId, 'PROFESSIONAL', 14], {
      bypassRls: true,
    });
    expect(audit.recordSafe).toHaveBeenCalledWith(expect.objectContaining({ action: 'billing.trial.started' }));
  });
});

describe('resolvePlanState (trial expiry, downgrade, subscription status)', () => {
  const now = new Date('2026-09-26T00:00:00Z');

  it('downgrades to plan_tier once the trial has expired', () => {
    const s = resolvePlanState({ plan_tier: 'FREE', trial_tier: 'PROFESSIONAL', trial_ends_at: '2026-09-25T00:00:00Z' }, now);
    expect(s.trial.active).toBe(false);
    expect(s.effectiveTier).toBe('FREE');
    expect(s.limits.limits.projects).toBe(1);
  });

  it('ignores the trial while a paid subscription is active', () => {
    const s = resolvePlanState(
      { plan_tier: 'STARTER', subscription_status: 'ACTIVE', trial_tier: 'PROFESSIONAL', trial_ends_at: '2026-10-25T00:00:00Z' },
      now
    );
    expect(s.effectiveTier).toBe('STARTER');
    expect(s.trial.active).toBe(false);
  });

  it('never lets a trial lower a higher assigned tier', () => {
    const s = resolvePlanState({ plan_tier: 'ENTERPRISE', trial_tier: 'PROFESSIONAL', trial_ends_at: '2026-10-25T00:00:00Z' }, now);
    expect(s.effectiveTier).toBe('ENTERPRISE');
    expect(s.trial.active).toBe(false);
  });

  it('rejects malformed overrides instead of applying them', () => {
    const s = resolvePlanState({ plan_tier: 'FREE', limit_overrides: { projects: 'lots' } }, now);
    expect(s.limits.limits.projects).toBe(1);
    expect(s.hasLimitOverrides).toBe(false);
  });
});

describe('BillingService checkout / provider selection', () => {
  let db: any;
  beforeEach(() => {
    db = { query: vi.fn().mockResolvedValue({ rows: [{ plan_tier: 'FREE', subscription_status: 'NONE' }] }) };
    db.withTenantTransaction = vi.fn(async (_t: string, cb: any) => cb(db));
  });

  it('reports "billing not configured" (503) without a provider', async () => {
    const service = new BillingService(db, { get: vi.fn() } as any);
    expect(service.providerInfo()).toEqual({ configured: false, name: 'none', checkoutAvailable: false, portalAvailable: false });
    await expect(service.createCheckoutSession(tenantId, 'PROFESSIONAL')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.listInvoices(tenantId)).resolves.toEqual({ configured: false, invoices: [] });
  });

  it('local provider (non-production) applies the subscription through the audited transition', async () => {
    const audit: any = { recordEvent: vi.fn().mockResolvedValue({}) };
    const config: any = {
      get: vi.fn((k: string) => (k === 'BILLING_PROVIDER' ? 'local' : k === 'CORS_ORIGIN' ? 'http://localhost:3300' : undefined)),
    };
    const service = new BillingService(db, config, undefined, audit);
    const session = await service.createCheckoutSession(tenantId, 'PROFESSIONAL');
    expect(session.url).toContain('http://localhost:3300/settings/billing');
    expect(session.url).toContain('provider=local');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE organizations SET plan_tier = $2'),
      expect.arrayContaining([tenantId, 'PROFESSIONAL', 'ACTIVE'])
    );
    expect(audit.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.subscription.changed',
        payload: expect.objectContaining({ newTier: 'PROFESSIONAL', source: 'local_checkout' }),
      })
    );
  });

  it('refuses the local provider in production', () => {
    const config: any = { get: vi.fn((k: string) => (k === 'BILLING_PROVIDER' ? 'local' : k === 'NODE_ENV' ? 'production' : undefined)) };
    expect(new BillingService(db, config).providerInfo().configured).toBe(false);
  });

  it('rejects contact-sales tiers at checkout', async () => {
    const config: any = { get: vi.fn((k: string) => (k === 'BILLING_PROVIDER' ? 'local' : undefined)) };
    await expect(new BillingService(db, config).createCheckoutSession(tenantId, 'ENTERPRISE')).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('stripe provider sends subscription checkout with tenant metadata and configured price', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' })));
    const original = global.fetch;
    global.fetch = fetchMock as any;
    try {
      const config: any = {
        get: vi.fn((k: string) =>
          k === 'STRIPE_SECRET_KEY' ? 'sk_test_x' : k === 'CORS_ORIGIN' ? 'https://erppreflight.com' : undefined
        ),
      };
      const out = await new BillingService(db, config).createCheckoutSession(tenantId, 'STARTER');
      expect(out).toEqual({ url: 'https://checkout.stripe.com/c/cs_1', sessionId: 'cs_1' });
      const [url, init] = fetchMock.mock.calls[0] as any[];
      expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
      const form = new URLSearchParams(init.body);
      expect(form.get('mode')).toBe('subscription');
      expect(form.get('metadata[organization_id]')).toBe(tenantId);
      expect(form.get('subscription_data[metadata][target_tier]')).toBe('STARTER');
      expect(form.get('line_items[0][price_data][unit_amount]')).toBe(String((PLAN_CATALOG.STARTER.monthlyPriceEur ?? 0) * 100));
      expect(init.headers['Idempotency-Key']).toMatch(/^checkout:/);
    } finally {
      global.fetch = original;
    }
  });
});

describe('BillingService webhooks (locally signed Stripe payloads)', () => {
  const secret = 'whsec_dummy';
  const sign = (body: string, t = Math.floor(Date.now() / 1000)) =>
    `t=${t},v1=${nodeCrypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

  function webhookFixture(orgRow: any = { plan_tier: 'FREE', subscription_status: 'NONE' }) {
    const processed = new Set<string>();
    const updates: Array<{ sql: string; params: any[] }> = [];
    const db: any = {
      query: vi.fn(async (sql: string, params: any[] = []) => {
        if (sql.includes('FROM billing_events')) return { rows: processed.has(params[0]) ? [{ one: 1 }] : [] };
        if (sql.includes('INSERT INTO billing_events')) {
          processed.add(params[0]);
          return { rows: [] };
        }
        if (sql.includes('WHERE stripe_customer_id = $1')) return { rows: params[0] === 'cus_123' ? [{ id: tenantId }] : [] };
        if (sql.includes('UPDATE organizations')) {
          updates.push({ sql, params });
          return { rows: [] };
        }
        if (sql.includes('FROM organizations')) return { rows: [orgRow] };
        return { rows: [] };
      }),
    };
    db.withTenantTransaction = vi.fn(async (_t: string, cb: any) => cb(db));
    const outbox: any = { recordEvent: vi.fn().mockResolvedValue({}) };
    const audit: any = { recordEvent: vi.fn().mockResolvedValue({}) };
    const config: any = { get: vi.fn((k: string) => (k === 'STRIPE_WEBHOOK_SECRET' ? secret : undefined)) };
    return { db, outbox, audit, updates, service: new BillingService(db, config, outbox, audit) };
  }

  it('checkout.session.completed upgrades plan_tier, stores the customer and emits outbox + audit', async () => {
    const f = webhookFixture();
    const body = JSON.stringify({
      id: 'evt_checkout_1',
      type: 'checkout.session.completed',
      data: {
        object: { client_reference_id: tenantId, customer: 'cus_123', subscription: 'sub_1', metadata: { target_tier: 'PROFESSIONAL' } },
      },
    });
    await expect(f.service.handleWebhook(sign(body), body)).resolves.toMatchObject({ received: true, handled: true });
    expect(f.updates[0].params).toEqual([tenantId, 'PROFESSIONAL', 'ACTIVE', 'cus_123', 'sub_1']);
    expect(f.outbox.recordEvent).toHaveBeenCalledWith(
      tenantId,
      'organization.plan_changed',
      'PROJECT',
      tenantId,
      expect.objectContaining({ newTier: 'PROFESSIONAL', previousTier: 'FREE' }),
      f.db
    );
    expect(f.audit.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.subscription.changed',
        payload: expect.objectContaining({ providerEventId: 'evt_checkout_1' }),
      })
    );
  });

  it('is idempotent per Stripe event id', async () => {
    const f = webhookFixture();
    const body = JSON.stringify({
      id: 'evt_dup',
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: tenantId, metadata: { target_tier: 'STARTER' } } },
    });
    await f.service.handleWebhook(sign(body), body);
    await expect(f.service.handleWebhook(sign(body), body)).resolves.toEqual({ received: true, duplicate: true });
    expect(f.updates).toHaveLength(1);
  });

  it('customer.subscription.updated maps status, tier, period end and cancel flag', async () => {
    const f = webhookFixture();
    const body = JSON.stringify({
      id: 'evt_sub_upd',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_9',
          customer: 'cus_123',
          status: 'active',
          cancel_at_period_end: true,
          current_period_end: 1893456000,
          metadata: { organization_id: tenantId, target_tier: 'STARTER' },
        },
      },
    });
    await f.service.handleWebhook(sign(body), body);
    const { sql, params } = f.updates[0];
    expect(sql).toContain('subscription_status');
    expect(params).toEqual([tenantId, 'STARTER', 'ACTIVE', 'cus_123', 'sub_9', '2030-01-01T00:00:00.000Z', true]);
  });

  it('customer.subscription.deleted downgrades to FREE / CANCELED', async () => {
    const f = webhookFixture({ plan_tier: 'PROFESSIONAL', subscription_status: 'ACTIVE' });
    const body = JSON.stringify({
      id: 'evt_sub_del',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_9', customer: 'cus_123', status: 'canceled', metadata: { organization_id: tenantId } } },
    });
    await f.service.handleWebhook(sign(body), body);
    expect(f.updates[0].params).toEqual([tenantId, 'FREE', 'CANCELED', null, false]);
  });

  it('invoice.payment_failed marks the subscription PAST_DUE (looked up by customer)', async () => {
    const f = webhookFixture({ plan_tier: 'PROFESSIONAL', subscription_status: 'ACTIVE' });
    const body = JSON.stringify({ id: 'evt_inv_fail', type: 'invoice.payment_failed', data: { object: { customer: 'cus_123' } } });
    await f.service.handleWebhook(sign(body), body);
    expect(f.updates[0].params).toEqual([tenantId, 'PAST_DUE']);
  });

  it('rejects stale timestamps and bad signatures before touching state', async () => {
    const f = webhookFixture();
    const body = JSON.stringify({ id: 'evt_x', type: 'invoice.payment_failed', data: { object: { customer: 'cus_123' } } });
    await expect(f.service.handleWebhook(sign(body, Math.floor(Date.now() / 1000) - 3600), body)).rejects.toBeInstanceOf(
      BadRequestException
    );
    await expect(
      f.service.handleWebhook(`t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`, body)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(f.updates).toHaveLength(0);
  });

  it('maps Stripe subscription statuses', () => {
    expect(mapStripeStatus('trialing')).toBe('TRIALING');
    expect(mapStripeStatus('past_due')).toBe('PAST_DUE');
    expect(mapStripeStatus('incomplete_expired')).toBe('INCOMPLETE');
    expect(mapStripeStatus('weird')).toBe('NONE');
  });
});
