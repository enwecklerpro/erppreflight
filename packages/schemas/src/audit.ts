import { z } from 'zod';

export const ActorTypeEnum = z.enum(['HUMAN', 'AI_AGENT', 'API_KEY', 'SYSTEM']);
export type ActorType = z.infer<typeof ActorTypeEnum>;

export const AuditEventWireSchema = z.object({
  id: z.string().uuid(),
  sequenceNum: z.coerce.number().int().positive().optional(),
  organizationId: z.string().uuid(),
  actorType: ActorTypeEnum.default('SYSTEM'),
  actorId: z.string().uuid().nullable().optional(),
  actorMetadata: z.record(z.unknown()).default({}),
  action: z.string().min(1),
  resourceType: z.string().min(1).default('SYSTEM'),
  resourceId: z.string().uuid().nullable().optional(),
  payload: z.record(z.unknown()).default({}),
  clientIp: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  prevHash: z.string().regex(/^[a-fA-F0-9]{64}$/),
  currentHash: z.string().regex(/^[a-fA-F0-9]{64}$/),
  createdAt: z.string(),
});
export type AuditEventWire = z.infer<typeof AuditEventWireSchema>;

export const LedgerAnomalyTypeEnum = z.enum([
  'BROKEN_CHAIN_LINK',
  'CORRUPTED_PAYLOAD',
  'TIMESTAMP_ANACHRONISM',
  'MISSING_GENESIS_PREV_HASH',
  'GAP_DETECTED',
]);
export type LedgerAnomalyType = z.infer<typeof LedgerAnomalyTypeEnum>;

export const LedgerAnomalySchema = z.object({
  anomalyType: LedgerAnomalyTypeEnum,
  eventIndex: z.number().int().nonnegative(),
  eventId: z.string(),
  expectedValue: z.string(),
  actualValue: z.string(),
  details: z.record(z.unknown()).default({}),
});
export type LedgerAnomaly = z.infer<typeof LedgerAnomalySchema>;

export const TamperDetectionResultSchema = z.object({
  isValid: z.boolean(),
  totalEventsVerified: z.number().int().nonnegative(),
  genesisEventId: z.string().nullable().optional(),
  tipEventId: z.string().nullable().optional(),
  anomalies: z.array(LedgerAnomalySchema),
  verifiedAt: z.string(),
});
export type TamperDetectionResult = z.infer<typeof TamperDetectionResultSchema>;
