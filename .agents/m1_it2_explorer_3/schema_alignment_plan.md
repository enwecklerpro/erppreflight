# Wire Schema Alignment Blueprint: Monorepo Contract Harmonization

**Author**: `m1_it2_explorer_3` (Explorer / Contract Architect)  
**Date**: 2026-09-24  
**Target Milestone**: Milestone 1 Gate Resolution (Iteration 2)  
**Target Files for Implementation**:
- `packages/schemas/src/common.ts`
- `packages/schemas/src/evidence.ts`
- `packages/schemas/src/finding.ts`
- `packages/schemas/src/analysis.ts`
- `packages/schemas/src/index.ts`
- `apps/api/src/modules/jobs/jobs.service.ts`
- `apps/api/test/adversarial_challenge.spec.ts`

---

## 1. Executive Summary & Root Cause Analysis

### 1.1 Problem Statement
During Milestone 1 Gate 1 evaluation, challenger `m1_challenger_1` identified critical contract drift between the TypeScript shared schemas (`@erppreflight/schemas`), the Python analysis service (`services/analysis-python`), the NestJS API layer (`apps/api`), and the database persistence tier (`packages/database`). 

Specifically:
1. **Case Mismatch Across Boundaries**: `@erppreflight/schemas` defined properties in camelCase (`jobId`, `tenantId`, `engineType`, `ruleId`, `confidenceScore`, `affectedObjects`), whereas the HTTP wire interface (`PROJECT.md` line 108 and Python models `AnalysisRequest` / `Finding`) mandated snake_case (`job_id`, `tenant_id`, `engine_type`, `rule_id`, `confidence_score`, `affected_objects`).
2. **Structural Type Mismatch on `affectedObjects`**: In `@erppreflight/schemas`, `FindingSchema` required `affectedObjects` to be an array of structured objects (`{ name: string, type: string, package?: string, tier?: CleanCoreTier }`), whereas Python findings and `PROJECT.md` produce a list of strings (`List[str]`, e.g. `['APOC_OR_ISS_CHNL', 'BRF_DECISION_TABLE_01']`).
3. **Context Location Mismatch on `engineType`**: In `@erppreflight/schemas`, `FindingSchema` marked `engineType` as a required property. However, in the canonical Python wire protocol and `PROJECT.md`, `engine_type` resides exclusively at the root of `AnalysisResponse`, not inside individual finding items. Validating isolated finding payloads from Python or test fixtures resulted in immediate Zod schema parse errors.
4. **Database Column Divergence**: The PostgreSQL `findings` table defines columns `engine` and `confidence_class`, whereas the wire protocol uses `engine_type` and `confidence`, and `@erppreflight/schemas` uses `engineType` and `confidence`.
5. **Untyped NestJS Dispatch and Result Ingestion**: In `apps/api/src/modules/jobs/jobs.service.ts`, payloads to Python were manually created as raw objects, omitting required wire fields (`artifact_type`, `configuration`), ignoring Python HTTP errors (`res.ok` check had no `else` error logging or status handling), bypassing evidence persistence to the PostgreSQL `evidence` table, and returning raw snake_case database rows directly to the frontend, which caused `apps/web` components to receive `undefined` for camelCase properties like `ruleId` and `engineType`.

---

## 2. Canonical Wire Contract Specification

Per `PROJECT.md` (lines 106–154) and `tests/e2e/contracts.py`, the canonical HTTP wire interface between NestJS and Python (`POST /api/v1/analyze`) is defined as follows:

### 2.1 Request Wire Payload (`POST /api/v1/analyze`)
```json
{
  "job_id": "c1234567-89ab-cdef-0123-456789abcdef",
  "tenant_id": "a1234567-89ab-cdef-0123-456789abcdef",
  "project_id": "b1234567-89ab-cdef-0123-456789abcdef",
  "engine_type": "OPD_GUARD",
  "target_release": "S4H_2023",
  "artifact_s3_key": "uploads/tenant/file.xml",
  "artifact_type": "XML",
  "configuration": {},
  "raw_content": "<xml>...</xml>"
}
```

### 2.2 Response Wire Payload (`POST /api/v1/analyze`)
```json
{
  "job_id": "c1234567-89ab-cdef-0123-456789abcdef",
  "engine_type": "OPD_GUARD",
  "status": "COMPLETED",
  "findings": [
    {
      "id": "d1234567-89ab-cdef-0123-456789abcdef",
      "rule_id": "OPD_BRF_001",
      "severity": "CRITICAL",
      "category": "OUTPUT_DETERMINATION",
      "title": "Missing BRFplus Decision Table Entry",
      "description": "No valid recipient found in OPD table",
      "confidence": "VERIFIED",
      "confidence_score": 1.0,
      "remediation": "Maintain decision table in transaction OPD",
      "affected_objects": ["APOC_OR_ISS_CHNL", "BRF_DECISION_TABLE_01"],
      "evidence": [
        {
          "artifact_path": "xml/opd_rules.xml",
          "line_number": 45,
          "column_number": 12,
          "snippet": "<ConditionColumn id=\"C1\" />",
          "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "provenance": "VERIFIED",
          "source_type": "CUSTOMER_EVIDENCE",
          "trust_score": 1.0
        }
      ],
      "technical_details": { "brf_id": "001" },
      "fingerprint": "optional_sha256_hash"
    }
  ],
  "metrics": {
    "execution_time_ms": 128,
    "rules_evaluated": 15,
    "artifacts_scanned": 1,
    "additional_metrics": {}
  },
  "error_message": null
}
```

