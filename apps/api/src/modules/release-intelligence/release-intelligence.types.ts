import { z } from 'zod';

export const WATCH_TYPES = ['OBJECT', 'API', 'FINDING', 'GAP', 'SUCCESSOR_MAPPING', 'REQUIREMENT'] as const;

export const CreateWatchSchema = z
  .object({
    watchType: z.enum(WATCH_TYPES),
    objectId: z.string().uuid().optional(),
    findingId: z.string().uuid().optional(),
    releaseId: z.string().uuid().optional(),
    label: z.string().trim().min(1).max(300).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.watchType === 'FINDING' && !v.findingId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['findingId'], message: 'findingId is required for FINDING watches' });
    }
    if (v.watchType !== 'FINDING' && !v.objectId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['objectId'], message: 'objectId is required for this watch type' });
    }
  });
export type CreateWatch = z.infer<typeof CreateWatchSchema>;

export const UpdateWatchSchema = z
  .object({
    status: z.enum(['ACTIVE', 'PAUSED']).optional(),
    label: z.string().trim().min(1).max(300).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const DIFF_CHANGE_TYPES = [
  'ADDED',
  'REMOVED',
  'NEWLY_RELEASED',
  'NEWLY_DEPRECATED',
  'RELEASE_WITHDRAWN',
  'STATE_CHANGED',
  'SUCCESSOR_CHANGED',
  'ATTRIBUTES_CHANGED',
] as const;

export const SnapshotDiffQuerySchema = z
  .object({
    from: z.coerce.number().int().min(0),
    to: z.coerce.number().int().min(1),
    changeType: z.enum(DIFF_CHANGE_TYPES).optional(),
    releaseId: z.string().uuid().optional(),
    q: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .refine((v) => v.to > v.from, { message: '`to` must be a later snapshot than `from`' });

export const ReleaseDiffQuerySchema = z
  .object({
    fromRelease: z.string().uuid(),
    toRelease: z.string().uuid(),
    snapshotSeq: z.coerce.number().int().min(1).optional(),
    changeType: z.enum(DIFF_CHANGE_TYPES).optional(),
    q: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .refine((v) => v.fromRelease !== v.toRelease, { message: 'Choose two different releases' });

export const WatchListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
