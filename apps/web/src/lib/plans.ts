import { PLAN_CATALOG, PLAN_TIERS, type PlanTierId } from '@erppreflight/schemas';
import { PlanCatalogEntrySchema, type PlanCatalogEntry } from './api/commercial';
import { serverApiBase } from './knowledge';
import { z } from 'zod';

/**
 * Plans for the public pricing page and structured data.
 *
 * Source: the API's public plan catalog (`GET /api/v1/billing/plans`), which is
 * PLAN_CATALOG from @erppreflight/schemas with deployment-configured prices
 * (PLAN_PRICE_EUR_<TIER>). If the API cannot be reached, the catalog's limits and
 * features are shown but prices are withheld ("Contact sales"), because the
 * deployment may override the catalog defaults. Prices are never invented here.
 */
export type PublicPlan = PlanCatalogEntry;
export type { PlanTierId };

const PlansSchema = z.object({ plans: z.array(PlanCatalogEntrySchema) });

export interface PublicPlansResult {
  plans: PublicPlan[];
  /** 'api' = live catalog incl. configured prices; 'catalog' = fallback without prices. */
  source: 'api' | 'catalog';
}

export function catalogFallbackPlans(): PublicPlan[] {
  return PLAN_TIERS.map((tier) => {
    const plan = PLAN_CATALOG[tier];
    return {
      ...plan,
      limits: { ...plan.limits },
      features: { ...plan.features },
      monthlyPriceEur: null,
      purchasable: false,
    };
  });
}

export async function fetchPublicPlans(): Promise<PublicPlansResult> {
  try {
    const res = await fetch(`${serverApiBase()}/api/v1/billing/plans`, {
      headers: { accept: 'application/json' },
      next: { revalidate: 300, tags: ['plans'] },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = PlansSchema.safeParse(await res.json());
    if (!parsed.success || parsed.data.plans.length === 0) throw new Error('unexpected payload');
    return { plans: parsed.data.plans, source: 'api' };
  } catch {
    return { plans: catalogFallbackPlans(), source: 'catalog' };
  }
}
