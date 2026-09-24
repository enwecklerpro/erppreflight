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
