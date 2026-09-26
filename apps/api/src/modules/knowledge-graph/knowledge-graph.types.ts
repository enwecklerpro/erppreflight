import { z } from 'zod';

/**
 * Canonical knowledge model types (Part 04 §4.3/4.4/4.7/4.8).
 *
 * The rest of the product depends on these normalized shapes only — never on the
 * response structure of a particular source (Cloudification Repository, ROSA, ...).
 */

export const KNOWLEDGE_OBJECT_TYPES = [
  'TABLE',
  'CDS_VIEW',
  'CLASS',
  'INTERFACE',
  'FUNCTION_MODULE',
  'BAPI',
  'FUNCTION_GROUP',
  'BADI',
  'ENHANCEMENT_SPOT',
  'BEHAVIOR_DEFINITION',
  'DATA_ELEMENT',
  'DOMAIN',
  'TABLE_TYPE',
  'AUTHORIZATION_OBJECT',
  'ODATA_SERVICE',
  'SERVICE_DEFINITION',
  'API',
  'IDOC_TYPE',
  'TRANSACTION_CODE',
  'FIORI_APP',
  'SSCUI',
  'CBC_ACTIVITY',
  'SCOPE_ITEM',
  'FORM_TEMPLATE',
  'BUSINESS_CONTEXT',
  'BUSINESS_OBJECT',
  'MESSAGE_CLASS',
  'TRANSFORMATION',
  'ATC_CHECK',
  'APPLICATION_JOB',
  'EVENT',
  'CUSTOM_OBJECT',
  'SAP_OBJECT',
] as const;
export type KnowledgeObjectType = (typeof KNOWLEDGE_OBJECT_TYPES)[number];
export const KnowledgeObjectTypeEnum = z.enum(KNOWLEDGE_OBJECT_TYPES);

export const RELATIONSHIP_TYPES = [
  'DEPENDS_ON',
  'USED_BY',
  'EXPOSED_BY',
  'SUCCESSOR_OF',
  'REPLACES',
  'RELATED_TO',
  'MAPPED_TO',
  'EXTENDS',
  'PROPAGATES_TO',
  'CONTROLLED_BY',
  'TRANSPORTED_IN',
  'REQUIRES',
  'BLOCKED_BY',
  'AVAILABLE_IN_RELEASE',
  'DEPRECATED_IN_RELEASE',
  'SUPPORTED_BY',
  'CONSUMES',
  'PRODUCES',
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];
export const RelationshipTypeEnum = z.enum(RELATIONSHIP_TYPES);

export const TRUST_LEVELS = [
  'OFFICIAL_REPOSITORY',
  'OFFICIAL_DOCUMENTATION',
  'OFFICIAL_SUPPORT',
  'OFFICIAL_COMMUNITY',
  'CURATED_RULE',
  'THIRD_PARTY',
  'CUSTOMER_EVIDENCE',
  'INFERRED',
] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

export const STATE_SCHEMES = ['RELEASE_CONTRACT', 'CLASSIC_API_CLASSIFICATION', 'CURATED'] as const;
export type StateScheme = (typeof STATE_SCHEMES)[number];

export const SUPPORT_STATES = [
  'RELEASED',
  'DEPRECATED',
  'NOT_RELEASED',
  'NOT_TO_BE_RELEASED_STABLE',
  'CLASSIC_API',
  'NO_API',
  'SUPPORTED',
  'BLOCKED',
  'UNKNOWN',
] as const;
export type SupportState = (typeof SUPPORT_STATES)[number];

export type CleanCoreLevel = 'A' | 'B' | 'C' | 'D';

/** Product / edition / release context a state is valid in. */
export interface ReleaseContext {
  productCode: string;
  productName: string;
  editionCode: string;
  editionName: string;
  deployment: 'CLOUD_PUBLIC' | 'CLOUD_PRIVATE' | 'ON_PREMISE' | 'BTP' | 'HYBRID';
  releaseCode: string;
  releaseLabel: string;
  featurePack: string | null;
  sortOrder: number;
  isRolling: boolean;
  description?: string;
}

export interface SuccessorRef {
  sapObjectType: string;
  objectKey: string;
  tadirObject?: string;
  tadirObjName?: string;
}