---

## 3. Technical Solution 1: Dual/Flexible Serialization in `@erppreflight/schemas`

To guarantee zero breaking changes for existing TypeScript consumers while supporting snake_case wire payloads seamlessly, `@erppreflight/schemas` must employ **Zod Preprocessing and Dual Wire Schemas**.

### 3.1 Architecture of Dual/Flexible Schemas
1. **Canonical TypeScript Schemas (`*Schema`)**:
   - Parse **both** camelCase and snake_case inputs.
   - Output normalized, strongly-typed **camelCase** objects (`AnalysisJobRequest`, `Finding`, `EvidenceItem`, `AnalysisJobResponse`).
   - Used throughout internal TypeScript logic, NestJS services, and React frontends.
2. **Canonical Wire Schemas (`*WireSchema`)**:
   - Parse **both** camelCase and snake_case inputs.
   - Output canonical **snake_case** wire objects (`AnalysisJobRequestWire`, `FindingWire`, `EvidenceItemWire`, `AnalysisJobResponseWire`).
   - Used for validating and preparing HTTP payloads transmitted over the wire to external services.
3. **Bidirectional Converters**:
   - `toWireJobRequest(req)` / `fromWireJobRequest(wire)`
   - `toWireFinding(finding)` / `fromWireFinding(wire)`
   - `toWireJobResponse(res)` / `fromWireJobResponse(wire)`

---

### 3.2 Exact File Blueprint: `packages/schemas/src/common.ts`
Enforce that `SeverityEnum` supports all standard severities (including `MEDIUM` and `LOW` if encountered in legacy or third-party engines) and `ConfidenceClassEnum` strictly adheres to epistemic provenance rules.

```typescript
import { z } from 'zod';

export const SeverityEnum = z.enum([
  'BLOCKER',
  'CRITICAL',
  'MAJOR',
  'MEDIUM',
  'MINOR',
  'LOW',
  'INFO',
]);
export type Severity = z.infer<typeof SeverityEnum>;

export const ConfidenceClassEnum = z.enum([
  'VERIFIED',
  'RULE_DERIVED',
  'INFERRED',
  'UNKNOWN',
]);
export type ConfidenceClass = z.infer<typeof ConfidenceClassEnum>;

export const ConfidenceScoreMap: Record<ConfidenceClass, number> = {
  VERIFIED: 1.0,
  RULE_DERIVED: 0.85,
  INFERRED: 0.60,
  UNKNOWN: 0.30,
};

export const EngineTypeEnum = z.enum([
  'OPD_GUARD',
  'FORM_DOCTOR',
  'CUSTOM_FIELD_FLOW_DOCTOR',
  'EXTENSION_IMPACT_GUARD',
  'SPRO2CLOUD',
  'ECC2CLOUD_NAVIGATOR',
  'SAP_GAP_RADAR',
  'CLEAN_CORE_OBJECT_GUARD',
  'CHANGE_POINTER_COVERAGE_AUDITOR',
  'API_CHANGE_GUARD',
  'SOFTWARE_COLLECTION_DEPENDENCY_GUARD',
  'TRANSPORT_DEPENDENCY_ANALYZER',
  'SAFE_DECOMMISSION_PREFLIGHT',
  'FIORI_403_ROOT_CAUSE_DOCTOR',
  'WORKFLOW_STUCK_EXPLAINER',
  'IAM_COST_OPTIMIZER',
  'ACCOUNT_DETERMINATION_PREFLIGHT',
  'SYSTEM_REFRESH_DELTA_GUARD',
  'MFS_BLACKBOX',
]);
export type EngineType = z.infer<typeof EngineTypeEnum>;

export const TargetReleaseEnum = z.enum([
  'S4H_2020',
  'S4H_2021',
  'S4H_2022',
  'S4H_2023',
  'S4HC_2402',
  'S4HC_2408',
]);
export type TargetRelease = z.infer<typeof TargetReleaseEnum>;

export const ArtifactTypeEnum = z.enum([
  'XML',
  'JSON',
  'CSV',
  'ZIP',
  'ABAP',
  'XDP',
  'WSDL',
  'EDMX',
  'TXT',
  'XLSX',
]);
export type ArtifactType = z.infer<typeof ArtifactTypeEnum>;

export const CleanCoreTierEnum = z.enum([
  'TIER_1_CLOUD',
  'TIER_2_DEVELOPER',
  'TIER_3_CLASSIC',
]);
export type CleanCoreTier = z.infer<typeof CleanCoreTierEnum>;

export const AnalysisStatusEnum = z.enum([
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'PARTIAL',
]);
export type AnalysisStatus = z.infer<typeof AnalysisStatusEnum>;

export const RoleEnum = z.enum([
  'ORGANIZATION_OWNER',
  'SECURITY_ADMIN',
  'LEAD_ARCHITECT',
  'MIGRATION_CONSULTANT',
  'AUDITOR',
  'VIEWER',
]);
export type Role = z.infer<typeof RoleEnum>;

export const SourceTypeEnum = z.enum([
  'AST',
  'XML_DOM',
  'CSV_TABLE',
  'SAP_CONFIG',
  'TEXT_SEARCH',
  'LLM_PROSE',
  'CUSTOMER_EVIDENCE',
  'OFFICIAL_METADATA',
  'OFFICIAL_DOCS',
  'CURATED_RULE',
  'COMMUNITY',
  'INFERRED',
]);
export type SourceType = z.infer<typeof SourceTypeEnum>;
```

