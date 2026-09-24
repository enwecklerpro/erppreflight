import { z } from 'zod';
import {
  SeverityEnum,
  ConfidenceClassEnum,
  EngineTypeEnum,
  CleanCoreTierEnum,
} from './common';
import {
  EvidenceItemSchema,
  EvidenceItemWireSchema,
  EvidenceItem,
  EvidenceItemWire,
} from './evidence';

export const AffectedObjectSchema = z.object({
  name: z.string(),
  type: z.string().default('SAP_OBJECT'),
  package: z.string().optional().nullable(),
  tier: CleanCoreTierEnum.optional().nullable(),
});
export type AffectedObject = z.infer<typeof AffectedObjectSchema>;

export const AffectedObjectItemSchema = z.union([
  AffectedObjectSchema,
  z.string().transform((name): AffectedObject => ({
    name,
    type: 'SAP_OBJECT',
    package: null,
    tier: null,
  })),
]);

function normalizeFindingInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  const createdAtRaw = obj.createdAt ?? obj.created_at;
  const createdAt = createdAtRaw instanceof Date ? createdAtRaw.toISOString() : (createdAtRaw as string | undefined);

  let rawAffected = obj.affectedObjects ?? obj.affected_objects ?? [];
  if (typeof rawAffected === 'string') {
    try {
      rawAffected = JSON.parse(rawAffected);
    } catch {
      rawAffected = [];
    }
  }

  let rawDetails = obj.technicalDetails ?? obj.technical_details ?? {};
  if (typeof rawDetails === 'string') {
    try {
      rawDetails = JSON.parse(rawDetails);
    } catch {
      rawDetails = {};
    }
  }

  const rawScore = obj.confidenceScore ?? obj.confidence_score;
  const confidenceScore = rawScore !== undefined && rawScore !== null ? Number(rawScore) : 1.0;

  return {
    id: obj.id,
    jobId: obj.jobId ?? obj.job_id ?? null,
    analysisId: obj.analysisId ?? obj.analysis_id ?? null,
    projectId: obj.projectId ?? obj.project_id ?? null,
    organizationId: obj.organizationId ?? obj.organization_id ?? obj.tenant_id ?? null,
    engineType: obj.engineType ?? obj.engine_type ?? obj.engine ?? null,
    ruleId: obj.ruleId ?? obj.rule_id,
    severity: obj.severity,
    category: obj.category ?? 'SAP_PREFLIGHT',
    title: obj.title,
    description: obj.description,
    confidence: obj.confidence ?? obj.confidence_class,
    confidenceScore,
    remediation: obj.remediation,
    affectedObjects: rawAffected,
    evidence: obj.evidence ?? [],
    technicalDetails: rawDetails,
    fingerprint: obj.fingerprint ?? null,
    createdAt: createdAt ?? null,
  };
}

export const BaseFindingSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid().optional().nullable(),
  analysisId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  organizationId: z.string().uuid().optional().nullable(),
  engineType: EngineTypeEnum.optional().nullable(),
  ruleId: z.string(),
  severity: SeverityEnum,
  category: z.string().default('SAP_PREFLIGHT'),
  title: z.string(),
  description: z.string(),
  confidence: ConfidenceClassEnum,
  confidenceScore: z.number().min(0).max(1),
  remediation: z.string(),
  affectedObjects: z.array(AffectedObjectItemSchema).default([]),
  evidence: z.array(EvidenceItemSchema).default([]),
  technicalDetails: z.record(z.unknown()).default({}),
  fingerprint: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),
});
export type Finding = z.infer<typeof BaseFindingSchema>;

export const FindingSchema = z.preprocess(
  normalizeFindingInput,
  BaseFindingSchema
);

function normalizeFindingWireInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  let rawAffected = obj.affected_objects ?? obj.affectedObjects ?? [];
  if (typeof rawAffected === 'string') {
    try {
      rawAffected = JSON.parse(rawAffected);
    } catch {
      rawAffected = [];
    }
  }

  const affectedList: string[] = Array.isArray(rawAffected)
    ? rawAffected.map((item) => (typeof item === 'string' ? item : (item as any)?.name || ''))
    : [];

  let rawDetails = obj.technical_details ?? obj.technicalDetails ?? {};
  if (typeof rawDetails === 'string') {
    try {
      rawDetails = JSON.parse(rawDetails);
    } catch {
      rawDetails = {};
    }
  }

  const rawScore = obj.confidence_score ?? obj.confidenceScore;
  const confidence_score = rawScore !== undefined && rawScore !== null ? Number(rawScore) : 1.0;

  return {
    id: obj.id,
    rule_id: obj.rule_id ?? obj.ruleId,
    severity: obj.severity,
    category: obj.category ?? 'SAP_PREFLIGHT',
    title: obj.title,
    description: obj.description,
    confidence: obj.confidence ?? obj.confidence_class,
    confidence_score,
    remediation: obj.remediation,
    affected_objects: affectedList,
    evidence: obj.evidence ?? [],
    technical_details: rawDetails,
    fingerprint: obj.fingerprint ?? null,
    engine_type: obj.engine_type ?? obj.engineType ?? obj.engine ?? null,
  };
}

export const BaseFindingWireSchema = z.object({
  id: z.string().uuid(),
  rule_id: z.string(),
  severity: SeverityEnum,
  category: z.string().default('SAP_PREFLIGHT'),
  title: z.string(),
  description: z.string(),
  confidence: ConfidenceClassEnum,
  confidence_score: z.number().min(0).max(1),
  remediation: z.string(),
  affected_objects: z.array(z.string()).default([]),
  evidence: z.array(EvidenceItemWireSchema).default([]),
  technical_details: z.record(z.unknown()).default({}),
  fingerprint: z.string().optional().nullable(),
  engine_type: EngineTypeEnum.optional().nullable(),
});
export type FindingWire = z.infer<typeof BaseFindingWireSchema>;

export const FindingWireSchema = z.preprocess(
  normalizeFindingWireInput,
  BaseFindingWireSchema
);
