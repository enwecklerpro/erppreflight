/**
 * ERP Preflight — Commercial & governance API client (billing, usage, audit
 * log, retention, report exports, super-admin operations).
 *
 * Every response is validated with Zod at the boundary (Axiom 1.2); a contract
 * drift surfaces as an explicit error state instead of a half-rendered page.
 */
import { z } from 'zod';
import {
  BillingOverviewSchema,
  InvoiceSummarySchema,
  PlanTierEnum,
  RetentionSettingsSchema,
  ReportBrandingSchema,
  ReportTypeEnum,
  type ReportBranding,
  type BillingOverview,
  type InvoiceSummary,
  type PlanTierId,
  type RetentionSettings,
} from '@erppreflight/schemas';
import { customInstance, downloadApiFile, type DownloadedFile } from './custom-instance';

export class ContractError extends Error {
  constructor(endpoint: string, issues: z.ZodIssue[]) {
    super(
      `Unexpected response from ${endpoint}: ${issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
        .join('; ')}`
    );
    this.name = 'ContractError';
  }
}

function parse<S extends z.ZodTypeAny>(schema: S, endpoint: string, data: unknown): z.output<S> {
  const res = schema.safeParse(data);
  if (!res.success) throw new ContractError(endpoint, res.error.issues);
  return res.data;
}

// -----------------------------------------------------------------------------
// Billing & plans
// -----------------------------------------------------------------------------

export const PlanCatalogEntrySchema = z.object({
  tier: PlanTierEnum,
  displayName: z.string(),
  summary: z.string(),
  selfServe: z.boolean(),
  monthlyPriceEur: z.number().nullable(),
  currency: z.string(),
  limits: z.record(z.string(), z.number()),
  features: z.record(z.string(), z.boolean()),
  retention: z.object({
    auditLogDays: z.number(),
    maxArtifactRetentionDays: z.number(),
    maxReportRetentionDays: z.number(),
  }),
  supportSlaHours: z.number(),
  purchasable: z.boolean(),
});
export type PlanCatalogEntry = z.infer<typeof PlanCatalogEntrySchema>;

const PlansResponseSchema = z.object({
  plans: z.array(PlanCatalogEntrySchema),
  provider: BillingOverviewSchema.shape.provider,
});

export async function fetchBillingOverview(): Promise<BillingOverview> {
  return parse(BillingOverviewSchema, '/billing/overview', await customInstance('/billing/overview'));
}

export async function fetchPlanCatalog() {
  return parse(PlansResponseSchema, '/billing/plans', await customInstance('/billing/plans'));
}

const InvoicesResponseSchema = z.object({ configured: z.boolean(), invoices: z.array(InvoiceSummarySchema) });
export async function fetchInvoices(): Promise<{ configured: boolean; invoices: InvoiceSummary[] }> {
  return parse(InvoicesResponseSchema, '/billing/invoices', await customInstance('/billing/invoices'));
}

const RedirectSchema = z.object({ url: z.string().url() });
const CheckoutSchema = RedirectSchema.extend({ sessionId: z.string() });

export async function startCheckout(targetTier: PlanTierId, returnUrl: string) {
  const body = JSON.stringify({ targetTier, returnUrl });
  return parse(CheckoutSchema, '/billing/checkout', await customInstance('/billing/checkout', { method: 'POST', body }));
}

export async function openBillingPortal(returnUrl: string) {
  const body = JSON.stringify({ returnUrl });
  return parse(RedirectSchema, '/billing/portal', await customInstance('/billing/portal', { method: 'POST', body }));
}

// -----------------------------------------------------------------------------
// Audit log
// -----------------------------------------------------------------------------

export const AuditLogItemSchema = z.object({
  id: z.string().uuid(),
  sequenceNum: z.number(),
  actorType: z.string(),
  actorId: z.string().nullable(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  clientIp: z.string().nullable(),
  prevHash: z.string().nullable(),
  currentHash: z.string(),
  createdAt: z.string(),
});
export type AuditLogItem = z.infer<typeof AuditLogItemSchema>;

const AuditLogPageSchema = z.object({
  items: z.array(AuditLogItemSchema),
  nextCursor: z.number().nullable(),
  total: z.number(),
});
export type AuditLogPage = z.infer<typeof AuditLogPageSchema>;

export interface AuditLogFilters {
  action?: string;
  targetType?: string;
  from?: string;
  to?: string;
  cursor?: number;
  limit?: number;
}

export async function fetchAuditLog(filters: AuditLogFilters): Promise<AuditLogPage> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const path = `/audit/log${qs.toString() ? `?${qs}` : ''}`;
  return parse(AuditLogPageSchema, '/audit/log', await customInstance(path));
}

