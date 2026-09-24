/**
 * ERP Preflight — Canonical Hierarchical Query Key Factory
 * Location: apps/web/src/lib/query/query-keys.ts
 *
 * Implements:
 * - Deterministic, type-safe query key tuples (`as const`)
 * - Prefix matching support for fine-grained or broad cache invalidation
 * - Complete domain coverage: projects, findings, objects, analysis, tenants, transports, audit, exports
 * - Multi-tenant scoping and parametric filter isolation
 */

import type {
  EngineType,
  TargetRelease,
  CleanCoreTier,
  Severity,
  ConfidenceClass,
} from '@erppreflight/schemas';

// --- Filter Type Contracts ---

export interface ProjectListFilters {
  search?: string;
  targetRelease?: TargetRelease;
  page?: number;
  limit?: number;
}

export interface FindingFilters {
  projectId?: string;
  engineType?: EngineType;
  severity?: Severity;
  confidence?: ConfidenceClass;
  category?: string;
  search?: string;
  ruleId?: string;
  affectedObject?: string;
  page?: number;
  limit?: number;
}

export interface ObjectFilters {
  projectId?: string;
  tier?: CleanCoreTier;
  type?: string;
  package?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface AnalysisJobFilters {
  projectId?: string;
  engineType?: EngineType;
  status?: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  page?: number;
  limit?: number;
}

export interface AuditEventFilters {
  action?: string;
  userId?: string;
  targetType?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface ExportFilters {
  projectId?: string;
  format?: 'JSON' | 'CSV' | 'PDF';
  status?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
}

/**
 * Universal Hierarchical Query Key Factory.
 * Invalidation examples:
 * - Invalidate ALL project queries: queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
 * - Invalidate only project lists: queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists() })
 * - Invalidate specific project: queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(id) })
 * - Invalidate findings for a specific project: queryClient.invalidateQueries({ queryKey: queryKeys.findings.byProject(id) })
 * - Invalidate active job status poll: queryClient.invalidateQueries({ queryKey: queryKeys.analysis.jobStatus(jobId) })
 */
export const queryKeys = {
  // ==========================================
  // PROJECTS DOMAIN
  // ==========================================
  projects: {
    all: ['projects'] as const,
    lists: () => [...queryKeys.projects.all, 'list'] as const,
    list: (filters?: ProjectListFilters) =>
      [...queryKeys.projects.lists(), { ...(filters ?? {}) }] as const,
    details: () => [...queryKeys.projects.all, 'detail'] as const,
    detail: (projectId: string) =>
      [...queryKeys.projects.details(), projectId] as const,
    stats: (projectId: string) =>
      [...queryKeys.projects.detail(projectId), 'stats'] as const,
    artifacts: (projectId: string) =>
      [...queryKeys.projects.detail(projectId), 'artifacts'] as const,
    artifact: (projectId: string, fileId: string) =>
      [...queryKeys.projects.artifacts(projectId), fileId] as const,
  },

  // ==========================================
  // FINDINGS DOMAIN (Audit Ledger & Evidence)
  // ==========================================
  findings: {
    all: ['findings'] as const,
    lists: () => [...queryKeys.findings.all, 'list'] as const,
    list: (filters?: FindingFilters) =>
      [...queryKeys.findings.lists(), { ...(filters ?? {}) }] as const,
    byProject: (projectId: string, filters?: Omit<FindingFilters, 'projectId'>) =>
      [...queryKeys.findings.all, 'project', projectId, { ...(filters ?? {}) }] as const,
    details: () => [...queryKeys.findings.all, 'detail'] as const,
    detail: (findingId: string) =>
      [...queryKeys.findings.details(), findingId] as const,
    evidence: (findingId: string) =>
      [...queryKeys.findings.detail(findingId), 'evidence'] as const,
    remediation: (findingId: string) =>
      [...queryKeys.findings.detail(findingId), 'remediation'] as const,
    summary: (projectId: string) =>
      [...queryKeys.findings.all, 'summary', projectId] as const,
  },

  // ==========================================
  // SAP OBJECTS DOMAIN (Clean Core Inventory & Lineage)
  // ==========================================
  objects: {
    all: ['objects'] as const,
    lists: () => [...queryKeys.objects.all, 'list'] as const,
    list: (filters?: ObjectFilters) =>
      [...queryKeys.objects.lists(), { ...(filters ?? {}) }] as const,
    byProject: (projectId: string, filters?: Omit<ObjectFilters, 'projectId'>) =>
      [...queryKeys.objects.all, 'project', projectId, { ...(filters ?? {}) }] as const,
    details: () => [...queryKeys.objects.all, 'detail'] as const,
    detail: (name: string, type?: string) =>
      [...queryKeys.objects.details(), { name, type: type ?? 'SAP_OBJECT' }] as const,
    dependencies: (name: string, type?: string) =>
      [...queryKeys.objects.detail(name, type), 'dependencies'] as const,
    tier: (name: string) =>
      [...queryKeys.objects.detail(name), 'tier'] as const,
  },

  // ==========================================
  // ANALYSIS DOMAIN (Engines, Jobs, Runs, Metrics)
  // ==========================================
  analysis: {
    all: ['analysis'] as const,
    engines: () => [...queryKeys.analysis.all, 'engines'] as const,
    engine: (engineType: EngineType | string) =>
      [...queryKeys.analysis.engines(), engineType] as const,
    engineStatus: () =>
      [...queryKeys.analysis.engines(), 'status'] as const,
    jobs: () => [...queryKeys.analysis.all, 'jobs'] as const,
    jobList: (filters?: AnalysisJobFilters) =>
      [...queryKeys.analysis.jobs(), 'list', { ...(filters ?? {}) }] as const,
    job: (jobId: string) =>
      [...queryKeys.analysis.jobs(), jobId] as const,
    jobStatus: (jobId: string) =>
      [...queryKeys.analysis.job(jobId), 'status'] as const,
    jobProgress: (jobId: string) =>
      [...queryKeys.analysis.job(jobId), 'progress'] as const,
    runs: (projectId: string) =>
      [...queryKeys.analysis.all, 'runs', projectId] as const,
    run: (projectId: string, runId: string) =>
      [...queryKeys.analysis.runs(projectId), runId] as const,
    metrics: (projectId?: string) =>
      [...queryKeys.analysis.all, 'metrics', projectId ?? 'global'] as const,
  },

  // ==========================================
  // TENANCY & WORKSPACES
  // ==========================================
  tenants: {
    all: ['tenants'] as const,
    current: () => [...queryKeys.tenants.all, 'current'] as const,
    workspaces: () => [...queryKeys.tenants.all, 'workspaces'] as const,
    workspace: (workspaceId: string) =>
      [...queryKeys.tenants.workspaces(), workspaceId] as const,
  },

  // ==========================================
  // TRANSPORTS DOMAIN
  // ==========================================
  transports: {
    all: ['transports'] as const,
    byProject: (projectId: string) =>
      [...queryKeys.transports.all, 'project', projectId] as const,
    detail: (transportId: string) =>
      [...queryKeys.transports.all, 'detail', transportId] as const,
    dependencyGraph: (projectId: string) =>
      [...queryKeys.transports.byProject(projectId), 'graph'] as const,
  },

  // ==========================================
  // AUDIT DOMAIN
  // ==========================================
  audit: {
    all: ['audit'] as const,
    events: (filters?: AuditEventFilters) =>
      [...queryKeys.audit.all, 'events', { ...(filters ?? {}) }] as const,
  },

  // ==========================================
  // EXPORTS DOMAIN
  // ==========================================
  exports: {
    all: ['exports'] as const,
    byProject: (projectId: string, filters?: ExportFilters) =>
      [...queryKeys.exports.all, 'project', projectId, { ...(filters ?? {}) }] as const,
    detail: (exportId: string) =>
      [...queryKeys.exports.all, 'detail', exportId] as const,
    status: (exportId: string) =>
      [...queryKeys.exports.detail(exportId), 'status'] as const,
  },
} as const;

export default queryKeys;
