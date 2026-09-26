'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, ChevronDown, ChevronRight, FlaskConical, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import type { GeneratedTest } from '@erppreflight/schemas';
import { SeverityBadge } from '@/components/findings/severity-badge';
import { ErrorState } from '@/components/commercial/states';
import { useErrorText, useFmt, useT } from '@/i18n/client';
import { analysisRunHref, analysisRunKeys, fetchGeneratedTests, promoteGeneratedTest } from '@/lib/api/analysis-lifecycle';
import { findingLifecycleKeys } from '@/lib/api/findings-lifecycle';
import { LabVerdict } from './run-status';

/**
 * Generated regression tests (analysis GENERATING_TESTS stage) with promotion into the Test
 * Lab. Shown on the analysis detail page (tests of one run) and in the Test Lab (all tests of
 * a project) — the same rows, linked both ways (section C §18, KNOWN_LIMITATIONS P6).
 */
export function GeneratedTestsPanel({
  projectId,
  analysisId,
  canPromote = true,
  variant = 'run',
}: {
  projectId: string;
  analysisId?: string;
  canPromote?: boolean;
  variant?: 'run' | 'project';
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const key = analysisId ? analysisRunKeys.generatedTests(analysisId) : analysisRunKeys.projectGeneratedTests(projectId);
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchGeneratedTests(analysisId ? { analysisId } : { projectId }),
    enabled: Boolean(analysisId || projectId),
    retry: 2,
  });
  const items = query.data ?? [];
  const promoted = items.filter((i) => i.promotion).length;

  const onPromoted = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: analysisRunKeys.projectGeneratedTests(projectId) });
    void queryClient.invalidateQueries({ queryKey: findingLifecycleKeys.regressionTests(projectId) });
    if (analysisId) void queryClient.invalidateQueries({ queryKey: analysisRunKeys.detail(analysisId) });
  };

  return (
    <section
      data-testid={variant === 'run' ? 'analysis-generated-tests' : 'project-generated-tests'}
      aria-labelledby={`generated-tests-${variant}`}
      className="space-y-3"
    >
      <div>
        <h2 id={`generated-tests-${variant}`} className="flex items-center gap-1.5 text-sm font-bold text-foreground">
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
          {variant === 'run' ? t('app.analysisRun.sections.generatedTests') : t('app.analysisRun.generated.projectHeading')}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {variant === 'run' ? t('app.analysisRun.generated.intro') : t('app.analysisRun.generated.projectIntro')}
        </p>
      </div>
      {query.isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label={t('app.analysisRun.generated.loading')}>
          {[0, 1].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-muted animate-pulse motion-reduce:animate-none" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState title={t('app.analysisRun.generated.loadError')} error={query.error} onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">{t('app.analysisRun.generated.none')}</p>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground" data-testid="generated-tests-counts">
            {t('app.analysisRun.generated.counts', { total: items.length, promoted })}
          </p>
          <ul className="space-y-2">
            {items.map((item) => (
              <GeneratedTestItem key={item.id} item={item} projectId={projectId} canPromote={canPromote} showRun={variant === 'project'} onPromoted={onPromoted} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function GeneratedTestItem({
  item,
  projectId,
  canPromote,
  showRun,
  onPromoted,
}: {
  item: GeneratedTest;
  projectId: string;
  canPromote: boolean;
  showRun: boolean;
  onPromoted: () => void;
}) {
  const t = useT();
  const fmt = useFmt();
  const errText = useErrorText();
  const [open, setOpen] = React.useState(false);
  const promote = useMutation({ mutationFn: () => promoteGeneratedTest(item.id), onSuccess: onPromoted });
  const stepsId = `generated-steps-${item.id}`;

  return (
    <li className="rounded-lg border border-border p-3 text-xs" data-testid="generated-test" data-promoted={item.promotion ? 'true' : 'false'}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
            {item.findingSeverity && <SeverityBadge severity={item.findingSeverity as never} size="sm" />}
            <span className="break-words" translate="no">{item.title}</span>
          </p>
          <p className="text-muted-foreground break-words">
            <span className="font-semibold">{t('app.analysisRun.generated.expected')}:</span> {item.expectedResult}
          </p>
          {showRun && item.analysisId && (
            <Link href={analysisRunHref(projectId, item.analysisId)} className="inline-flex items-center gap-1 font-semibold text-primary underline">
              {t('app.analysisRun.generated.fromRun', { id: item.analysisId.slice(0, 8) })}
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {item.promotion ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
              <ShieldCheck className="size-3" aria-hidden="true" />
              {t('app.analysisRun.generated.promoted')}
            </span>
          ) : canPromote && item.promotable ? (
            <button
              type="button"
              data-testid="generated-test-promote"
              onClick={() => promote.mutate()}
              disabled={promote.isPending}
              className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              {promote.isPending ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <FlaskConical className="size-3 text-primary" aria-hidden="true" />}
              {promote.isPending ? t('app.analysisRun.generated.promoting') : t('app.analysisRun.generated.promote')}
            </button>
          ) : !item.promotable ? (
            <span className="text-[11px] text-muted-foreground">{t('app.analysisRun.generated.notPromotable')}</span>
          ) : null}
          {item.promotion && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              {item.promotion.lastRunStatus ? (
                <>
                  <span>{t('app.analysisRun.generated.lastRun')}:</span>
                  <LabVerdict status={item.promotion.lastRunStatus} />
                  {item.promotion.lastRunAt ? <time dateTime={item.promotion.lastRunAt}>{fmt.dateTime(item.promotion.lastRunAt)}</time> : null}
                </>
              ) : (
                t('app.analysisRun.generated.neverRun')
              )}
            </span>
          )}
          {item.promotion && (
            <Link href={`/projects/${encodeURIComponent(projectId)}/lab`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary underline">
              {t('app.analysisRun.actions.openTestLab')}
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
      {promote.isError && (
        <p role="alert" className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-destructive">
          {t('app.analysisRun.generated.promoteError', { message: errText(promote.error) })}
        </p>
      )}
      {item.steps.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={stepsId}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary"
          >
            {open ? <ChevronDown className="size-3" aria-hidden="true" /> : <ChevronRight className="size-3" aria-hidden="true" />}
            {open ? t('app.analysisRun.generated.hideSteps') : t('app.analysisRun.generated.showSteps')}
          </button>
          {open && (
            <ol id={stepsId} className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground" aria-label={t('app.analysisRun.generated.steps')}>
              {item.steps.map((s) => (
                <li key={s.order} className="break-words">
                  {s.action}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}
