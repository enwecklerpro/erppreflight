/**
 * ERP Preflight — Analyze experience API client: Problem Router, analysis
 * progress (SSE + poll fallback), Full Project Preflight, project context and
 * the reports hub. Every response is validated with the shared Zod contracts
 * (@erppreflight/schemas) at the boundary (Axiom 1.2).
 */
import { z } from 'zod';
import {
  AnalysisProgressEventSchema,
  AnalysisProgressSchema,
  ProblemRouteResponseSchema,
  ProjectContextUpdateSchema,
  ReportListResponseSchema,
  type AnalysisProgress,
  type AnalysisProgressEvent,
  type ProblemRouteRequest,
  type ProblemRouteResponse,
  type ProjectContextUpdate,
  type ReportListResponse,
} from '@erppreflight/schemas';
import { customInstance, getStoredTenantId, resolveApiUrl, ApiError } from './custom-instance';
import { parse } from './commercial';

export const orchestrationKeys = {
  progress: (analysisId: string) => ['analysis', analysisId, 'progress'] as const,
  orchestration: (analysisId: string) => ['analysis', analysisId, 'orchestration'] as const,
  latestFullPreflight: (projectId: string) => ['project', projectId, 'full-preflight', 'latest'] as const,
  engineCatalog: ['router', 'engines'] as const,
  reports: (filters: Record<string, unknown>) => ['reports-hub', filters] as const,
  analysesByProject: (projectId: string) => ['analyses', projectId] as const,
};

// -----------------------------------------------------------------------------
// Problem Router
// -----------------------------------------------------------------------------

export async function routeProblem(request: ProblemRouteRequest): Promise<ProblemRouteResponse> {
  return parse(
    ProblemRouteResponseSchema,
    '/router/route',
    await customInstance('/router/route', { method: 'POST', body: JSON.stringify(request) })
  );
}

export const EngineCatalogSchema = z.object({
  available: z.boolean(),
  engines: z.array(
    z.object({
      engine: z.string(),
      engineName: z.string(),
      domain: z.string(),
      acceptedFormats: z.array(z.string()),
      inputSummary: z.string().nullable(),
      requiredInputs: z.array(z.string()),
    })
  ),
});
export type EngineCatalog = z.infer<typeof EngineCatalogSchema>;

export async function fetchEngineCatalog(): Promise<EngineCatalog> {
  return parse(EngineCatalogSchema, '/router/engines', await customInstance('/router/engines'));
}

// -----------------------------------------------------------------------------
// Analyses: launch + progress
// -----------------------------------------------------------------------------

export const LaunchResponseSchema = z.object({
  analysisId: z.string().uuid(),
  status: z.string(),
  engineTypes: z.array(z.string()),
  targetRelease: z.string().optional(),
});
export type LaunchResponse = z.infer<typeof LaunchResponseSchema>;

export interface LaunchAnalysisRequest {
  projectId: string;
  engineTypes: string[];
  fileIds: string[];
  targetRelease?: string;
  assignmentMode?: 'CROSS' | 'AUTO';
  problemStatement?: string;
  routingId?: string;
}

export async function launchAnalysis(request: LaunchAnalysisRequest): Promise<LaunchResponse> {
  return parse(
    LaunchResponseSchema,
    '/analyses',
    await customInstance('/analyses', { method: 'POST', body: JSON.stringify(request) })
  );
}

export async function fetchAnalysisProgress(analysisId: string, signal?: AbortSignal): Promise<AnalysisProgress> {
  return parse(
    AnalysisProgressSchema,
    '/analyses/:id/progress',
    await customInstance(`/analyses/${encodeURIComponent(analysisId)}/progress`, { signal })
  );
}

export interface SseMessage {
  event: string;
  id: string | null;
  data: string;
}

/** Parses one text/event-stream chunk buffer into complete messages (pure; exported for tests). */
export function parseSseBuffer(buffer: string): { messages: SseMessage[]; rest: string } {
  const messages: SseMessage[] = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    let event = 'message';
    let id: string | null = null;
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      const idx = line.indexOf(':');
      const field = idx === -1 ? line : line.slice(0, idx);
      const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'id') id = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length > 0) messages.push({ event, id, data: data.join('\n') });
  }
  return { messages, rest };
}

