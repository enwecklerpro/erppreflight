/**
 * Analysis run lifecycle API client (section C §15/§16/§18): run detail, cancel, rerun,
 * findings of one run, generated tests and their promotion into the Test Lab. Every response
 * is validated with the shared Zod contracts at the boundary (Axiom 1.2).
 */
import { z } from 'zod';
import {
  AnalysisDetailSchema,
  CancelAnalysisRequestSchema,
  CancelAnalysisResponseSchema,
  FindingSchema,
  GeneratedTestListSchema,
  PromoteGeneratedTestResponseSchema,
  RerunAnalysisResponseSchema,
  type AnalysisDetail,
  type CancelAnalysisResponse,
  type Finding,
  type GeneratedTest,
  type RerunAnalysisResponse,
} from '@erppreflight/schemas';
import { customInstance } from './custom-instance';
import { parse } from './commercial';

export const analysisRunKeys = {
  all: ['analysis-run'] as const,
  detail: (analysisId: string) => ['analysis-run', analysisId, 'detail'] as const,
  findings: (analysisId: string) => ['analysis-run', analysisId, 'findings'] as const,
  generatedTests: (analysisId: string) => ['analysis-run', analysisId, 'generated-tests'] as const,
  projectGeneratedTests: (projectId: string) => ['generated-tests', 'project', projectId] as const,
};

const enc = encodeURIComponent;

export async function fetchAnalysisDetail(analysisId: string, signal?: AbortSignal): Promise<AnalysisDetail> {
  return parse(AnalysisDetailSchema, '/analyses/:id/detail', await customInstance(`/analyses/${enc(analysisId)}/detail`, { signal }));
}

export async function cancelAnalysisRun(analysisId: string, reason?: string): Promise<CancelAnalysisResponse> {
  const body = CancelAnalysisRequestSchema.parse(reason && reason.trim() ? { reason: reason.trim() } : {});
  return parse(
    CancelAnalysisResponseSchema,
    '/analyses/:id/cancel',
    await customInstance(`/analyses/${enc(analysisId)}/cancel`, { method: 'POST', body: JSON.stringify(body) })
  );
}

export async function rerunAnalysisRun(analysisId: string): Promise<RerunAnalysisResponse> {
  return parse(
    RerunAnalysisResponseSchema,
    '/analyses/:id/rerun',
    await customInstance(`/analyses/${enc(analysisId)}/rerun`, { method: 'POST', body: JSON.stringify({}) })
  );
}

/** Findings of one run, normalised to the shared Finding contract used by the findings table. */
export async function fetchRunFindings(analysisId: string, signal?: AbortSignal): Promise<Finding[]> {
  const raw = await customInstance<unknown>(`/analyses/${enc(analysisId)}/findings`, { signal });
  const list = z.array(z.record(z.unknown())).parse(raw);
  return list.map((item) => FindingSchema.parse({ ...item, remediation: typeof item.remediation === 'string' ? item.remediation : '' }));
}

export async function fetchGeneratedTests(filter: { analysisId?: string; projectId?: string }): Promise<GeneratedTest[]> {
  const qs = new URLSearchParams();
  if (filter.analysisId) qs.set('analysisId', filter.analysisId);
  if (filter.projectId) qs.set('projectId', filter.projectId);
  const res = parse(GeneratedTestListSchema, '/lab/generated-tests', await customInstance(`/lab/generated-tests?${qs.toString()}`));
  return res.items;
}

export async function promoteGeneratedTest(generatedTestId: string) {
  return parse(
    PromoteGeneratedTestResponseSchema,
    '/lab/generated-tests/:id/promote',
    await customInstance(`/lab/generated-tests/${enc(generatedTestId)}/promote`, { method: 'POST', body: JSON.stringify({}) })
  );
}

/** Link to the analysis detail page (P8). */
export function analysisRunHref(projectId: string, analysisId: string): string {
  return `/projects/${enc(projectId)}/analyses/${enc(analysisId)}`;
}
