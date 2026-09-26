import { z } from 'zod';

/**
 * API Change Guard stored baselines (migration 023): immutable copies of an OpenAPI 2/3 or OData EDMX
 * specification registered per project. Analyses compare a new specification against the explicitly
 * selected baseline or, by default, the project's active one.
 */
export const ApiBaselineFormatEnum = z.enum(['OPENAPI', 'EDMX']);
export type ApiBaselineFormat = z.infer<typeof ApiBaselineFormatEnum>;

/** POST /projects/:projectId/api-baselines — register a baseline from a CLEAN uploaded artifact. */
export const CreateApiBaselineSchema = z
  .object({
    fileId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    /** Defaults to the specification's info.version (OpenAPI) or a content-hash label (EDMX). */
    version: z.string().trim().min(1).max(100).optional(),
    /** Make this the project's active baseline (the first baseline of a project is always activated). */
    activate: z.boolean().optional(),
  })
  .strict();
export type CreateApiBaselineDto = z.infer<typeof CreateApiBaselineSchema>;

export const ApiBaselineSurfaceSchema = z
  .object({
    paths: z.number().int().nonnegative().optional(),
    operations: z.number().int().nonnegative().optional(),
    schemas: z.number().int().nonnegative().optional(),
    entityTypes: z.number().int().nonnegative().optional(),
    entitySets: z.number().int().nonnegative().optional(),
  })
  .strict();

export const ApiBaselineSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  format: ApiBaselineFormatEnum,
  specVersion: z.string().nullable(),
  version: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().positive(),
  sourceFileId: z.string().uuid().nullable(),
  sourceFileName: z.string().nullable(),
  apiTitle: z.string().nullable(),
  surface: ApiBaselineSurfaceSchema,
  isActive: z.boolean(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  activatedAt: z.string().nullable(),
});
export type ApiBaseline = z.infer<typeof ApiBaselineSchema>;