const LedgerVerificationSchema = z.object({
  isValid: z.boolean(),
  totalEventsVerified: z.number(),
  genesisEventId: z.string().nullable().optional(),
  tipEventId: z.string().nullable().optional(),
  anomalies: z.array(
    z.object({
      anomalyType: z.string(),
      eventIndex: z.number(),
      eventId: z.string(),
      expectedValue: z.string(),
      actualValue: z.string(),
    })
  ),
  verifiedAt: z.string(),
});
export type LedgerVerification = z.infer<typeof LedgerVerificationSchema>;

export async function verifyAuditLedger(): Promise<LedgerVerification> {
  return parse(LedgerVerificationSchema, '/audit/verify', await customInstance('/audit/verify'));
}

// -----------------------------------------------------------------------------
// Retention
// -----------------------------------------------------------------------------

const RetentionResponseSchema = RetentionSettingsSchema.extend({
  planMaximums: z
    .object({ tier: z.string(), maxArtifactRetentionDays: z.number(), maxReportRetentionDays: z.number() })
    .nullable(),
});
export type RetentionResponse = z.infer<typeof RetentionResponseSchema>;

export async function fetchRetentionSettings(): Promise<RetentionResponse> {
  return parse(RetentionResponseSchema, '/retention/settings', await customInstance('/retention/settings'));
}

export async function updateRetentionSettings(settings: RetentionSettings): Promise<RetentionResponse> {
  const body = JSON.stringify(RetentionSettingsSchema.parse(settings));
  return parse(
    RetentionResponseSchema,
    '/retention/settings',
    await customInstance('/retention/settings', { method: 'PUT', body })
  );
}

// -----------------------------------------------------------------------------
// Report exports (project workspace)
// -----------------------------------------------------------------------------

export const EXPORT_FORMATS = ['PDF', 'XLSX', 'CSV', 'JSON_BUNDLE', 'HTML_OFFLINE', 'ZIP_ALL'] as const;
export type ReportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_FORMAT_LABELS: Record<ReportFormat, string> = {
  PDF: 'PDF report',
  XLSX: 'Excel (XLSX)',
  CSV: 'CSV matrix',
  JSON_BUNDLE: 'JSON bundle',
  HTML_OFFLINE: 'Offline HTML',
  ZIP_ALL: 'All formats (ZIP)',
};

const ExportResultSchema = z.object({
  reportId: z.string().uuid(),
  format: z.enum(EXPORT_FORMATS),
  fileName: z.string(),
  checksumSha256: z.string().optional(),
});

export const ReportRecordSchema = z
  .object({
    id: z.string().uuid(),
    format: z.string(),
    report_type: z.string().nullable().optional(),
    file_name: z.string(),
    file_size: z.union([z.number(), z.string()]).transform((v) => Number(v)),
    checksum_sha256: z.string().nullable().optional(),
    created_at: z.string(),
  })
  .transform((r) => ({
    id: r.id,
    format: r.format,
    reportType: r.report_type ?? 'TECHNICAL',
    fileName: r.file_name,
    fileSize: r.file_size,
    checksumSha256: r.checksum_sha256 ?? null,
    createdAt: r.created_at,
  }));
export type ReportRecordItem = z.output<typeof ReportRecordSchema>;

export async function fetchAnalysisReports(projectId: string, analysisId: string): Promise<ReportRecordItem[]> {
  const path = `/projects/${encodeURIComponent(projectId)}/analyses/${encodeURIComponent(analysisId)}/reports`;
  return parse(z.array(ReportRecordSchema), 'reports list', await customInstance(path));
}

/** Generates an export (POST) and returns the stored report reference. */
export const REPORT_TYPES = ReportTypeEnum.options;
export type ReportTypeId = (typeof REPORT_TYPES)[number];
export const REPORT_TYPE_LABELS: Record<ReportTypeId, string> = {
  TECHNICAL: 'Technical findings',
  EXECUTIVE: 'Executive summary',
  PROJECT_READINESS: 'Project readiness',
  MIGRATION_BLOCKER: 'Migration blockers',
  CLEAN_CORE: 'Clean Core',
  AUDIT: 'Audit (with audit trail)',
};