---

### 3.3 Exact File Blueprint: `packages/schemas/src/evidence.ts`
Implement `EvidenceItemSchema` and `EvidenceItemWireSchema` with:
- Strict SHA-256 hexadecimal regex `/^[a-fA-F0-9]{64}$/`.
- Dual mapping for `line_number` / `lineNumber`, `artifact_path` / `artifactPath`, `trust_score` / `trust_level` / `trustScore`.

```typescript
import { z } from 'zod';
import { ConfidenceClassEnum, SourceTypeEnum } from './common';

const sha256Regex = /^[a-fA-F0-9]{64}$/;

function normalizeEvidenceInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  return {
    id: obj.id,
    findingId: obj.findingId ?? obj.finding_id,
    artifactPath: obj.artifactPath ?? obj.artifact_path,
    lineNumber: obj.lineNumber ?? obj.line_number ?? null,
    columnNumber: obj.columnNumber ?? obj.column_number ?? null,
    snippet: obj.snippet ?? null,
    sha256: obj.sha256,
    provenance: obj.provenance ?? 'VERIFIED',
    sourceType: obj.sourceType ?? obj.source_type ?? 'CUSTOMER_EVIDENCE',
    sourceTitle: obj.sourceTitle ?? obj.source_title ?? null,
    sourceUrl: obj.sourceUrl ?? obj.source_url ?? null,
    trustScore: obj.trustScore ?? obj.trust_score ?? obj.trust_level ?? 1.0,
    createdAt: obj.createdAt ?? obj.created_at,
  };
}

export const BaseEvidenceItemSchema = z.object({
  id: z.string().uuid().optional(),
  findingId: z.string().uuid().optional().nullable(),
  artifactPath: z.string().min(1),
  lineNumber: z.number().int().positive().optional().nullable(),
  columnNumber: z.number().int().positive().optional().nullable(),
  snippet: z.string().optional().nullable(),
  sha256: z.string().regex(sha256Regex, 'Must be a valid 64-character hexadecimal SHA-256 hash'),
  provenance: ConfidenceClassEnum.default('VERIFIED'),
  sourceType: SourceTypeEnum.default('CUSTOMER_EVIDENCE'),
  sourceTitle: z.string().optional().nullable(),
  sourceUrl: z.string().url().optional().nullable(),
  trustScore: z.number().min(0).max(1).default(1.0),
  createdAt: z.string().datetime().optional(),
});
export type EvidenceItem = z.infer<typeof BaseEvidenceItemSchema>;

export const EvidenceItemSchema = z.preprocess(
  normalizeEvidenceInput,
  BaseEvidenceItemSchema
);

function normalizeEvidenceWireInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  return {
    id: obj.id,
    finding_id: obj.finding_id ?? obj.findingId,
    artifact_path: obj.artifact_path ?? obj.artifactPath,
    line_number: obj.line_number ?? obj.lineNumber ?? null,
    column_number: obj.column_number ?? obj.columnNumber ?? null,
    snippet: obj.snippet ?? null,
    sha256: obj.sha256,
    provenance: obj.provenance ?? 'VERIFIED',
    source_type: obj.source_type ?? obj.sourceType ?? 'CUSTOMER_EVIDENCE',
    source_title: obj.source_title ?? obj.sourceTitle ?? null,
    source_url: obj.source_url ?? obj.sourceUrl ?? null,
    trust_score: obj.trust_score ?? obj.trustScore ?? obj.trust_level ?? 1.0,
  };
}

export const BaseEvidenceItemWireSchema = z.object({
  id: z.string().uuid().optional(),
  finding_id: z.string().uuid().optional().nullable(),
  artifact_path: z.string().min(1),
  line_number: z.number().int().positive().optional().nullable(),
  column_number: z.number().int().positive().optional().nullable(),
  snippet: z.string().optional().nullable(),
  sha256: z.string().regex(sha256Regex, 'Must be a valid 64-character hexadecimal SHA-256 hash'),
  provenance: ConfidenceClassEnum.default('VERIFIED'),
  source_type: SourceTypeEnum.default('CUSTOMER_EVIDENCE'),
  source_title: z.string().optional().nullable(),
  source_url: z.string().url().optional().nullable(),
  trust_score: z.number().min(0).max(1).default(1.0),
});
export type EvidenceItemWire = z.infer<typeof BaseEvidenceItemWireSchema>;

export const EvidenceItemWireSchema = z.preprocess(
  normalizeEvidenceWireInput,
  BaseEvidenceItemWireSchema
);
```

---

### 3.4 Exact File Blueprint: `packages/schemas/src/finding.ts`
Implement flexible `AffectedObjectItemSchema` accepting both structured objects and raw strings:
- String `'APOC_OR_ISS_CHNL'` automatically converts to `{ name: 'APOC_OR_ISS_CHNL', type: 'SAP_OBJECT', package: null, tier: null }`.
- `engineType` is marked `optional().nullable()` to allow validation of isolated Python finding items where `engine_type` is top-level.
- Preprocessors normalize database columns (`engine`, `confidence_class`) and wire keys (`rule_id`, `confidence_score`, `technical_details`, `affected_objects`).

