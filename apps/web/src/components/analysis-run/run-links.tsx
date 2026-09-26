'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight, ExternalLink } from 'lucide-react';
import { useT } from '@/i18n/client';
import { analysisRunHref } from '@/lib/api/analysis-lifecycle';
import { RerunBadge, RunKindBadge } from './run-status';

/**
 * Run-history building blocks embedded by existing pages (project workspace run history,
 * /analyze, reports hub), so those shared files only reference them (P8 deep links).
 */

/** Kind badge (Test Lab / Full Project Preflight) + re-run marker + "Details" link for one run-history row. */
export function RunHistoryRowExtras({
  projectId,
  run,
}: {
  projectId: string;
  run: { id: string; kind?: string | null; rerunOfAnalysisId?: string | null };
}) {
  const t = useT();
  const kind = run.kind ?? 'STANDARD';
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {kind !== 'STANDARD' && <RunKindBadge kind={kind} testId={`run-kind-${run.id}`} />}
      {run.rerunOfAnalysisId && <RerunBadge />}
      <Link
        href={analysisRunHref(projectId, run.id)}
        data-testid={`run-detail-link-${run.id}`}
        aria-label={t('app.analysisRun.history.detailsLabel', { id: run.id.slice(0, 8) })}
        className="inline-flex items-center gap-1 rounded border border-primary/40 bg-card px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <ExternalLink className="size-3 text-primary" aria-hidden="true" />
        {t('app.analysisRun.history.details')}
      </Link>
    </span>
  );
}

/** Compact link "Run 1a2b3c4d" to the analysis detail page (reports hub, notifications, lists). */
export function AnalysisRunLink({ projectId, analysisId, className = '' }: { projectId: string; analysisId: string; className?: string }) {
  const t = useT();
  return (
    <Link
      href={analysisRunHref(projectId, analysisId)}
      data-testid={`analysis-run-link-${analysisId}`}
      className={`inline-flex items-center gap-0.5 font-mono text-[10px] font-semibold text-primary underline ${className}`}
    >
      {t('app.analysisRun.actions.viewRun', { id: analysisId.slice(0, 8) })}
      <ArrowUpRight className="size-3" aria-hidden="true" />
    </Link>
  );
}

/** "From run 1a2b3c4d" on a Test Lab regression case promoted from a generated test. */
export function GeneratedFromRun({ projectId, analysisId }: { projectId: string; analysisId: string }) {
  const t = useT();
  return (
    <Link
      href={analysisRunHref(projectId, analysisId)}
      data-testid={`regression-origin-${analysisId}`}
      className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary underline"
    >
      {t('app.analysisRun.generated.fromRun', { id: analysisId.slice(0, 8) })}
      <ArrowUpRight className="size-3" aria-hidden="true" />
    </Link>
  );
}

/** "Open run details" link shown after a run was launched (project launcher, /analyze). */
export function LaunchedRunLink({ projectId, analysisId }: { projectId: string; analysisId: string }) {
  const t = useT();
  return (
    <Link
      href={analysisRunHref(projectId, analysisId)}
      data-testid="launched-run-link"
      className="inline-flex shrink-0 items-center gap-1 font-semibold text-primary underline"
    >
      {t('app.analysisRun.history.openLaunched')}
      <ArrowUpRight className="size-3" aria-hidden="true" />
    </Link>
  );
}
