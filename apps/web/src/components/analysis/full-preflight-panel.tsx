'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, GitMerge, Layers, Loader2, PlayCircle, Rocket } from 'lucide-react';
import type { Severity } from '@erppreflight/schemas';
import { useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/translate';
import {
  fetchAnalysisFindings,
  fetchLatestFullPreflight,
  orchestrationKeys,
  startFullPreflight,
  type OrchestrationView,
} from '@/lib/api/analysis-orchestration';
import { ApiError } from '@/lib/api/custom-instance';
import { ErrorState, errorMessage } from '@/components/commercial/states';
import { SeverityBadge } from '@/components/findings/severity-badge';
import { AnalysisProgressStepper } from './analysis-progress-stepper';

const CATEGORY_ORDER = [
  'MIGRATION_BLOCKERS',
  'OUTPUT_PROBLEMS',
  'FORM_DATA_PATH',
  'UNSUPPORTED_APIS',
  'TRANSPORT_DEPENDENCIES',
  'EXTENSION_DEPENDENCIES',
  'INTEGRATION_COVERAGE',
  'OPERATIONAL_RISKS',
] as const;
const SEVERITY_ORDER: Severity[] = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MEDIUM', 'MINOR', 'LOW', 'INFO'];

/**
 * Full Project Preflight (Part 01 §1.6): "Run Full Preflight" + summary view with
 * drill-down project summary → engine → finding (→ finding detail in the findings
 * workspace), correlated root-cause groups and the executed plan.
 */
export function FullPreflightPanel({ projectId }: { projectId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [runningId, setRunningId] = React.useState<string | null>(null);
  const latestKey = orchestrationKeys.latestFullPreflight(projectId);

  const latest = useQuery({ queryKey: latestKey, queryFn: () => fetchLatestFullPreflight(projectId) });

  const start = useMutation({
    mutationFn: () => startFullPreflight(projectId),
    onSuccess: (res) => {
      setRunningId(res.analysisId);
      void queryClient.invalidateQueries({ queryKey: ['analyses', projectId] });
    },
  });

  const activeId =
    runningId ??
    (latest.data && !['COMPLETED', 'FAILED', 'PARTIAL'].includes(latest.data.analysis.status) ? latest.data.analysis.id : null);

  const startError =
    start.error instanceof ApiError && start.error.code === 'NO_ANALYSABLE_ARTIFACTS'
      ? t('fullPreflight.noArtifacts')
      : start.error
      ? t('fullPreflight.startFailed', { message: errorMessage(start.error) })
      : null;

  return (
    <section className="space-y-5" aria-labelledby="fpp-title" data-testid="full-preflight">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="fpp-title" className="flex items-center gap-2 text-base font-bold text-foreground">
            <Rocket className="size-5 text-primary" aria-hidden="true" /> {t('fullPreflight.title')}
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t('fullPreflight.description')}</p>
          {startError && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {startError}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => start.mutate()}
          disabled={start.isPending || Boolean(activeId)}
          data-testid="run-full-preflight"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {start.isPending || activeId ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <PlayCircle className="size-4" aria-hidden="true" />}
          {start.isPending ? t('fullPreflight.starting') : activeId ? t('fullPreflight.running') : t('fullPreflight.run')}
        </button>
      </div>

      {activeId && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <AnalysisProgressStepper
            analysisId={activeId}
            onTerminal={() => {
              setRunningId(null);
              void queryClient.invalidateQueries({ queryKey: latestKey });
              void queryClient.invalidateQueries({ queryKey: ['analyses', projectId] });
              void queryClient.invalidateQueries({ queryKey: ['findingsStats', projectId] });
            }}
          />
        </div>
      )}

      {latest.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-3" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-muted animate-pulse motion-reduce:animate-none" />
          ))}
        </div>
      ) : latest.isError ? (
        <ErrorState title={t('fullPreflight.loadError')} error={latest.error} onRetry={() => latest.refetch()} />
      ) : !latest.data ? (
        !activeId && (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground" role="status">
            {t('fullPreflight.empty')}
          </div>
        )
      ) : (
        <FullPreflightSummary view={latest.data} projectId={projectId} />
      )}
    </section>
  );
}

function Stat({ label, value, testId }: { label: string; value: React.ReactNode; testId?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4" data-testid={testId}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-foreground">{value}</p>
    </div>
  );
}

