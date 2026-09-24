import { z } from 'zod';
import { CleanCoreTierEnum, SeverityEnum } from './common';

/**
 * Standard SAP Technical Object Types (ABAP & DDIC).
 */
export const SapObjectTypeEnum = z.enum([
  'PROG', // ABAP Report / Program
  'CLAS', // ABAP OO Global Class
  'INTF', // ABAP OO Global Interface
  'FUGR', // Function Group / Function Module
  'TABL', // Database Table / Structure
  'CDS',  // Core Data Services View / Entity (DDLS)
  'VIEW', // Classic Database View
  'DTEL', // Data Element
  'DOMA', // Domain
  'TRAN', // Transaction Code
  'AUTH', // Authorization Object (SUSO)
  'DEVC', // ABAP Package / Development Class
  'FORM', // Smart Form / SAPscript / Adobe XDP
  'BADI', // BAdI Definition / Implementation
  'ENHO', // Enhancement Implementation / Spot
  'WSDL', // Enterprise Service / Web Service
]);
export type SapObjectType = z.infer<typeof SapObjectTypeEnum>;

/**
 * Modification & Governance Status.
 */
export const ModificationStatusEnum = z.enum([
  'CUSTOM_Z',        // Pure custom object in customer namespace (Z*, Y*)
  'CUSTOM_PARTNER',  // Partner namespace object (/PARTNER/)
  'SAP_STANDARD',    // Unmodified standard SAP asset
  'SAP_MODIFIED',    // Standard SAP asset modified with SSCR key (Tier 3 Blocker)
  'SAP_ENHANCED',    // Standard SAP asset extended via explicit/implicit BAdI
]);
export type ModificationStatus = z.infer<typeof ModificationStatusEnum>;

/**
 * Object Complexity Metric.
 */
export const ComplexityLevelEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']);
export type ComplexityLevel = z.infer<typeof ComplexityLevelEnum>;

export const ComplexityMetricsSchema = z.object({
  score: z.number().min(0).max(100),
  level: ComplexityLevelEnum,
  linesOfCode: z.number().int().nonnegative(),
  statementsCount: z.number().int().nonnegative(),
  cyclomaticComplexity: z.number().int().nonnegative(),
});
export type ComplexityMetrics = z.infer<typeof ComplexityMetricsSchema>;

/**
 * Object Inbound/Outbound Dependency Reference.
 */
export const ObjectDependencySchema = z.object({
  targetName: z.string(),
  targetType: z.string(),
  direction: z.enum(['INBOUND', 'OUTBOUND']),
  dependencyType: z.enum([
    'DIRECT_SQL',
    'METHOD_CALL',
    'FUNCTION_CALL',
    'CDS_ASSOCIATION',
    'BADI_CALL',
    'TABLE_REFERENCE',
    'INCLUDE',
  ]),
  releaseContract: z.enum(['RELEASED_C1', 'NOT_RELEASED', 'DEPRECATED', 'INTERNAL_ONLY']),
  cleanCoreTier: CleanCoreTierEnum,
  isCleanCoreHazard: z.boolean(),
  recommendedSuccessor: z.string().optional().nullable(),
});
export type ObjectDependency = z.infer<typeof ObjectDependencySchema>;

/**
 * Related Finding Summary attached to an Object.
 */
export const ObjectFindingSummarySchema = z.object({
  totalCount: z.number().int().nonnegative(),
  blockerCount: z.number().int().nonnegative(),
  criticalCount: z.number().int().nonnegative(),
  majorCount: z.number().int().nonnegative(),
  minorCount: z.number().int().nonnegative(),
  infoCount: z.number().int().nonnegative(),
  highestSeverity: SeverityEnum.optional().nullable(),
  findings: z
    .array(
      z.object({
        id: z.string().uuid(),
        ruleId: z.string(),
        severity: SeverityEnum,
        title: z.string(),
        remediation: z.string(),
      })
    )
    .default([]),
});
export type ObjectFindingSummary = z.infer<typeof ObjectFindingSummarySchema>;

/**
 * Full SAP Object Inventory Record.
 */
export const SapObjectSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  organizationId: z.string().uuid().optional().nullable(),
  name: z.string().min(1),
  objectType: SapObjectTypeEnum,
  description: z.string().default(''),
  package: z.string().default('$TMP'),
  softwareComponent: z.string().default('ZCUSTOM'),
  cleanCoreTier: CleanCoreTierEnum,
  modificationStatus: ModificationStatusEnum,
  complexity: ComplexityMetricsSchema,
  findingSummary: ObjectFindingSummarySchema,
  lastChangedAt: z.string(), // ISO 8601
  lastChangedBy: z.string(),
  transportRequest: z.string().optional().nullable(),
  dependencies: z.array(ObjectDependencySchema).default([]),
  createdAt: z.string().optional().nullable(),
  updatedAt: z.string().optional().nullable(),
});
export type SapObject = z.infer<typeof SapObjectSchema>;

/**
 * Paginated SAP Object List API Response.
 */
export const SapObjectListResponseSchema = z.object({
  items: z.array(SapObjectSchema),
  totalCount: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
  facets: z.object({
    typeCounts: z.record(z.number()),
    tierCounts: z.record(z.number()),
    packageCounts: z.record(z.number()),
    findingsStatusCounts: z.object({
      withFindings: z.number(),
      clean: z.number(),
    }),
  }),
});
export type SapObjectListResponse = z.infer<typeof SapObjectListResponseSchema>;
