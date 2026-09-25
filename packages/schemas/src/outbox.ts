import { z } from 'zod';

export const OutboxEventStatusEnum = z.enum(['PENDING', 'DISPATCHED', 'FAILED']);
export type OutboxEventStatus = z.infer<typeof OutboxEventStatusEnum>;

export const DomainEventOutboxSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  eventType: z.string(),
  aggregateType: z.enum(['ANALYSIS', 'FINDING', 'PROJECT', 'CHANGE_SET', 'AGENT_PROPOSAL']),
  aggregateId: z.string().uuid(),
  payload: z.record(z.any()),
  status: OutboxEventStatusEnum.default('PENDING'),
  attempts: z.number().int().default(0),
  maxAttempts: z.number().int().default(5),
  lastAttemptAt: z.string().datetime().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  dispatchedAt: z.string().datetime().nullable().optional(),
});
export type DomainEventOutbox = z.infer<typeof DomainEventOutboxSchema>;
