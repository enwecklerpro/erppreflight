import { SetMetadata } from '@nestjs/common';
import type { UsageMetric } from '@erppreflight/schemas';

export const METERED_KEY = 'erppreflight:metered';

export interface MeteredContext {
  request: any;
  result: any;
}

export interface MeterSpec {
  metric: UsageMetric;
  /** Quantity to record; return 0/null to skip (e.g. presign-only responses). */
  quantity?: (ctx: MeteredContext) => number | null | undefined;
  resourceType?: string;
  resourceId?: (ctx: MeteredContext) => string | null | undefined;
  metadata?: (ctx: MeteredContext) => Record<string, unknown>;
}

/**
 * Declares that a successful call of this route consumes metered usage.
 * Recorded by UsageInterceptor after the handler succeeds.
 */
export const Metered = (...specs: MeterSpec[]) => SetMetadata(METERED_KEY, specs);