```typescript
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
    confidenceScore: obj.confidenceScore ?? obj.confidence_score ?? 1.0,
    remediation: obj.remediation,
    affectedObjects: obj.affectedObjects ?? obj.affected_objects ?? [],
    evidence: obj.evidence ?? [],
    technicalDetails: obj.technicalDetails ?? obj.technical_details ?? {},
    fingerprint: obj.fingerprint ?? null,
    createdAt: obj.createdAt ?? obj.created_at,
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
  createdAt: z.string().datetime().optional().nullable(),
});
export type Finding = z.infer<typeof BaseFindingSchema>;

export const FindingSchema = z.preprocess(
  normalizeFindingInput,
  BaseFindingSchema
);

function normalizeFindingWireInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  const rawAffected = obj.affected_objects ?? obj.affectedObjects ?? [];
  const affectedList: string[] = Array.isArray(rawAffected)
    ? rawAffected.map((item) => (typeof item === 'string' ? item : item?.name || ''))
    : [];

  return {
    id: obj.id,
    rule_id: obj.rule_id ?? obj.ruleId,
    severity: obj.severity,
    category: obj.category ?? 'SAP_PREFLIGHT',
    title: obj.title,
    description: obj.description,
    confidence: obj.confidence ?? obj.confidence_class,
    confidence_score: obj.confidence_score ?? obj.confidenceScore ?? 1.0,
    remediation: obj.remediation,
    affected_objects: affectedList,
    evidence: obj.evidence ?? [],
    technical_details: obj.technical_details ?? obj.technicalDetails ?? {},
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
```

---

### 3.5 Exact File Blueprint: `packages/schemas/src/analysis.ts`
Implement dual parsing and wire schemas for `AnalysisJobRequest`, `AnalysisMetrics`, and `AnalysisJobResponse`.

```typescript
import { z } from 'zod';
import {
  EngineTypeEnum,
  TargetReleaseEnum,
  ArtifactTypeEnum,
  AnalysisStatusEnum,
} from './common';
import { FindingSchema, FindingWireSchema } from './finding';

// --- Analysis Job Request ---

function normalizeJobRequestInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  return {
    jobId: obj.jobId ?? obj.job_id,
    tenantId: obj.tenantId ?? obj.tenant_id,
    projectId: obj.projectId ?? obj.project_id,
    engineType: obj.engineType ?? obj.engine_type,
    targetRelease: obj.targetRelease ?? obj.target_release ?? 'S4H_2023',
    artifactS3Key: obj.artifactS3Key ?? obj.artifact_s3_key ?? null,
    artifactType: obj.artifactType ?? obj.artifact_type ?? 'JSON',
    configuration: obj.configuration ?? {},
    rawContent: obj.rawContent ?? obj.raw_content ?? null,
  };
}

export const BaseAnalysisJobRequestSchema = z.object({
  jobId: z.string().uuid(),
  tenantId: z.string().uuid(),
  projectId: z.string().uuid(),
  engineType: EngineTypeEnum,
  targetRelease: TargetReleaseEnum.default('S4H_2023'),
  artifactS3Key: z.string().optional().nullable(),
  artifactType: ArtifactTypeEnum.default('JSON'),
  configuration: z.record(z.unknown()).default({}),
  rawContent: z.string().optional().nullable(),
});
export type AnalysisJobRequest = z.infer<typeof BaseAnalysisJobRequestSchema>;

export const AnalysisJobRequestSchema = z.preprocess(
  normalizeJobRequestInput,
  BaseAnalysisJobRequestSchema
);

function normalizeJobRequestWireInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  return {
    job_id: obj.job_id ?? obj.jobId,
    tenant_id: obj.tenant_id ?? obj.tenantId,
    project_id: obj.project_id ?? obj.projectId,
    engine_type: obj.engine_type ?? obj.engineType,
    target_release: obj.target_release ?? obj.targetRelease ?? 'S4H_2023',
    artifact_s3_key: obj.artifact_s3_key ?? obj.artifactS3Key ?? null,
    artifact_type: obj.artifact_type ?? obj.artifactType ?? 'JSON',
    configuration: obj.configuration ?? {},
    raw_content: obj.raw_content ?? obj.rawContent ?? null,
  };
}

export const BaseAnalysisJobRequestWireSchema = z.object({
  job_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid(),
  engine_type: EngineTypeEnum,
  target_release: TargetReleaseEnum.default('S4H_2023'),
  artifact_s3_key: z.string().optional().nullable(),
  artifact_type: ArtifactTypeEnum.default('JSON'),
  configuration: z.record(z.unknown()).default({}),
  raw_content: z.string().optional().nullable(),
});
export type AnalysisJobRequestWire = z.infer<typeof BaseAnalysisJobRequestWireSchema>;

export const AnalysisJobRequestWireSchema = z.preprocess(
  normalizeJobRequestWireInput,
  BaseAnalysisJobRequestWireSchema
);

// --- Metrics ---

function normalizeMetricsInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  return {
    executionTimeMs: obj.executionTimeMs ?? obj.execution_time_ms ?? 0,
    rulesEvaluated: obj.rulesEvaluated ?? obj.rules_evaluated ?? 0,
    artifactsScanned: obj.artifactsScanned ?? obj.artifacts_scanned ?? 1,
    additionalMetrics: obj.additionalMetrics ?? obj.additional_metrics ?? obj.custom_metrics ?? {},
  };
}

export const BaseAnalysisMetricsSchema = z.object({
  executionTimeMs: z.number().int().nonnegative().default(0),
  rulesEvaluated: z.number().int().nonnegative().default(0),
  artifactsScanned: z.number().int().nonnegative().default(1),
  additionalMetrics: z.record(z.unknown()).default({}),
});
export type AnalysisMetrics = z.infer<typeof BaseAnalysisMetricsSchema>;

export const AnalysisMetricsSchema = z.preprocess(
  normalizeMetricsInput,
  BaseAnalysisMetricsSchema
);

function normalizeMetricsWireInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  return {
    execution_time_ms: obj.execution_time_ms ?? obj.executionTimeMs ?? 0,
    rules_evaluated: obj.rules_evaluated ?? obj.rulesEvaluated ?? 0,
    artifacts_scanned: obj.artifacts_scanned ?? obj.artifactsScanned ?? 1,
    additional_metrics: obj.additional_metrics ?? obj.additionalMetrics ?? obj.custom_metrics ?? {},
  };
}

export const BaseAnalysisMetricsWireSchema = z.object({
  execution_time_ms: z.number().int().nonnegative().default(0),
  rules_evaluated: z.number().int().nonnegative().default(0),
  artifacts_scanned: z.number().int().nonnegative().default(1),
  additional_metrics: z.record(z.unknown()).default({}),
});
export type AnalysisMetricsWire = z.infer<typeof BaseAnalysisMetricsWireSchema>;

export const AnalysisMetricsWireSchema = z.preprocess(
  normalizeMetricsWireInput,
  BaseAnalysisMetricsWireSchema
);

// --- Analysis Job Response ---

function normalizeJobResponseInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  return {
    jobId: obj.jobId ?? obj.job_id,
    engineType: obj.engineType ?? obj.engine_type,
    status: obj.status,
    findings: obj.findings ?? [],
    metrics: obj.metrics ?? {},
    errorMessage: obj.errorMessage ?? obj.error_message ?? null,
  };
}

export const BaseAnalysisJobResponseSchema = z.object({
  jobId: z.string().uuid(),
  engineType: EngineTypeEnum,
  status: AnalysisStatusEnum,
  findings: z.array(FindingSchema).default([]),
  metrics: AnalysisMetricsSchema.default({
    executionTimeMs: 0,
    rulesEvaluated: 0,
    artifactsScanned: 1,
    additionalMetrics: {},
  }),
  errorMessage: z.string().optional().nullable(),
});
export type AnalysisJobResponse = z.infer<typeof BaseAnalysisJobResponseSchema>;

export const AnalysisJobResponseSchema = z.preprocess(
  normalizeJobResponseInput,
  BaseAnalysisJobResponseSchema
);

function normalizeJobResponseWireInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  return {
    job_id: obj.job_id ?? obj.jobId,
    engine_type: obj.engine_type ?? obj.engineType,
    status: obj.status,
    findings: obj.findings ?? [],
    metrics: obj.metrics ?? {},
    error_message: obj.error_message ?? obj.errorMessage ?? null,
  };
}

export const BaseAnalysisJobResponseWireSchema = z.object({
  job_id: z.string().uuid(),
  engine_type: EngineTypeEnum,
  status: AnalysisStatusEnum,
  findings: z.array(FindingWireSchema).default([]),
  metrics: AnalysisMetricsWireSchema.default({
    execution_time_ms: 0,
    rules_evaluated: 0,
    artifacts_scanned: 1,
    additional_metrics: {},
  }),
  error_message: z.string().optional().nullable(),
});
export type AnalysisJobResponseWire = z.infer<typeof BaseAnalysisJobResponseWireSchema>;

export const AnalysisJobResponseWireSchema = z.preprocess(
  normalizeJobResponseWireInput,
  BaseAnalysisJobResponseWireSchema
);
```

