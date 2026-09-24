import { z } from 'zod';
import { SeverityEnum } from './common';

export const ExportFormatEnum = z.enum(['PDF', 'JSON_BUNDLE', 'XLSX', 'CSV', 'ZIP_ALL']);
export type ExportFormat = z.infer<typeof ExportFormatEnum>;

export const TriggerExportSchema = z.object({
  format: ExportFormatEnum.default('PDF'),
  whiteLabel: z
    .object({
      companyName: z.string().optional(),
      logoUrl: z.string().url().optional(),
      primaryColor: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional(),
      customDisclaimer: z.string().optional(),
    })
    .optional(),
  includeEvidenceSnippets: z.boolean().default(true),
  filterMinSeverity: SeverityEnum.default('INFO'),
});
export type TriggerExportDto = z.infer<typeof TriggerExportSchema>;

export const ExportJobResponseSchema = z.object({
  exportJobId: z.string().uuid(),
  analysisId: z.string().uuid(),
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']),
  estimatedSeconds: z.number().default(5),
});
export type ExportJobResponse = z.infer<typeof ExportJobResponseSchema>;

export const ReportDownloadResponseSchema = z.object({
  reportId: z.string().uuid(),
  format: ExportFormatEnum,
  fileName: z.string(),
  downloadUrl: z.string().url(),
  expiresAt: z.string().datetime(),
  checksumSha256: z.string().length(64),
});
export type ReportDownloadResponse = z.infer<typeof ReportDownloadResponseSchema>;

export const ReportRecordSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  analysisId: z.string().uuid(),
  format: ExportFormatEnum,
  fileName: z.string(),
  fileSize: z.number().int().nonnegative(),
  s3Key: z.string(),
  checksumSha256: z.string().length(64),
  createdBy: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime().optional(),
});
export type ReportRecord = z.infer<typeof ReportRecordSchema>;