export async function generateReport(
  projectId: string,
  analysisId: string,
  format: ReportFormat,
  reportType: ReportTypeId = 'TECHNICAL'
) {
  const path = `/projects/${encodeURIComponent(projectId)}/analyses/${encodeURIComponent(analysisId)}/export`;
  return parse(
    ExportResultSchema,
    'export',
    await customInstance(path, { method: 'POST', body: JSON.stringify({ format, reportType }) })
  );
}

/** Authenticated download through the API (never a bare link to object storage). */
export function downloadReportFile(reportId: string, fallbackFileName: string): Promise<DownloadedFile> {
  return downloadApiFile(`/reports/${encodeURIComponent(reportId)}/file`, fallbackFileName);
}

// -----------------------------------------------------------------------------
// Super admin (platform operators only; SuperAdminGuard on the API)
// -----------------------------------------------------------------------------

const QueueSnapshotSchema = z.object({
  queueName: z.string(),
  status: z.string(),
  counts: z.record(z.string(), z.number()),
});

export const IncidentsSchema = z.object({
  generatedAt: z.string(),
  queues: z.array(QueueSnapshotSchema),
  failedJobs: z.array(
    z.object({
      queue: z.string(),
      jobId: z.union([z.string(), z.number()]).nullable().optional(),
      name: z.string(),
      organizationId: z.string().nullable(),
      analysisId: z.string().nullable(),
      failedReason: z.string(),
      attemptsMade: z.number(),
      failedAt: z.string().nullable(),
    })
  ),
  failedAnalyses: z.array(
    z.object({
      id: z.string(),
      organizationId: z.string(),
      organizationName: z.string(),
      projectId: z.string(),
      engineTypes: z.unknown(),
      createdAt: z.string(),
      completedAt: z.string().nullable(),
    })
  ),
  recentFailureEvents: z.array(
    z.object({
      organizationId: z.string(),
      organizationName: z.string(),
      action: z.string(),
      resourceType: z.string(),
      resourceId: z.string().nullable(),
      createdAt: z.string(),
      error: z.string().nullable(),
      httpStatus: z.string().nullable(),
    })
  ),
});
export type IncidentsData = z.infer<typeof IncidentsSchema>;

export async function fetchAdminIncidents(): Promise<IncidentsData> {
  return parse(IncidentsSchema, '/admin/incidents', await customInstance('/admin/incidents'));
}

export const BusinessMetricsSchema = z.object({
  generatedAt: z.string(),
  tenants: z.object({
    total: z.number(),
    byEffectiveTier: z.record(z.string(), z.number()),
    bySubscriptionStatus: z.record(z.string(), z.number()),
    activeTrials: z.number(),
    activeLast30Days: z.number(),
  }),
  activeUsersLast30Days: z.number(),
  revenue: z.object({
    estimatedMrrEur: z.number(),
    estimatedArrEur: z.number(),
    unpricedPaidTenants: z.number(),
    basis: z.string(),
  }),
  analysesPerDay: z.array(z.object({ day: z.string(), total: z.number(), failed: z.number() })),
  analysisErrorRate7d: z.number().nullable(),
  analyses7d: z.object({ total: z.number(), failed: z.number() }),
  storageBytes: z.number(),
});
export type BusinessMetrics = z.infer<typeof BusinessMetricsSchema>;

export async function fetchAdminBusiness(): Promise<BusinessMetrics> {
  return parse(BusinessMetricsSchema, '/admin/business', await customInstance('/admin/business'));
}

export const EngineRegistrySchema = z.object({
  engines: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      version: z.string().nullable(),
      supportedArtifactTypes: z.array(z.string()),
      status: z.string(),
    })
  ),
  summary: z.object({
    totalEngines: z.number().nullable(),
    registeredCount: z.number(),
    serviceStatus: z.string(),
    serviceVersion: z.string().nullable(),
    checkedAt: z.string(),
    error: z.string().optional(),
  }),
});
export type EngineRegistry = z.infer<typeof EngineRegistrySchema>;

export async function fetchAdminEngines(): Promise<EngineRegistry> {
  return parse(EngineRegistrySchema, '/admin/engines', await customInstance('/admin/engines'));
}

const TenantSearchItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  planTier: z.string(),
  status: z.string(),
  createdAt: z.string(),
});
export type TenantSearchItem = z.infer<typeof TenantSearchItemSchema>;

export async function searchAdminTenants(q: string): Promise<TenantSearchItem[]> {
  return parse(
    z.array(TenantSearchItemSchema),
    '/admin/tenants/search',
    await customInstance(`/admin/tenants/search?q=${encodeURIComponent(q)}`)
  );
}

export const TenantDetailSchema = z.object({
  organization: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    status: z.string(),
    createdAt: z.string(),
    planTier: z.string(),
    subscriptionStatus: z.string(),
    currentPeriodEnd: z.string().nullable(),
    cancelAtPeriodEnd: z.boolean(),
    hasBillingAccount: z.boolean(),
    trial: z.object({ tier: z.string().nullable(), startedAt: z.string().nullable(), endsAt: z.string().nullable() }),
    limitOverrides: z.record(z.string(), z.number()),
    retention: z.object({
      artifactRetentionDays: z.number().nullable(),
      reportRetentionDays: z.number().nullable(),
    }),
  }),
  usage: z
    .object({
      effectiveTier: z.string(),
      meters: z.array(z.object({ key: z.string(), used: z.number(), limit: z.number(), unlimited: z.boolean(), exceeded: z.boolean() })),
    })
    .passthrough()
    .nullable(),
  members: z.array(
    z.object({ id: z.string(), email: z.string(), fullName: z.string().nullable(), status: z.string(), role: z.string() }).passthrough()
  ),
  projects: z.array(z.object({ id: z.string(), name: z.string(), createdAt: z.string() })),
  recentAnalyses: z.array(
    z
      .object({
        id: z.string(),
        projectId: z.string(),
        status: z.string(),
        createdAt: z.string(),
        findingsCount: z.number(),
      })
      .passthrough()
  ),
  recentReports: z.array(
    z.object({ id: z.string(), format: z.string(), createdAt: z.string() }).passthrough()
  ),
  auditTail: z.array(
    z.object({ sequenceNum: z.union([z.string(), z.number()]), action: z.string(), createdAt: z.string() }).passthrough()
  ),
});
export type TenantDetail = z.infer<typeof TenantDetailSchema>;

export async function fetchAdminTenantDetail(id: string): Promise<TenantDetail> {
  return parse(TenantDetailSchema, '/admin/tenants/:id', await customInstance(`/admin/tenants/${encodeURIComponent(id)}`));
}

export async function setAdminTenantLimits(id: string, overrides: Record<string, number>) {
  return customInstance(`/admin/tenants/${encodeURIComponent(id)}/limits`, {
    method: 'PATCH',
    body: JSON.stringify(overrides),
  });
}

export async function setAdminTenantPlan(id: string, planTier: PlanTierId) {
  return customInstance(`/admin/tenants/${encodeURIComponent(id)}/plan`, {
    method: 'PATCH',
    body: JSON.stringify({ planTier }),
  });
}

// -----------------------------------------------------------------------------
// Formatting helpers shared by the commercial pages
// -----------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

export const METER_LABELS: Record<string, string> = {
  projects: 'Projects',
  analysesPerMonth: 'Analyses this month',
  landscapes: 'SAP landscapes',
  storageBytes: 'Storage',
  exportsPerMonth: 'Report exports this month',
  aiTokensPerMonth: 'AI tokens this month',
  teamMembers: 'Team members',
};

export function formatMeterValue(key: string, value: number): string {
  if (key === 'storageBytes') return formatBytes(value);
  return new Intl.NumberFormat('en-US').format(value);
}

// -----------------------------------------------------------------------------
// Report branding (Professional plan and higher)
// -----------------------------------------------------------------------------

export async function fetchReportBranding(): Promise<ReportBranding> {
  return parse(ReportBrandingSchema, '/reports/branding', await customInstance('/reports/branding'));
}

export async function updateReportBranding(branding: ReportBranding): Promise<ReportBranding> {
  return parse(
    ReportBrandingSchema,
    '/reports/branding',
    await customInstance('/reports/branding', { method: 'PUT', body: JSON.stringify(ReportBrandingSchema.parse(branding)) })
  );
}
