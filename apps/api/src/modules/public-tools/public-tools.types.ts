import { z } from 'zod';
import { KNOWLEDGE_OBJECT_TYPES } from '../knowledge-graph/knowledge-graph.types';
import { DIFF_CHANGE_TYPES } from '../release-intelligence/release-intelligence.types';
import { OBJECT_SLUG_PATTERN } from '@erppreflight/schemas';

/**
 * Request contracts of the public free tools (Part 01 §1.11). Every public
 * endpoint reads GLOBAL, PUBLISHED knowledge only (Part 04 §4.14).
 */

const Query = z.string().trim().min(1).max(120);

export const SuccessorLookupQuerySchema = z.object({
  q: Query,
  limit: z.coerce.number().int().min(1).max(20).default(10),
});
export type SuccessorLookupQuery = z.infer<typeof SuccessorLookupQuerySchema>;

/** Object types whose release lifecycle is an API contract (API deprecation lookup). */
export const API_OBJECT_TYPES = [
  'CDS_VIEW',
  'CLASS',
  'INTERFACE',
  'FUNCTION_MODULE',
  'BAPI',
  'BEHAVIOR_DEFINITION',
  'ODATA_SERVICE',
  'SERVICE_DEFINITION',
  'BADI',
  'API',
] as const satisfies readonly (typeof KNOWLEDGE_OBJECT_TYPES)[number][];

export const ApiLifecycleQuerySchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    type: z.enum(API_OBJECT_TYPES).optional(),
    /** Without q: browse APIs that are DEPRECATED in the latest release of an edition. */
    deprecated: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .refine((v) => Boolean(v.q) || v.deprecated, { message: 'q is required unless deprecated=true' });
export type ApiLifecycleQuery = z.infer<typeof ApiLifecycleQuerySchema>;

export const PublicReleaseDiffQuerySchema = z.object({
  fromRelease: z.string().uuid(),
  toRelease: z.string().uuid(),
  changeType: z.enum(DIFF_CHANGE_TYPES).optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const PublicSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
  locale: z.enum(['en', 'de']).default('en'),
});

export const SeoSlugSchema = z.string().regex(OBJECT_SLUG_PATTERN, 'invalid object slug');

export const SitemapPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

/** 90 000 characters keeps the JSON request under the API's 100 KB body limit. */
export const XML_CHECK_MAX_CHARS = 90_000;

export const XmlFieldCheckSchema = z
  .object({
    xml: z.string().min(1, 'Paste or upload an XML document').max(XML_CHECK_MAX_CHARS, 'The XML document is larger than 90 000 characters'),
    path: z
      .string()
      .trim()
      .min(1, 'Enter a field path')
      .max(300)
      .regex(/^\//, "The field path must start with '/' or '//'"),
    namespaces: z
      .record(z.string().regex(/^[A-Za-z_][\w.-]*$/).max(60), z.string().min(1).max(500))
      .optional()
      .refine((v) => !v || Object.keys(v).length <= 20, 'At most 20 namespace prefixes'),
  })
  .strict();
export type XmlFieldCheckInput = z.infer<typeof XmlFieldCheckSchema>;

/** Response of the analysis service's stateless checker (validated before it is returned). */
export const XmlFieldCheckResultSchema = z.object({
  path: z.string(),
  bytes: z.number().int(),
  wellFormed: z.boolean(),
  rejected: z.string().nullable(),
  error: z.string().nullable(),
  exists: z.boolean(),
  matchCount: z.number().int(),
  matches: z.array(
    z.object({
      kind: z.enum(['element', 'attribute']),
      path: z.string(),
      localName: z.string(),
      namespaceUri: z.string().nullable(),
      line: z.number().int(),
      column: z.number().int(),
      value: z.string().nullable(),
      valueTruncated: z.boolean(),
      childElementCount: z.number().int(),
    })
  ),
  issues: z.array(
    z.object({
      code: z.string(),
      severity: z.enum(['ERROR', 'WARNING', 'INFO']),
      message: z.string(),
      step: z.string().nullable(),
    })
  ),
  document: z
    .object({
      rootLocalName: z.string(),
      rootNamespaceUri: z.string().nullable(),
      namespaces: z.array(z.object({ prefix: z.string(), uri: z.string(), line: z.number().int() })),
      elementCount: z.number().int(),
      maxDepth: z.number().int(),
    })
    .nullable(),
});
export type XmlFieldCheckResult = z.infer<typeof XmlFieldCheckResultSchema>;

/** Engine catalog of the analysis service (GET /api/v1/engines), public product documentation. */
export const EngineCatalogSchema = z.array(
  z
    .object({
      engine_type: z.string(),
      name: z.string(),
      description: z.string(),
      version: z.string(),
      domain: z.string(),
      target_releases: z.array(z.string()).default([]),
      supported_artifact_types: z.array(z.string()).default([]),
      rule_count: z.number().int(),
      rule_codes: z.array(z.string()).default([]),
      input_validation_rule_codes: z.array(z.string()).default([]),
      rules: z
        .array(
          z.object({
            code: z.string(),
            title: z.string(),
            defaultSeverity: z.string(),
            category: z.string(),
            remediation: z.string(),
          })
        )
        .default([]),
      input_contract: z
        .object({
          acceptedFormats: z.array(z.string()).default([]),
          summary: z.string().default(''),
          required: z.array(z.string()).default([]),
          notes: z.array(z.string()).default([]),
        })
        .passthrough()
        .nullable()
        .optional(),
      health: z.object({ status: z.string().optional() }).passthrough().nullable().optional(),
    })
    .passthrough()
);
export type EngineCatalog = z.infer<typeof EngineCatalogSchema>;