---

### 3.6 Conversion Utility Helpers: `packages/schemas/src/converters.ts`

Add clean helper functions for direct bidirectional transformation:

```typescript
import {
  AnalysisJobRequest,
  AnalysisJobRequestWire,
  AnalysisJobRequestWireSchema,
  AnalysisJobRequestSchema,
  AnalysisJobResponse,
  AnalysisJobResponseWire,
  AnalysisJobResponseWireSchema,
  AnalysisJobResponseSchema,
} from './analysis';
import {
  Finding,
  FindingWire,
  FindingWireSchema,
  FindingSchema,
} from './finding';

export function toWireJobRequest(req: AnalysisJobRequest | Record<string, unknown>): AnalysisJobRequestWire {
  return AnalysisJobRequestWireSchema.parse(req);
}

export function fromWireJobRequest(wire: AnalysisJobRequestWire | Record<string, unknown>): AnalysisJobRequest {
  return AnalysisJobRequestSchema.parse(wire);
}

export function toWireFinding(finding: Finding | Record<string, unknown>): FindingWire {
  return FindingWireSchema.parse(finding);
}

export function fromWireFinding(wire: FindingWire | Record<string, unknown>): Finding {
  return FindingSchema.parse(wire);
}

export function toWireJobResponse(res: AnalysisJobResponse | Record<string, unknown>): AnalysisJobResponseWire {
  return AnalysisJobResponseWireSchema.parse(res);
}

export function fromWireJobResponse(wire: AnalysisJobResponseWire | Record<string, unknown>): AnalysisJobResponse {
  return AnalysisJobResponseSchema.parse(wire);
}
```

Export these helpers in `packages/schemas/src/index.ts`:
```typescript
export * from './common';
export * from './evidence';
export * from './finding';
export * from './analysis';
export * from './project';
export * from './organization';
export * from './converters';
```

