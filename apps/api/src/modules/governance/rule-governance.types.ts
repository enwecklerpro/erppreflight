import { z } from 'zod';

/** Rule Admin lifecycle (spec 10.10). Governance state is metadata: it never changes engine output. */
export const RULE_STATUSES = ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'DEPRECATED'] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

export const RULE_TRANSITIONS: Record<RuleStatus, readonly RuleStatus[]> = {
  DRAFT: ['IN_REVIEW', 'DEPRECATED'],
  IN_REVIEW: ['PUBLISHED', 'DRAFT', 'DEPRECATED'],
  PUBLISHED: ['IN_REVIEW', 'DEPRECATED'],
  DEPRECATED: ['DRAFT'],
};

export function canTransitionRule(from: RuleStatus, to: RuleStatus): boolean {
  return RULE_TRANSITIONS[from].includes(to);
}

export const RuleCodeSchema = z
  .string()
  .regex(/^[A-Z0-9_]{3,120}$/, 'rule codes are upper-case identifiers (A-Z, 0-9, _)');

const PersonSchema = z.string().trim().min(2).max(200).nullable();

export const UpdateRuleGovernanceSchema = z
  .object({
    author: PersonSchema.optional(),
    reviewer: PersonSchema.optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'at least one of author, reviewer or notes is required');
export type UpdateRuleGovernanceInput = z.infer<typeof UpdateRuleGovernanceSchema>;

export const RuleTransitionSchema = z
  .object({
    to: z.enum(RULE_STATUSES),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
export type RuleTransitionInput = z.infer<typeof RuleTransitionSchema>;

export const RuleListQuerySchema = z
  .object({
    engine: z.string().regex(/^[A-Z0-9_]{2,64}$/).optional(),
    status: z.enum(RULE_STATUSES).optional(),
  })
  .strict();

/** Why a rule cannot be published right now (null = publishable). */
export type PublishBlocker =
  | 'COVERAGE_GAP'
  | 'NO_SELF_TEST'
  | 'SELF_TEST_NOT_PASSED'
  | 'SELF_TEST_OUTDATED'
  | 'REVIEWER_REQUIRED'
  | 'NOT_IN_REVIEW';

export interface LatestSelfTest {
  id: string;
  status: 'PASSED' | 'FAILED' | 'NO_FIXTURES' | 'ERROR';
  ruleVersion: string;
  resultDigest: string | null;
  positiveCount: number;
  negativeCount: number;
  createdAt: string;
}

/**
 * Pure publish-gate decision (spec 10.10 "Publishing requires tests to pass"):
 * the rule must have golden coverage, the latest self-test must be PASSED and must
 * have run against the rule version currently declared by the engine, and a reviewer
 * must be named.
 */
export function publishBlocker(p: {
  status: RuleStatus;
  currentVersion: string | null;
  covered: boolean;
  reviewer: string | null;
  latest: LatestSelfTest | null;
}): PublishBlocker | null {
  if (p.status !== 'IN_REVIEW') return 'NOT_IN_REVIEW';
  if (!p.covered) return 'COVERAGE_GAP';
  if (!p.latest) return 'NO_SELF_TEST';
  if (p.latest.ruleVersion !== p.currentVersion) return 'SELF_TEST_OUTDATED';
  if (p.latest.status !== 'PASSED') return 'SELF_TEST_NOT_PASSED';
  if (!p.reviewer) return 'REVIEWER_REQUIRED';
  return null;
}