/** One normalized object state from one source document. */
export interface NormalizedObjectState {
  sapObjectType: string;
  objectKey: string;
  objectType: KnowledgeObjectType;
  tadirObject: string | null;
  tadirObjName: string | null;
  softwareComponent: string | null;
  applicationComponent: string | null;
  scheme: StateScheme;
  state: string;
  supportState: SupportState;
  cleanCoreLevel: CleanCoreLevel | null;
  successorClassification: string | null;
  successorConcept: string | null;
  successors: SuccessorRef[];
  labels: string[];
}

/** A retrieved and parsed source document (one file / one export). */
export interface SourceDocument {
  sourceKey: string;
  title: string;
  url: string | null;
  publisher: string;
  trustLevel: TrustLevel;
  release: ReleaseContext;
  scheme: StateScheme;
  sha256: string;
  bytes: number;
  etag: string | null;
  lastModified: string | null;
  sourceVersion: string | null;
  formatVersion: string | null;
  retrievedAt: string;
  records: NormalizedObjectState[];
  /** Records rejected by the parser (schema violations) — reported, never persisted. */
  rejectedRecords: number;
}

/** Released-object source adapter contract (C §28): domain code never sees raw shapes. */
export interface ReleasedObjectSource {
  readonly adapterId: string;
  readonly parserVersion: string;
  describe(): { adapterId: string; title: string; documents: Array<{ sourceKey: string; url: string | null }> };
  retrieve(): Promise<SourceDocument[]>;
}

export const CLOUDIFICATION_ADAPTER_ID = 'SAP_CLOUDIFICATION_REPOSITORY';
export const ROSA_FILE_ADAPTER_ID = 'ROSA_FILE_IMPORT';

// ---------------------------------------------------------------------------
// API-facing DTO schemas (Zod)
// ---------------------------------------------------------------------------

export const LookupQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  type: KnowledgeObjectTypeEnum.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type LookupQuery = z.infer<typeof LookupQuerySchema>;

export const NeighborhoodQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(3).default(1),
  limit: z.coerce.number().int().min(1).max(300).default(150),
});

export const ClassifyRequestSchema = z.object({
  names: z.array(z.string().trim().min(1).max(200)).min(1).max(5000),
  productCode: z.string().max(64).optional(),
  editionCode: z.string().max(64).optional(),
  releaseCode: z.string().max(64).optional(),
  targetRelease: z.string().max(64).optional(),
});
export type ClassifyRequest = z.infer<typeof ClassifyRequestSchema>;

export const CreateTenantObjectSchema = z.object({
  objectType: KnowledgeObjectTypeEnum,
  sapObjectType: z.string().trim().min(2).max(20).regex(/^[A-Z0-9_]+$/),
  objectKey: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_/$]+$/),
  displayName: z.string().trim().max(300).optional(),
  description: z.string().trim().max(4000).optional(),
});

export const CreateTenantRelationshipSchema = z.object({
  sourceObjectId: z.string().uuid(),
  targetObjectId: z.string().uuid(),
  relationshipType: RelationshipTypeEnum,
  confidenceClass: z.enum(['VERIFIED', 'RULE_DERIVED', 'INFERRED', 'UNKNOWN']).default('RULE_DERIVED'),
  note: z.string().trim().max(2000).optional(),
});

export const CuratedObjectSchema = z.object({
  objectType: KnowledgeObjectTypeEnum,
  sapObjectType: z.string().trim().min(2).max(20).regex(/^[A-Z0-9_]+$/),
  objectKey: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_/$]+$/),
  displayName: z.string().trim().max(300).optional(),
  description: z.string().trim().min(1).max(4000),
  evidenceSourceKey: z.string().trim().min(1).max(160),
});

export const ReviewTransitionSchema = z.object({
  to: z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'DEPRECATED', 'SUPERSEDED']),
});

/** Allowed review workflow transitions (Part 04 §4.12). */
export const REVIEW_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['IN_REVIEW'],
  IN_REVIEW: ['APPROVED', 'DRAFT'],
  APPROVED: ['PUBLISHED'],
  PUBLISHED: ['DEPRECATED', 'SUPERSEDED'],
  DEPRECATED: [],
  SUPERSEDED: [],
};