---

## 4. Technical Solution 2: NestJS `jobs.service.ts` Wire Transformation & Dispatch Engine

In `apps/api/src/modules/jobs/jobs.service.ts`:
1. Use `toWireJobRequest()` to produce and validate the outbound wire payload.
2. Infer `artifact_type` deterministically from file extension or DTO.
3. Pass `X-Tenant-Id` header for tenancy tracking.
4. Add robust HTTP error handling with Python error body logging.
5. Accurately update `analyses.status` to `COMPLETED`, `PARTIAL`, or `FAILED`.

### 4.1 Enhanced `TriggerAnalysisDto`
```typescript
export interface TriggerAnalysisDto {
  projectId: string;
  engineTypes: EngineType[];
  targetRelease?: TargetRelease;
  artifactS3Key?: string;
  artifactType?: ArtifactType;
  rawContent?: string;
  configuration?: Record<string, unknown>;
}
```

### 4.2 Helper for Artifact Type Detection
```typescript
function inferArtifactType(artifactS3Key?: string, rawContent?: string): ArtifactType {
  if (artifactS3Key) {
    const ext = artifactS3Key.split('.').pop()?.toUpperCase();
    if (ext === 'XML') return 'XML';
    if (ext === 'JSON') return 'JSON';
    if (ext === 'CSV') return 'CSV';
    if (ext === 'ZIP') return 'ZIP';
    if (ext === 'ABAP') return 'ABAP';
    if (ext === 'XDP') return 'XDP';
    if (ext === 'WSDL') return 'WSDL';
  }
  if (rawContent?.trim().startsWith('<')) return 'XML';
  if (rawContent?.trim().startsWith('{') || rawContent?.trim().startsWith('[')) return 'JSON';
  return 'JSON';
}
```

### 4.3 Dispatch Implementation in `runEngines`
```typescript
const artifactType = dto.artifactType || inferArtifactType(dto.artifactS3Key, dto.rawContent);

for (const engine of engineTypes) {
  try {
    // 1. Transform to canonical wire payload and validate via schema
    const wirePayload = toWireJobRequest({
      jobId: analysisId,
      tenantId: organizationId,
      projectId: projectId,
      engineType: engine,
      targetRelease: targetRelease as TargetRelease,
      artifactS3Key: artifactS3Key ?? null,
      artifactType,
      configuration: configuration ?? {},
      rawContent: rawContent ?? null,
    });

    // 2. Dispatch HTTP POST to Python analysis engine
    const res = await fetch(`${this.analysisUrl}/api/v1/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Tenant-Id': organizationId,
      },
      body: JSON.stringify(wirePayload),
    });

    if (!res.ok) {
      const errText = await res.text();
      this.logger.error(
        `Engine '${engine}' analysis failed [HTTP ${res.status}]: ${errText}`
      );
      failedEngines.push(engine);
      continue;
    }

    // 3. Parse and validate response with AnalysisJobResponseSchema
    const rawData = await res.json();
    const validatedResponse = AnalysisJobResponseSchema.parse(rawData);

    // 4. Ingest findings into database...
```

---

## 5. Technical Solution 3: Python Finding Ingestion & PostgreSQL Persistence

### 5.1 Mapping Matrix: Python Wire ↔ `@erppreflight/schemas` ↔ PostgreSQL Tables

| Python Wire Finding | `Finding` Schema | DB `findings` Column | DB `evidence` Column | PostgreSQL Type |
|---|---|---|---|---|
| `id` | `id` | `id` | - | `UUID PRIMARY KEY` |
| Top-level `engine_type` | `engineType` | `engine` | - | `VARCHAR(100)` |
| `rule_id` | `ruleId` | `rule_id` | - | `VARCHAR(100)` |
| `severity` | `severity` | `severity` | - | `VARCHAR(50)` |
| `category` | `category` | `category` | - | `VARCHAR(100)` |
| `title` | `title` | `title` | - | `VARCHAR(500)` |
| `description` | `description` | `description` | - | `TEXT` |
| `confidence` | `confidence` | `confidence_class` | - | `VARCHAR(50)` |
| `confidence_score` | `confidenceScore` | `confidence_score` | - | `NUMERIC(4,3)` |
| `remediation` | `remediation` | `remediation` | - | `TEXT` |
| `affected_objects` | `affectedObjects` | `affected_objects` | - | `JSONB` |
| `technical_details` | `technicalDetails` | `technical_details` | - | `JSONB` |
| `fingerprint` | `fingerprint` | `fingerprint` | - | `VARCHAR(64)` |
| - | - | `created_at` | `created_at` | `TIMESTAMPTZ` |
| Context `analysisId` | `analysisId` | `analysis_id` | - | `UUID REFERENCES analyses(id)` |
| Context `projectId` | `projectId` | `project_id` | - | `UUID REFERENCES projects(id)` |
| Context `organizationId` | `organizationId` | `organization_id` | `organization_id` | `UUID REFERENCES organizations(id)` |
| `evidence[i]` | `evidence[i]` | - | `id` | `UUID PRIMARY KEY` |
| `evidence[i]` | `evidence[i]` | - | `finding_id` | `UUID REFERENCES findings(id)` |
| `evidence[i].artifact_path`| `evidence[i].artifactPath`| - | `artifact_path` | `VARCHAR(1000)` |
| `evidence[i].line_number` | `evidence[i].lineNumber` | - | `line_number` | `INTEGER` |
| `evidence[i].column_number`| `evidence[i].columnNumber`| - | `column_number` | `INTEGER` |
| `evidence[i].snippet` | `evidence[i].snippet` | - | `snippet` | `TEXT` |
| `evidence[i].sha256` | `evidence[i].sha256` | - | `sha256` | `VARCHAR(64)` |
| `evidence[i].provenance` | `evidence[i].provenance` | - | `provenance` | `VARCHAR(50)` |
| `evidence[i].source_title` | `evidence[i].sourceTitle` | - | `source_title` | `VARCHAR(255)` |
| `evidence[i].source_url` | `evidence[i].sourceUrl` | - | `source_url` | `VARCHAR(1000)` |
| `evidence[i].trust_score` | `evidence[i].trustScore` | - | `trust_score` | `NUMERIC(4,3)` |

---

### 5.2 Deterministic Fingerprint Generation
If the Python engine provides a `fingerprint`, use it directly. If absent, generate an idempotent SHA-256 fingerprint matching `@erppreflight/evidence`:
```typescript
import { createFindingFingerprint, calculateSha256 } from '@erppreflight/evidence';

