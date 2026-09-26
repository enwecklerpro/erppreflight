import { z } from 'zod';

export const KNOWLEDGE_LOCALES = ['en', 'de'] as const;
export const KNOWLEDGE_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'PUBLISHED',
  'UPDATE_REQUIRED',
  'DEPRECATED',
  'ARCHIVED',
] as const;

export type KnowledgeArticleStatus = (typeof KNOWLEDGE_STATUSES)[number];

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
  changeNote: z.string().trim().max(500).optional(),
});

export const CreateKnowledgeArticleSchema = ArticleContentSchema.extend({
  slug: KnowledgeSlugSchema,
  locale: KnowledgeLocaleSchema,
}).strict();

export const UpdateKnowledgeArticleSchema = ArticleContentSchema.partial()
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== 'changeNote'), 'at least one field must change');

export type CreateKnowledgeArticleDto = z.infer<typeof CreateKnowledgeArticleSchema>;
export type UpdateKnowledgeArticleDto = z.infer<typeof UpdateKnowledgeArticleSchema>;
