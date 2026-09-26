import { z } from 'zod';
import { CLOUDIFICATION_ADAPTER_ID, ROSA_FILE_ADAPTER_ID } from '../knowledge-graph/knowledge-graph.types';

export const AdapterIdSchema = z.string().regex(/^[A-Z0-9_]{3,64}$/, 'adapter ids are upper-case identifiers');

export const SourceSettingsSchema = z
  .object({
    critical: z.boolean(),
    freshnessThresholdHours: z.number().int().min(1).max(8760),
    alertsEnabled: z.boolean(),
  })
  .strict();
export type SourceSettingsInput = z.infer<typeof SourceSettingsSchema>;

export interface AdapterDefaults {
  title: string;
  /** Whether an admin can re-run the adapter from the UI (file imports need a new upload). */
  retriable: boolean;
  critical: boolean;
  freshnessThresholdHours: number;
}

/**
 * Known knowledge source adapters (Part 04 §4.7). The Cloudification Repository is the
 * critical official source: synced weekly (KNOWLEDGE_SYNC_CRON), stale after 8 days by
 * default. ROSA exports are optional customer-provided file imports.
 */
export const ADAPTER_DEFAULTS: Record<string, AdapterDefaults> = {
  [CLOUDIFICATION_ADAPTER_ID]: {
    title: 'SAP Cloudification Repository',
    retriable: true,
    critical: true,
    freshnessThresholdHours: 192,
  },
  [ROSA_FILE_ADAPTER_ID]: {
    title: 'ROSA export (file import)',
    retriable: false,
    critical: false,
    freshnessThresholdHours: 720,
  },
};

export function adapterDefaults(adapterId: string): AdapterDefaults {
  return ADAPTER_DEFAULTS[adapterId] ?? { title: adapterId, retriable: false, critical: false, freshnessThresholdHours: 192 };
}

export type FreshnessState = 'FRESH' | 'STALE' | 'NEVER_SYNCED';

/** Pure freshness decision: age of the last successful (PUBLISHED or NOOP) sync against the threshold. */
export function freshnessOf(lastSuccessAt: Date | null, thresholdHours: number, now: Date): { state: FreshnessState; ageHours: number | null } {
  if (!lastSuccessAt) return { state: 'NEVER_SYNCED', ageHours: null };
  const ageHours = Math.max(0, (now.getTime() - lastSuccessAt.getTime()) / 3_600_000);
  return { state: ageHours > thresholdHours ? 'STALE' : 'FRESH', ageHours: Math.round(ageHours * 100) / 100 };
}

export type AlertDecision = 'OPEN' | 'RESOLVE' | 'KEEP' | 'NONE';

/** Whether the freshness check must open, resolve or keep a stale alert (idempotent). */
export function alertDecision(p: {
  critical: boolean;
  alertsEnabled: boolean;
  state: FreshnessState;
  hasOpenAlert: boolean;
}): AlertDecision {
  const shouldAlert = p.critical && p.alertsEnabled && p.state !== 'FRESH';
  if (shouldAlert) return p.hasOpenAlert ? 'KEEP' : 'OPEN';
  return p.hasOpenAlert ? 'RESOLVE' : 'NONE';
}