const firstObjName = f.affectedObjects[0]?.name || 'GLOBAL';
const firstArtifact = f.evidence[0]?.artifactPath || 'UNKNOWN_SOURCE';
const fingerprint = f.fingerprint || createFindingFingerprint(f.ruleId, firstObjName, firstArtifact);
```

### 5.3 Ingestion Logic into `findings` and `evidence` Tables
```typescript
for (const f of validatedResponse.findings) {
  const findingId = f.id || uuidv4();
  const firstObjName = f.affectedObjects[0]?.name || 'GLOBAL';
  const firstArtifact = f.evidence[0]?.artifactPath || 'UNKNOWN_SOURCE';
  const fingerprint = f.fingerprint || createFindingFingerprint(f.ruleId, firstObjName, firstArtifact);

  // 1. Insert into PostgreSQL findings table
  await this.db.query(
    `INSERT INTO findings (
      id, organization_id, project_id, analysis_id, engine, rule_id,
      severity, category, title, description, confidence_class,
      confidence_score, remediation, affected_objects, technical_details, fingerprint
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      findingId,
      organizationId,
      projectId,
      analysisId,
      engine,
      f.ruleId,
      f.severity,
      f.category,
      f.title,
      f.description,
      f.confidence,
      f.confidenceScore,
      f.remediation,
      JSON.stringify(f.affectedObjects || []),
      JSON.stringify(f.technicalDetails || {}),
      fingerprint,
    ],
    { bypassRls: true }
  );

  // 2. Insert into PostgreSQL evidence table
  if (Array.isArray(f.evidence) && f.evidence.length > 0) {
    for (const ev of f.evidence) {
      await this.db.query(
        `INSERT INTO evidence (
          id, organization_id, finding_id, artifact_path, line_number,
          column_number, snippet, sha256, provenance, source_title,
          source_url, trust_score
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          ev.id || uuidv4(),
          organizationId,
          findingId,
          ev.artifactPath,
          ev.lineNumber ?? null,
          ev.columnNumber ?? null,
          ev.snippet ?? null,
          ev.sha256,
          ev.provenance || 'VERIFIED',
          ev.sourceTitle ?? null,
          ev.sourceUrl ?? null,
          ev.trustScore ?? 1.0,
        ],
        { bypassRls: true }
      );
    }
  }

  totalFindings++;
}
```

### 5.4 Querying Findings in `JobsService.getAnalysis()`
To prevent snake_case DB rows from leaking to the frontend:
```typescript
async getAnalysis(organizationId: string, analysisId: string) {
  const res = await this.db.query(
    `SELECT a.*, COUNT(f.id)::int as total_findings
     FROM analyses a
     LEFT JOIN findings f ON f.analysis_id = a.id
     WHERE a.organization_id = $1 AND a.id = $2
     GROUP BY a.id`,
    [organizationId, analysisId]
  );

  if (res.rows.length === 0) {
    throw new NotFoundException(`Analysis job '${analysisId}' not found`);
  }

  const findingsRes = await this.db.query(
    `SELECT * FROM findings WHERE organization_id = $1 AND analysis_id = $2 ORDER BY created_at ASC`,
    [organizationId, analysisId]
  );

  const findingIds = findingsRes.rows.map((r: any) => r.id);
  const evidenceMap = new Map<string, EvidenceItem[]>();

  if (findingIds.length > 0) {
    const evidenceRes = await this.db.query(
      `SELECT * FROM evidence WHERE organization_id = $1 AND finding_id = ANY($2::uuid[])`,
      [organizationId, findingIds]
    );
    for (const evRow of evidenceRes.rows) {
      const ev = EvidenceItemSchema.parse(evRow);
      const list = evidenceMap.get(evRow.finding_id) || [];
      list.push(ev);
      evidenceMap.set(evRow.finding_id, list);
    }
  }

  // Parse and normalize through FindingSchema
  const normalizedFindings = findingsRes.rows.map((row: any) => {
    const evidence = evidenceMap.get(row.id) || [];
    return FindingSchema.parse({
      ...row,
      evidence,
    });
  });

  return {
    ...res.rows[0],
    findings: normalizedFindings,
  };
}
```

---

## 6. Adversarial Challenge Test Alignment & Verification Plan

### 6.1 Update to `apps/api/test/adversarial_challenge.spec.ts`

The tests originally written to demonstrate failures must be updated to assert success:

```typescript
it('CHALLENGE RESOLVED: AnalysisJobRequestSchema parses wire payload from PROJECT.md / Python specification', () => {
  const pythonWireRequest = {
    job_id: 'c1234567-89ab-cdef-0123-456789abcdef',
    tenant_id: 'a1234567-89ab-cdef-0123-456789abcdef',
    project_id: 'b1234567-89ab-cdef-0123-456789abcdef',
    engine_type: 'OPD_GUARD',
    target_release: 'S4H_2023',
    artifact_s3_key: 'uploads/tenant/file.xml',
    artifact_type: 'XML',
    configuration: {},
  };

  const result = AnalysisJobRequestSchema.safeParse(pythonWireRequest);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.jobId).toBe('c1234567-89ab-cdef-0123-456789abcdef');
    expect(result.data.tenantId).toBe('a1234567-89ab-cdef-0123-456789abcdef');
    expect(result.data.engineType).toBe('OPD_GUARD');
    expect(result.data.artifactType).toBe('XML');
  }
});

