import { z } from 'zod';
import { SeverityEnum } from './common';

export const ExportFormatEnum = z.enum(['PDF', 'JSON_BUNDLE', 'XLSX', 'CSV', 'ZIP_ALL', 'HTML_OFFLINE']);
export type ExportFormat = z.infer<typeof ExportFormatEnum>;

/** Report types (spec 01 §1.9, C §19). Each selects and frames findings differently. */
export const ReportTypeEnum = z.enum([
  'TECHNICAL',
  'EXECUTIVE',
  'PROJECT_READINESS',
  'MIGRATION_BLOCKER',
  'CLEAN_CORE',
  'AUDIT',
]);
export type ReportType = z.infer<typeof ReportTypeEnum>;

/** Tenant report branding (Professional and higher plans). */
export const ReportBrandingSchema = z
  .object({
    companyName: z.string().trim().min(1).max(120).optional(),
    primaryColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
    customDisclaimer: z.string().trim().max(1000).optional(),
  })
  .strict();
export type ReportBranding = z.infer<typeof ReportBrandingSchema>;

export const TriggerExportSchema = z.object({
  format: ExportFormatEnum.default('PDF'),
  reportType: ReportTypeEnum.default('TECHNICAL'),
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
