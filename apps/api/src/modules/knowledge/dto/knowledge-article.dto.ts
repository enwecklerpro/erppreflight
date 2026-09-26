import { z } from 'zod';

export const KNOWLEDGE_LOCALES = ['en', 'de'] as const;
export const KNOWLEDGE_STATUSES = [
  'DRAFT',
  'TECHNICAL_REVIEW',
  'SEO_REVIEW',
  'PUBLISHED',
  'UPDATE_REQUIRED',
  'DEPRECATED',
  'ARCHIVED',
] as const;

export type KnowledgeArticleStatus = (typeof KNOWLEDGE_STATUSES)[number];

/**
 * Content workflow (Part 02 §2.13): draft → technical review → SEO review →
 * publish → update required → deprecated. ARCHIVED is the soft delete.
 * Public pages show PUBLISHED and UPDATE_REQUIRED articles (the latter flagged
 * and noindex); every other status is invisible to the public.
 */
export const KNOWLEDGE_TRANSITIONS: Record<KnowledgeArticleStatus, readonly KnowledgeArticleStatus[]> = {
  DRAFT: ['TECHNICAL_REVIEW', 'ARCHIVED'],
  TECHNICAL_REVIEW: ['SEO_REVIEW', 'DRAFT', 'ARCHIVED'],
  SEO_REVIEW: ['PUBLISHED', 'TECHNICAL_REVIEW', 'DRAFT', 'ARCHIVED'],
  PUBLISHED: ['UPDATE_REQUIRED', 'DEPRECATED', 'ARCHIVED'],
  UPDATE_REQUIRED: ['TECHNICAL_REVIEW', 'PUBLISHED', 'DEPRECATED', 'ARCHIVED'],
  DEPRECATED: ['ARCHIVED'],
  ARCHIVED: [],
};

export const PUBLIC_KNOWLEDGE_STATUSES: readonly KnowledgeArticleStatus[] = ['PUBLISHED', 'UPDATE_REQUIRED'];

export const KNOWLEDGE_PROVENANCES = [
  'OFFICIAL_SAP_DOCUMENTATION',
  'OFFICIAL_SAP_REPOSITORY',
  'CURATED_RULE',
  'EDITORIAL',
] as const;
export type KnowledgeProvenance = (typeof KNOWLEDGE_PROVENANCES)[number];

export function canTransition(from: string, to: string): boolean {
  return (KNOWLEDGE_TRANSITIONS[from as KnowledgeArticleStatus] ?? []).includes(to as KnowledgeArticleStatus);
}

export const KnowledgeLocaleSchema = z.enum(KNOWLEDGE_LOCALES);

export const KnowledgeSlugSchema = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be lower-case kebab-case');

const EngineTypeSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[A-Z0-9_]+$/, 'engine types are upper-case identifiers');

const SourceSchema = z.object({
  title: z.string().trim().min(3).max(200),
  // Only absolute https links are accepted as citations.
  url: z
    .string()
    .url()
    .max(500)
    .refine((u) => u.startsWith('https://'), 'source URLs must use https'),
});

const ArticleContentSchema = z.object({
  title: z.string().trim().min(5).max(200),
  summary: z.string().trim().min(20).max(500),
  bodyMarkdown: z.string().min(50).max(100_000),
  relatedEngineTypes: z.array(EngineTypeSchema).max(19).default([]),
  targetReleases: z.array(z.string().trim().min(2).max(80)).max(20).default([]),
  sources: z.array(SourceSchema).max(20).default([]),
  reviewedAt: z.string().datetime({ offset: true }).or(z.string().date()).nullable().optional(),
  status: z.enum(KNOWLEDGE_STATUSES).default('DRAFT'),
  provenance: z.enum(KNOWLEDGE_PROVENANCES).default('EDITORIAL'),
  changeNote: z.string().trim().max(500).optional(),
});

export const CreateKnowledgeArticleSchema = ArticleContentSchema.extend({
  slug: KnowledgeSlugSchema,
  locale: KnowledgeLocaleSchema,
}).strict();

export const UpdateKnowledgeArticleSchema = ArticleContentSchema.partial()
  .extend({ provenance: z.enum(KNOWLEDGE_PROVENANCES).optional() })
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== 'changeNote'), 'at least one field must change');

export type CreateKnowledgeArticleDto = z.infer<typeof CreateKnowledgeArticleSchema>;
export type UpdateKnowledgeArticleDto = z.infer<typeof UpdateKnowledgeArticleSchema>;

export const KnowledgeTransitionSchema = z
  .object({
    to: z.enum(KNOWLEDGE_STATUSES),
    note: z.string().trim().max(500).optional(),
    /** Required when flagging a published article UPDATE_REQUIRED. */
    reason: z.string().trim().min(5).max(500).optional(),
  })
  .strict()
  .refine((v) => v.to !== 'UPDATE_REQUIRED' || Boolean(v.reason), {
    message: 'reason is required when an article is flagged UPDATE_REQUIRED',
    path: ['reason'],
  });
export type KnowledgeTransitionDto = z.infer<typeof KnowledgeTransitionSchema>;