export interface ProgressStreamHandlers {
  onEvent?: (event: AnalysisProgressEvent) => void;
  onSnapshot?: (snapshot: AnalysisProgress) => void;
  onEnd?: (status: string) => void;
}

/**
 * Streams GET /analyses/:id/events with fetch (HttpOnly session cookie via
 * credentials: 'include' + tenant header, which EventSource cannot send). Resolves when
 * the server ends the stream; rejects on HTTP / network errors so the caller can
 * fall back to polling.
 */
export async function streamAnalysisProgress(
  analysisId: string,
  handlers: ProgressStreamHandlers,
  signal: AbortSignal,
  lastEventId?: string | null
): Promise<string | null> {
  const headers = new Headers({ Accept: 'text/event-stream' });
  const tenant = getStoredTenantId();
  if (tenant) headers.set('X-Tenant-Id', tenant);
  if (lastEventId) headers.set('Last-Event-ID', lastEventId);
  const res = await fetch(resolveApiUrl(`/analyses/${encodeURIComponent(analysisId)}/events`), {
    headers,
    signal,
    credentials: 'include',
  });
  if (!res.ok || !res.body) {
    throw new ApiError(res.status, `Progress stream unavailable (HTTP ${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastId: string | null = lastEventId ?? null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { messages, rest } = parseSseBuffer(buffer);
    buffer = rest;
    for (const m of messages) {
      if (m.id) lastId = m.id;
      let payload: unknown;
      try {
        payload = JSON.parse(m.data);
      } catch {
        continue;
      }
      if (m.event === 'stage') {
        const ev = AnalysisProgressEventSchema.safeParse(payload);
        if (ev.success) handlers.onEvent?.(ev.data);
      } else if (m.event === 'snapshot') {
        const snap = AnalysisProgressSchema.safeParse(payload);
        if (snap.success) handlers.onSnapshot?.(snap.data);
      } else if (m.event === 'end') {
        handlers.onEnd?.(String((payload as { status?: string })?.status ?? ''));
      }
    }
  }
  return lastId;
}

// -----------------------------------------------------------------------------
// Full Project Preflight
// -----------------------------------------------------------------------------

const PlanSchema = z.object({
  version: z.string(),
  engines: z.array(z.string()),
  stages: z.array(z.array(z.string())),
  assignments: z.array(
    z.object({
      engine: z.string(),
      fileId: z.string(),
      companions: z.array(z.object({ fileId: z.string(), configKey: z.string() })),
      reason: z.string(),
    })
  ),
  unassigned: z.array(z.object({ fileId: z.string(), fileName: z.string(), reason: z.string() })),
  missingInputs: z.array(z.object({ engine: z.string(), engineName: z.string(), reason: z.string() })),
});
export type PreflightPlanView = z.infer<typeof PlanSchema>;

const SummarySchema = z.object({
  version: z.string(),
  totals: z.object({
    findings: z.number(),
    uniqueFindings: z.number(),
    duplicates: z.number(),
    inputValidation: z.number(),
    artifactsAnalyzed: z.number(),
    engineRuns: z.number(),
    checksPassed: z.number(),
    checksWithFindings: z.number(),
    checksFailed: z.number(),
    rulesEvaluated: z.number(),
    objectsWithFindings: z.number(),
    correlatedGroups: z.number(),
  }),
  bySeverity: z.record(z.string(), z.number()),
  categories: z.record(z.string(), z.number()),
  engines: z.array(
    z.object({
      engine: z.string(),
      engineName: z.string(),
      outcome: z.string(),
      runs: z.number(),
      findings: z.number(),
      bySeverity: z.record(z.string(), z.number()),
    })
  ),
  duplicates: z.array(z.object({ fingerprint: z.string(), keptFindingId: z.string(), duplicateFindingIds: z.array(z.string()) })),
  groups: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      rootCauseFindingId: z.string(),
      findingIds: z.array(z.string()),
      engines: z.array(z.string()),
      sharedObjects: z.array(z.string()),
      explanation: z.string(),
    })
  ),
});
export type PreflightSummaryView = z.infer<typeof SummarySchema>;

export const OrchestrationSchema = z.object({
  analysis: z
    .object({
      id: z.string(),
      projectId: z.string(),
      status: z.string(),
      kind: z.string(),
      engineTypes: z.array(z.string()),
      targetRelease: z.string().nullable().optional(),
      findingsCount: z.number(),
      createdAt: z.string(),
      completedAt: z.string().nullable(),
      progressPercent: z.number(),
    })
    .passthrough(),
  plan: PlanSchema.nullable(),
  summary: SummarySchema.nullable(),
  calls: z.array(z.record(z.string(), z.unknown())),
});
export type OrchestrationView = z.infer<typeof OrchestrationSchema>;

export const FullPreflightStartSchema = LaunchResponseSchema.extend({ kind: z.literal('FULL_PREFLIGHT'), plan: PlanSchema });

export async function startFullPreflight(projectId: string, body: { targetRelease?: string } = {}) {
  return parse(
    FullPreflightStartSchema,
    '/projects/:id/full-preflight',
    await customInstance(`/projects/${encodeURIComponent(projectId)}/full-preflight`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

/** Latest Full Project Preflight; resolves null when none has been run (404 NO_FULL_PREFLIGHT). */
export async function fetchLatestFullPreflight(projectId: string): Promise<OrchestrationView | null> {
  try {
    return parse(
      OrchestrationSchema,
      '/projects/:id/full-preflight/latest',
      await customInstance(`/projects/${encodeURIComponent(projectId)}/full-preflight/latest`)
    );
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) return null;
    throw err;
  }
}

export async function fetchAnalysisOrchestration(analysisId: string): Promise<OrchestrationView> {
  return parse(OrchestrationSchema, '/analyses/:id/orchestration', await customInstance(`/analyses/${encodeURIComponent(analysisId)}/orchestration`));
}

export const AnalysisFindingSchema = z
  .object({
    id: z.string(),
    engineType: z.string(),
    ruleId: z.string(),
    severity: z.string(),
    title: z.string(),
    confidence: z.string().nullable().optional(),
    affectedObjects: z.array(z.unknown()).default([]),
  })
  .passthrough();
export type AnalysisFindingView = z.infer<typeof AnalysisFindingSchema>;

export async function fetchAnalysisFindings(analysisId: string): Promise<AnalysisFindingView[]> {
  return parse(z.array(AnalysisFindingSchema), '/analyses/:id/findings', await customInstance(`/analyses/${encodeURIComponent(analysisId)}/findings`));
}

// -----------------------------------------------------------------------------
// Project context
// -----------------------------------------------------------------------------

export async function updateProjectContext(projectId: string, context: ProjectContextUpdate) {
  const body = ProjectContextUpdateSchema.parse(context);
  return customInstance<Record<string, unknown>>(`/projects/${encodeURIComponent(projectId)}/context`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

// -----------------------------------------------------------------------------
// Uploads (Analyze page)
// -----------------------------------------------------------------------------

export const UploadResponseSchema = z
  .object({ fileId: z.string().uuid(), quarantineStatus: z.string().optional(), fileName: z.string().optional() })
  .passthrough();

export async function uploadProjectFile(projectId: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return parse(
    UploadResponseSchema,
    '/projects/:id/files',
    await customInstance(`/projects/${encodeURIComponent(projectId)}/files`, { method: 'POST', body: form })
  );
}

// -----------------------------------------------------------------------------
// Reports hub
// -----------------------------------------------------------------------------

export interface ReportFilters {
  projectId?: string;
  reportType?: string;
  format?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export async function fetchReportsHub(filters: ReportFilters): Promise<ReportListResponse> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const q = qs.toString();
  return parse(ReportListResponseSchema, '/reports', await customInstance(`/reports${q ? `?${q}` : ''}`));
}