export function FullPreflightSummary({ view, projectId }: { view: OrchestrationView; projectId: string }) {
  const t = useT();
  const s = view.summary;
  const created = new Date(view.analysis.createdAt);
  if (!s) {
    return (
      <p className="text-xs text-muted-foreground" role="status">
        {t('fullPreflight.lastRun', { date: created.toLocaleString(), status: view.analysis.status })}
      </p>
    );
  }
  return (
    <div className="space-y-5" data-testid="full-preflight-summary">
      <p className="text-xs text-muted-foreground">
        {t('fullPreflight.lastRun', { date: created.toLocaleString(), status: view.analysis.status })}
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label={t('fullPreflight.artifactsAnalyzed')} value={s.totals.artifactsAnalyzed} testId="fpp-artifacts" />
        <Stat label={t('fullPreflight.objectsWithFindings')} value={s.totals.objectsWithFindings} />
        <Stat label={t('fullPreflight.uniqueFindings')} value={s.totals.uniqueFindings} testId="fpp-findings" />
        <Stat label={t('fullPreflight.checksPassed')} value={s.totals.checksPassed} />
        <Stat label={t('fullPreflight.checksFailed')} value={s.totals.checksFailed} />
        <Stat label={t('fullPreflight.rulesEvaluated')} value={s.totals.rulesEvaluated} />
      </div>
      <div className="flex flex-wrap gap-2" aria-label="severity">
        {SEVERITY_ORDER.filter((sev) => (s.bySeverity[sev] ?? 0) > 0).map((sev) => (
          <span key={sev} className="inline-flex items-center gap-1 text-xs">
            <SeverityBadge severity={sev} size="sm" /> <span className="font-semibold">{s.bySeverity[sev]}</span>
          </span>
        ))}
        {s.totals.duplicates > 0 && <span className="text-xs text-muted-foreground">{t('fullPreflight.duplicates', { count: s.totals.duplicates })}</span>}
      </div>

      <div>
        <h3 className="text-sm font-bold text-foreground">{t('fullPreflight.categoriesTitle')}</h3>
        <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {CATEGORY_ORDER.map((c) => (
            <li key={c} className="flex items-center justify-between rounded-lg border border-border p-3 text-xs" data-category={c}>
              <span className="text-foreground">{t(`fullPreflight.categories.${c}` as MessageKey)}</span>
              <span className="font-bold text-foreground">{s.categories[c] ?? 0}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
          <GitMerge className="size-4" aria-hidden="true" /> {t('fullPreflight.correlationTitle')}
        </h3>
        {s.groups.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">{t('fullPreflight.noCorrelation')}</p>
        ) : (
          <ul className="mt-2 space-y-2" data-testid="fpp-correlations">
            {s.groups.map((g) => (
              <li key={g.id} className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-xs" data-kind={g.kind}>
                <p className="font-semibold text-foreground">{g.kind.replace(/_/g, ' ')}</p>
                <p className="mt-0.5 text-muted-foreground">{g.explanation}</p>
                <p className="mt-0.5 text-muted-foreground">{t('fullPreflight.sharedObjects', { objects: g.sharedObjects.join(', ') })}</p>
                <p className="mt-0.5">
                  {t('fullPreflight.rootCause')}:{' '}
                  <Link className="font-mono text-primary underline" href={`/projects/${projectId}/findings?engineType=${g.engines[0]}`}>
                    {g.rootCauseFindingId.slice(0, 8)}
                  </Link>{' '}
                  · {g.engines.join(' → ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
          <Layers className="size-4" aria-hidden="true" /> {t('fullPreflight.enginesTitle')}
        </h3>
        <ul className="mt-2 space-y-2" data-testid="fpp-engines">
          {s.engines.map((e) => (
            <EngineRow key={e.engine} analysisId={view.analysis.id} projectId={projectId} engine={e} />
          ))}
        </ul>
      </div>

      {view.plan && (
        <details className="rounded-lg border border-border p-3 text-xs">
          <summary className="cursor-pointer font-semibold text-foreground">{t('fullPreflight.planTitle')}</summary>
          <ol className="mt-2 space-y-1">
            {view.plan.stages.map((stage, i) => (
              <li key={i}>
                <span className="font-semibold">{t('fullPreflight.stage', { n: i + 1 })}:</span> {stage.join(', ')}
              </li>
            ))}
          </ol>
          {view.plan.unassigned.length > 0 && (
            <>
              <p className="mt-2 font-semibold text-foreground">{t('fullPreflight.unassignedTitle')}</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {view.plan.unassigned.map((u) => (
                  <li key={u.fileId}>
                    {u.fileName}: {u.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
          {view.plan.missingInputs.length > 0 && (
            <>
              <p className="mt-2 font-semibold text-foreground">{t('fullPreflight.missingTitle')}</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {view.plan.missingInputs.map((m) => (
                  <li key={m.engine}>
                    {m.engineName}: {m.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
      )}
    </div>
  );
}

function EngineRow({
  analysisId,
  projectId,
  engine,
}: {
  analysisId: string;
  projectId: string;
  engine: NonNullable<OrchestrationView['summary']>['engines'][number];
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const findings = useQuery({
    queryKey: ['analysis', analysisId, 'findings'],
    queryFn: () => fetchAnalysisFindings(analysisId),
    enabled: open,
  });
  const mine = (findings.data ?? []).filter((f) => f.engineType === engine.engine);
  return (
    <li className="rounded-lg border border-border text-xs" data-engine={engine.engine}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 p-3 text-left hover:bg-muted/50"
      >
        {open ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
        <span className="font-semibold text-foreground">{engine.engineName}</span>
        <span className="text-muted-foreground">{t('fullPreflight.engineOutcome', { outcome: engine.outcome })}</span>
        <span className="ml-auto font-semibold">{t('fullPreflight.engineFindings', { count: engine.findings })}</span>
        <span className="sr-only">{open ? t('fullPreflight.hideFindings') : t('fullPreflight.showFindings')}</span>
      </button>
      {open && (
        <div className="border-t border-border p-3">
          {findings.isLoading ? (
            <p className="text-muted-foreground" role="status">{t('fullPreflight.findingsLoading')}</p>
          ) : findings.isError ? (
            <ErrorState title={t('fullPreflight.loadError')} error={findings.error} onRetry={() => findings.refetch()} />
          ) : mine.length === 0 ? (
            <p className="text-muted-foreground">{t('fullPreflight.noEngineFindings')}</p>
          ) : (
            <ul className="space-y-1.5">
              {mine.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2" data-testid="fpp-finding">
                  <SeverityBadge severity={f.severity as Severity} size="sm" />
                  <span className="font-mono text-[11px]">{f.ruleId}</span>
                  <span className="text-foreground">{f.title}</span>
                  <Link className="ml-auto text-primary underline" href={`/projects/${projectId}/findings?engineType=${f.engineType}&search=${encodeURIComponent(f.ruleId)}`}>
                    {t('fullPreflight.openFinding')}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
