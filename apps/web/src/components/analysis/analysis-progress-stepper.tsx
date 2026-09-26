'use client';

import * as React from 'react';
import { Ban, CheckCircle2, Circle, CircleSlash, Loader2, Radio, RefreshCw, XCircle } from 'lucide-react';
import { ANALYSIS_STAGES, type AnalysisProgress, type AnalysisStage, type StageState } from '@erppreflight/schemas';
import { useAnalysisProgress } from '@/hooks/useAnalysisProgress';
import { useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/translate';

const STATE_ICON: Record<StageState, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  PENDING: Circle,
  RUNNING: Loader2,
  COMPLETED: CheckCircle2,
  FAILED: XCircle,
  SKIPPED: CircleSlash,
  CANCELLED: Ban,
};

const STATE_CLASS: Record<StageState, string> = {
  PENDING: 'border-border text-muted-foreground',
  RUNNING: 'border-primary text-primary',
  COMPLETED: 'border-emerald-500/60 text-emerald-700 dark:text-emerald-300',
  FAILED: 'border-destructive text-destructive',
  SKIPPED: 'border-border text-muted-foreground',
  CANCELLED: 'border-amber-500/60 text-amber-800 dark:text-amber-300',
};

function stageDetail(t: ReturnType<typeof useT>, stage: AnalysisStage, detail: Record<string, unknown> | undefined): string | null {
  if (!detail) return null;
  if (stage === 'RUNNING_RULES' && typeof detail.total === 'number') {
    return t('progress.rulesDetail', { done: Number(detail.done ?? 0), total: detail.total });
  }
  if (stage === 'GENERATING_TESTS' && typeof detail.generated === 'number') {
    return t('progress.testsDetail', { count: detail.generated });
  }
  if (stage === 'MATCHING_EVIDENCE' && typeof detail.withEvidence === 'number') {
    return t('progress.evidenceDetail', { count: detail.withEvidence });
  }
  // Server reasons carry a code for known situations (translated); the English reason is the fallback.
  if (typeof detail.code === 'string' && REASON_CODES.has(detail.code)) {
    return t(`progress.reasons.${detail.code}` as MessageKey, {
      count: Number(detail.discardedFindings ?? 0),
      done: Number(detail.done ?? 0),
      total: Number(detail.total ?? 0),
    });
  }
  if (typeof detail.reason === 'string') return detail.reason;
  return null;
}

const REASON_CODES = new Set(['CANCELLED', 'LAB_CANCELLED', 'NO_ELIGIBLE_FINDINGS', 'LAB_FIXTURES_PER_TEST', 'LAB_NO_FINDINGS', 'LAB_NOT_APPLICABLE']);

/** Pure presentational stepper (also used by tests). */
export function ProgressStepperView({ progress, transport }: { progress: AnalysisProgress; transport?: 'sse' | 'poll' }) {
  const t = useT();
  return (
    <div className="space-y-3" data-testid="analysis-progress" data-status={progress.status}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-foreground">{t('progress.title')}</span>
        <span className="text-muted-foreground inline-flex items-center gap-2">
          <span>{t('progress.status', { status: progress.status })}</span>
          {!progress.terminal && transport && (
            <span className="inline-flex items-center gap-1">
              {transport === 'sse' ? <Radio className="size-3" aria-hidden="true" /> : <RefreshCw className="size-3" aria-hidden="true" />}
              {transport === 'sse' ? t('progress.live') : t('progress.polling')}
            </span>
          )}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        aria-label={t('progress.percent', { percent: progress.percent })}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">{t('progress.percent', { percent: progress.percent })}</p>
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('progress.title')}>
        {ANALYSIS_STAGES.map((stage, idx) => {
          const snap = progress.stages[stage] ?? { state: 'PENDING' as StageState };
          const state = snap.state as StageState;
          const Icon = STATE_ICON[state];
          const detail = stageDetail(t, stage, snap.detail as Record<string, unknown> | undefined);
          return (
            <li
              key={stage}
              data-stage={stage}
              data-state={state}
              aria-current={state === 'RUNNING' ? 'step' : undefined}
              className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs ${STATE_CLASS[state]}`}
            >
              <Icon
                className={`mt-0.5 size-4 shrink-0 ${state === 'RUNNING' ? 'animate-spin motion-reduce:animate-none' : ''}`}
                aria-hidden={true}
              />
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  {idx + 1}. {t(`progress.stages.${stage}` as MessageKey)}
                </p>
                <p>{t(`progress.states.${state}` as MessageKey)}</p>
                {detail && <p className="text-muted-foreground break-words">{detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Live stage stepper for one analysis (SSE with poll fallback). */
export function AnalysisProgressStepper({ analysisId, onTerminal }: { analysisId: string; onTerminal?: (status: string) => void }) {
  const t = useT();
  const { data, isLoading, isError, refetch, transport } = useAnalysisProgress(analysisId);
  const notified = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (data?.terminal && notified.current !== analysisId) {
      notified.current = analysisId;
      onTerminal?.(data.status);
    }
  }, [data?.terminal, data?.status, analysisId, onTerminal]);

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-live="polite">
        <div className="h-4 w-40 rounded bg-muted animate-pulse motion-reduce:animate-none" />
        <div className="h-2 w-full rounded bg-muted animate-pulse motion-reduce:animate-none" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ANALYSIS_STAGES.map((s) => (
            <div key={s} className="h-14 rounded-lg bg-muted animate-pulse motion-reduce:animate-none" />
          ))}
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 p-3 text-xs">
        <XCircle className="size-4 text-destructive" aria-hidden="true" />
        <span className="flex-1">{t('progress.loadError')}</span>
        <button type="button" onClick={() => refetch()} className="font-semibold underline">
          {t('common.retry')}
        </button>
      </div>
    );
  }
  return (
    <div aria-live="polite">
      <ProgressStepperView progress={data} transport={transport} />
    </div>
  );
}
