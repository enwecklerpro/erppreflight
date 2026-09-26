'use client';

import * as React from 'react';
import { Ban, CheckCircle2, CircleAlert, Clock, FlaskConical, Layers, Loader2, RotateCcw, XCircle } from 'lucide-react';
import { useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/translate';

type IconType = React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

const STATUS_STYLE: Record<string, { icon: IconType; cls: string; spin?: boolean }> = {
  QUEUED: { icon: Clock, cls: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200' },
  RUNNING: { icon: Loader2, cls: 'border-primary/40 bg-primary/10 text-foreground', spin: true },
  CANCELLING: { icon: Loader2, cls: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200', spin: true },
  COMPLETED: { icon: CheckCircle2, cls: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200' },
  PARTIAL: { icon: CircleAlert, cls: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200' },
  FAILED: { icon: XCircle, cls: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200' },
  CANCELLED: { icon: Ban, cls: 'border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200' },
};

/** Run status with icon + text (never color alone, Axiom 1.5). */
export function RunStatusBadge({
  status,
  cancelRequested = false,
  size = 'default',
  testId,
}: {
  status: string;
  cancelRequested?: boolean;
  size?: 'sm' | 'default';
  testId?: string;
}) {
  const t = useT();
  const key = cancelRequested && (status === 'RUNNING' || status === 'QUEUED') ? 'CANCELLING' : status;
  const style = STATUS_STYLE[key] ?? STATUS_STYLE.QUEUED;
  const Icon = style.icon;
  const label = STATUS_STYLE[key] ? t(`app.analysisRun.status.${key}` as MessageKey) : status;
  return (
    <span
      data-testid={testId}
      data-status={status}
      title={t('app.analysisRun.statusLabel', { status: label })}
      className={`inline-flex items-center gap-1 rounded-full border font-semibold ${size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'} ${style.cls}`}
    >
      <Icon className={`${size === 'sm' ? 'size-3' : 'size-3.5'} shrink-0 ${style.spin ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden={true} />
      {label}
    </span>
  );
}

const KIND_ICON: Record<string, IconType> = {
  STANDARD: Layers,
  FULL_PREFLIGHT: Layers,
  LAB_REGRESSION: FlaskConical,
  LAB_SCENARIO: FlaskConical,
};

export function RunKindBadge({ kind, testId }: { kind: string; testId?: string }) {
  const t = useT();
  const Icon = KIND_ICON[kind] ?? Layers;
  const label = KIND_ICON[kind] ? t(`app.analysisRun.kind.${kind}` as MessageKey) : kind;
  return (
    <span
      data-testid={testId}
      data-kind={kind}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-foreground"
    >
      <Icon className="size-3 shrink-0 text-primary" aria-hidden={true} />
      {label}
    </span>
  );
}

export function RerunBadge() {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
      <RotateCcw className="size-3 shrink-0" aria-hidden={true} />
      {t('app.analysisRun.history.rerunBadge')}
    </span>
  );
}

const OUTCOME_STYLE: Record<string, { icon: IconType; cls: string }> = {
  COMPLETED: { icon: CheckCircle2, cls: 'text-emerald-700 dark:text-emerald-300' },
  PARTIAL: { icon: CircleAlert, cls: 'text-amber-700 dark:text-amber-300' },
  FAILED: { icon: XCircle, cls: 'text-red-700 dark:text-red-300' },
  PASSED: { icon: CheckCircle2, cls: 'text-emerald-700 dark:text-emerald-300' },
  ERROR: { icon: CircleAlert, cls: 'text-red-700 dark:text-red-300' },
};

/** Engine call outcome (COMPLETED / PARTIAL / FAILED) with icon + text. */
export function CallOutcome({ outcome }: { outcome: string }) {
  const t = useT();
  const style = OUTCOME_STYLE[outcome] ?? OUTCOME_STYLE.FAILED;
  const Icon = style.icon;
  const known = outcome === 'COMPLETED' || outcome === 'PARTIAL' || outcome === 'FAILED';
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${style.cls}`}>
      <Icon className="size-3.5 shrink-0" aria-hidden={true} />
      {known ? t(`app.analysisRun.outcome.${outcome}` as MessageKey) : outcome}
    </span>
  );
}

/** Test Lab verdict (PASSED / FAILED / ERROR) with icon + text. */
export function LabVerdict({ status }: { status: string }) {
  const t = useT();
  const style = status === 'FAILED' ? { icon: XCircle, cls: 'text-red-700 dark:text-red-300' } : OUTCOME_STYLE[status] ?? OUTCOME_STYLE.ERROR;
  const Icon = style.icon;
  const known = status === 'PASSED' || status === 'FAILED' || status === 'ERROR';
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${style.cls}`} data-verdict={status}>
      <Icon className="size-3.5 shrink-0" aria-hidden={true} />
      {known ? t(`app.analysisRun.lab.status.${status}` as MessageKey) : status}
    </span>
  );
}

/** Human duration (ms / s / min) from milliseconds, locale-formatted. */
export function useDuration(): (ms: number | null | undefined) => string {
  const t = useT();
  return React.useCallback(
    (ms: number | null | undefined) => {
      if (ms === null || ms === undefined || !Number.isFinite(ms)) return t('app.analysisRun.notAvailable');
      if (ms < 1000) return t('app.analysisRun.duration.ms', { value: Math.round(ms) });
      if (ms < 120_000) return t('app.analysisRun.duration.s', { value: Math.round(ms / 100) / 10 });
      return t('app.analysisRun.duration.min', { value: Math.round(ms / 6000) / 10 });
    },
    [t]
  );
}