it('CHALLENGE RESOLVED: FindingSchema parses Python Analysis Engine finding output with string[] affected_objects', () => {
  const pythonFindingWire = {
    id: 'd1234567-89ab-cdef-0123-456789abcdef',
    rule_id: 'OPD_BRF_001',
    severity: 'CRITICAL',
    category: 'OUTPUT_DETERMINATION',
    title: 'Missing BRFplus Decision Table Entry',
    description: 'No valid recipient found in OPD table',
    confidence: 'VERIFIED',
    confidence_score: 1.0,
    remediation: 'Maintain decision table in transaction OPD',
    affected_objects: ['APOC_OR_ISS_CHNL', 'BRF_DECISION_TABLE_01'],
    evidence: [
      {
        artifact_path: 'xml/opd_rules.xml',
        line_number: 45,
        column_number: 12,
        snippet: '<ConditionColumn id="C1" />',
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        provenance: 'VERIFIED',
      },
    ],
    technical_details: { brf_id: '001' },
  };

  const result = FindingSchema.safeParse(pythonFindingWire);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.ruleId).toBe('OPD_BRF_001');
    expect(result.data.severity).toBe('CRITICAL');
    expect(result.data.confidence).toBe('VERIFIED');
    expect(result.data.confidenceScore).toBe(1.0);
    expect(result.data.affectedObjects).toHaveLength(2);
    expect(result.data.affectedObjects[0].name).toBe('APOC_OR_ISS_CHNL');
    expect(result.data.evidence[0].artifactPath).toBe('xml/opd_rules.xml');
  }
});

it('CHALLENGE RESOLVED: EvidenceItemSchema strictly rejects non-hex characters in SHA-256', () => {
  const nonHex64CharString = 'Z'.repeat(64);
  const res = EvidenceItemSchema.safeParse({
    artifactPath: 'some/path.txt',
    sha256: nonHex64CharString,
  });
  // Must be rejected now that hexadecimal regex is enforced:
  expect(res.success).toBe(false);
});
```

---

## 7. Step-by-Step Implementation Sequence

The assigned implementer agent should execute changes in the following exact order:

1. **Update `packages/schemas/src/common.ts`**:
   - Ensure `SeverityEnum` and `SourceTypeEnum` accommodate all wire enum variants.
2. **Update `packages/schemas/src/evidence.ts`**:
   - Add hexadecimal regex check on `sha256`.
   - Add `normalizeEvidenceInput` and `normalizeEvidenceWireInput`.
   - Export `BaseEvidenceItemSchema`, `EvidenceItemSchema`, `BaseEvidenceItemWireSchema`, `EvidenceItemWireSchema`.
3. **Update `packages/schemas/src/finding.ts`**:
   - Update `AffectedObjectItemSchema` to accept `z.union([AffectedObjectSchema, z.string()])`.
   - Make `engineType` optional/nullable.
   - Add preprocessors for camelCase and snake_case normalization.
   - Export `BaseFindingSchema`, `FindingSchema`, `BaseFindingWireSchema`, `FindingWireSchema`.
4. **Update `packages/schemas/src/analysis.ts`**:
   - Add dual normalization for `AnalysisJobRequest`, `AnalysisMetrics`, and `AnalysisJobResponse`.
   - Export both camelCase schemas and `*WireSchema` variants.
5. **Create `packages/schemas/src/converters.ts`**:
   - Add `toWireJobRequest`, `fromWireJobRequest`, `toWireFinding`, `fromWireFinding`, `toWireJobResponse`, `fromWireJobResponse`.
6. **Update `packages/schemas/src/index.ts`**:
   - Re-export all schemas, types, and converter utilities.
7. **Rebuild `@erppreflight/schemas`**:
   - Run `pnpm --filter @erppreflight/schemas build`.
8. **Update `apps/api/src/modules/jobs/jobs.service.ts`**:
   - Import `toWireJobRequest`, `AnalysisJobResponseSchema`, `FindingSchema`, `EvidenceItemSchema`, `createFindingFingerprint`.
   - Update `runEngines` to validate outbound wire payload and persist findings and evidence cleanly.
   - Update `getAnalysis` to normalize database rows with `FindingSchema.parse(...)`.
9. **Update and Run Vitest Challenge Suite**:
   - Run `pnpm --filter @erppreflight/api test` to confirm all 28 tests pass with zero failures.
