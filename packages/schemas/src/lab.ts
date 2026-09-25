import { z } from 'zod';
import {
  SeverityEnum,
  ConfidenceClassEnum,
  TargetReleaseEnum,
} from './common';
import { FindingSchema } from './finding';

export const ScenarioDomainEnum = z.enum([
  'OPD',
  'FORM',
  'MFS',
  'CHANGE_POINTER',
]);
export type ScenarioDomain = z.infer<typeof ScenarioDomainEnum>;

export const ScenarioFailureTypeEnum = z.enum([
  'CLEAN_PASS',
  'OPD_MISSING_RECIPIENT',
  'OPD_INVALID_CHANNEL',
  'OPD_SHADOWED_RULE',
  'FORM_MISSING_BINDING',
  'FORM_BINDING_MISMATCH',
  'FORM_TRUNCATION_RISK',
  'MFS_LOCATION_JUMP',
  'MFS_ACK_TIMEOUT',
  'CP_MISSING_FIELD_TRIGGER',
  'CP_GLOBAL_DISABLED',
]);
export type ScenarioFailureType = z.infer<typeof ScenarioFailureTypeEnum>;

export const ExpectedFindingItemSchema = z.object({
  ruleId: z.string(),
  severity: SeverityEnum,
  description: z.string(),
});
export type ExpectedFindingItem = z.infer<typeof ExpectedFindingItemSchema>;

export const GenerateScenarioRequestSchema = z.object({
  domain: ScenarioDomainEnum,
  failureType: ScenarioFailureTypeEnum,
  scenarioName: z.string().optional(),
  projectId: z.string().uuid().optional(),
  options: z.record(z.unknown()).optional(),
});
export type GenerateScenarioRequest = z.infer<typeof GenerateScenarioRequestSchema>;

export const SyntheticScenarioSchema = z.object({
  id: z.string().uuid().optional(),
  scenarioId: z.string().uuid(),
  organizationId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  domain: ScenarioDomainEnum,
  scenarioName: z.string(),
  failureType: ScenarioFailureTypeEnum,
  payload: z.string(),
  format: z.enum(['xml', 'csv', 'json']),
  expectedFindings: z.array(ExpectedFindingItemSchema).default([]),
  lastRunResult: z.record(z.unknown()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type SyntheticScenario = z.infer<typeof SyntheticScenarioSchema>;

export const LabRunRequestSchema = z.object({
  domain: ScenarioDomainEnum,
  payload: z.string(),
  projectId: z.string().uuid().optional(),
  scenarioId: z.string().uuid().optional(),
  scenarioName: z.string().optional(),
  targetRelease: z.string().optional().default('S4H_2023'),
  expectedFindings: z.array(ExpectedFindingItemSchema).optional(),
  configuration: z.record(z.unknown()).optional(),
  engineTypes: z.array(z.string()).optional(),
});
export type LabRunRequest = z.infer<typeof LabRunRequestSchema>;

export const LabAssertionItemSchema = z.object({
  ruleId: z.string(),
  ruleName: z.string(),
  severity: SeverityEnum,
  expected: z.boolean(),
  actual: z.boolean(),
  passed: z.boolean(),
  evidenceSha256: z.string(),
  confidenceClass: ConfidenceClassEnum.default('VERIFIED'),
  evidenceSnippet: z.string().optional(),
  lineNumber: z.number().int().optional(),
  message: z.string(),
});
export type LabAssertionItem = z.infer<typeof LabAssertionItemSchema>;

export const LabRunResultSchema = z.object({
  runId: z.string().uuid(),
  scenarioId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  domain: ScenarioDomainEnum,
  executedAt: z.string(),
  overallStatus: z.enum(['PASSED', 'FAILED', 'REGRESSION_DETECTED']),
  verdict: z.enum(['CLEAR', 'DEFECTS_DETECTED']),
  passedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  allPassed: z.boolean(),
  assertionsCount: z.number().int().nonnegative(),
  executionTimeMs: z.number().nonnegative().default(0),
  rulesEvaluated: z.number().int().nonnegative().default(0),
  payloadSha256: z.string(),
  assertionLedger: z.array(LabAssertionItemSchema),
  findings: z.array(FindingSchema).default([]),
});
export type LabRunResult = z.infer<typeof LabRunResultSchema>;
