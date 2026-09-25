import { z } from 'zod';
import { TargetReleaseEnum } from './common';

export const EnvironmentTierEnum = z.enum(['DEV', 'TEST', 'QA', 'PROD']);
export type EnvironmentTier = z.infer<typeof EnvironmentTierEnum>;

export const DriftClassificationEnum = z.enum([
  'KNOWN_BASELINE_RISK',
  'NEWLY_INTRODUCED_RISK',
  'RESOLVED_RISK',
]);
export type DriftClassification = z.infer<typeof DriftClassificationEnum>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  targetRelease: TargetReleaseEnum.default('S4H_2023'),
  environments: z.array(EnvironmentTierEnum).default(['DEV']),
  baselineAnalysisId: z.string().uuid().optional().nullable(),
  createdBy: z.string().uuid().optional().nullable(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const DriftSummarySchema = z.object({
  knownBaselineRisks: z.number().int().nonnegative(),
  newlyIntroducedRisks: z.number().int().nonnegative(),
  resolvedRisks: z.number().int().nonnegative(),
  scoreDelta: z.number(),
});
export type DriftSummary = z.infer<typeof DriftSummarySchema>;

export const SetBaselineRequestSchema = z.object({
  analysisId: z.string().uuid(),
});
export type SetBaselineRequest = z.infer<typeof SetBaselineRequestSchema>;

export const QuarantineStatusEnum = z.enum([
  'PENDING_SCAN',
  'SCANNING',
  'CLEAN',
  'QUARANTINED',
  'REJECTED',
]);
export type QuarantineStatus = z.infer<typeof QuarantineStatusEnum>;

export const RedactionStatusEnum = z.enum(['PENDING', 'REDACTED', 'PASSED']);
export type RedactionStatus = z.infer<typeof RedactionStatusEnum>;

export const UploadedFileSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  fileName: z.string().min(1).max(500),
  fileSize: z.number().int().nonnegative(),
  mimeType: z.string().max(255),
  storagePath: z.string().max(1000),
  checksumSha256: z.string().length(64),
  quarantineStatus: QuarantineStatusEnum.default('PENDING_SCAN'),
  redactionStatus: RedactionStatusEnum.default('PENDING'),
  metadata: z.record(z.unknown()).default({}),
  uploadedBy: z.string().uuid().optional().nullable(),
  createdAt: z.string().datetime().optional(),
});
export type UploadedFile = z.infer<typeof UploadedFileSchema>;

export const RequestPresignedUploadSchema = z.object({
  fileName: z.string().min(1).max(500),
  fileSize: z.number().int().positive().max(500 * 1024 * 1024), // Max 500 MB
  mimeType: z.string().min(1).max(255),
});
export type RequestPresignedUploadDto = z.infer<typeof RequestPresignedUploadSchema>;

export const ConfirmUploadSchema = z.object({
  fileId: z.string().uuid(),
});
export type ConfirmUploadDto = z.infer<typeof ConfirmUploadSchema>;

export const PresignedDownloadResponseSchema = z.object({
  downloadUrl: z.string().url(),
  expiresInSeconds: z.number().int().positive(),
  fileName: z.string(),
  checksumSha256: z.string().length(64),
});
export type PresignedDownloadResponse = z.infer<typeof PresignedDownloadResponseSchema>;
