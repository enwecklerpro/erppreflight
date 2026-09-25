import { z } from 'zod';
import { SeverityEnum } from './common';

export const ChangeSetStatusEnum = z.enum([
  'DRAFT',
  'PREFLIGHT_RUNNING',
  'FAILED_PREFLIGHT',
  'READY_FOR_REVIEW',
  'APPROVED',
  'REJECTED',
  'IMPLEMENTED',
  'VERIFIED',
  'CLOSED',
]);
export type ChangeSetStatus = z.infer<typeof ChangeSetStatusEnum>;

export const ProposedChangeItemSchema = z.object({
  id: z.string().uuid().optional(),
  objectName: z.string().min(1),
  objectType: z.string().min(1), // PROG, CLAS, TABL, VIEW, CDS, BRFPLUS, FORM
  action: z.enum(['CREATE', 'MODIFY', 'DELETE', 'REPLACE', 'DEPRECATE']),
  description: z.string().optional(),
  currentSnippet: z.string().optional(),
  proposedSnippet: z.string().optional(),
  metadata: z.record(z.any()).optional().default({}),
});
export type ProposedChangeItem = z.infer<typeof ProposedChangeItemSchema>;

export const SimulationDiffFindingSchema = z.object({
  ruleId: z.string(),
  title: z.string(),
  severity: SeverityEnum,
  affectedObject: z.string(),
  description: z.string(),
  remediation: z.string(),
});
export type SimulationDiffFinding = z.infer<typeof SimulationDiffFindingSchema>;

export const SimulationDiffSchema = z.object({
  status: z.enum(['NOT_SIMULATED', 'SIMULATING', 'CLEAR', 'REGRESSION_DETECTED', 'ERROR']),
  beforeFindingsCount: z.number().int().nonnegative().default(0),
  afterFindingsCount: z.number().int().nonnegative().default(0),
  newFindings: z.array(SimulationDiffFindingSchema).default([]),
  resolvedFindings: z.array(SimulationDiffFindingSchema).default([]),
  riskDelta: z.enum(['IMPROVED', 'NEUTRAL', 'DEGRADED', 'CRITICAL_RISK']).default('NEUTRAL'),
  requiredRegressionTests: z.array(z.string()).default([]),
  impactedDependencies: z.array(z.string()).default([]),
  simulatedAt: z.string().datetime().optional(),
});
export type SimulationDiff = z.infer<typeof SimulationDiffSchema>;

export const ChangeSetSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string().min(3),
  description: z.string().default(''),
  status: ChangeSetStatusEnum.default('DRAFT'),
  targetEnvironment: z.enum(['DEV', 'QA', 'STAGING', 'PROD']).default('QA'),
  targetRelease: z.string().default('S4H_2023_FPS02'),
  baselineId: z.string().uuid().nullable().optional(),
  proposedChanges: z.array(ProposedChangeItemSchema).default([]),
  simulationDiff: SimulationDiffSchema.optional(),
  reviewedBy: z.string().uuid().nullable().optional(),
  reviewedAt: z.string().datetime().nullable().optional(),
  reviewNotes: z.string().nullable().optional(),
  createdBy: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ChangeSet = z.infer<typeof ChangeSetSchema>;

export const CreateChangeSetSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters'),
  description: z.string().optional().default(''),
  targetEnvironment: z.enum(['DEV', 'QA', 'STAGING', 'PROD']).default('QA'),
  targetRelease: z.string().optional().default('S4H_2023_FPS02'),
  baselineId: z.string().uuid().optional(),
  proposedChanges: z.array(ProposedChangeItemSchema).default([]),
});
export type CreateChangeSetDto = z.infer<typeof CreateChangeSetSchema>;

export const ReviewChangeSetSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'READY_FOR_REVIEW']),
  reviewNotes: z.string().min(3, 'Review justification is required for audit traceability'),
});
export type ReviewChangeSetDto = z.infer<typeof ReviewChangeSetSchema>;
