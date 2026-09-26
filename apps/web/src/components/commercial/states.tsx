'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, CircleSlash, Clock, Info, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { ApiError } from '@/lib/api/custom-instance';
import { formatMeterValue, METER_LABELS } from '@/lib/api/commercial';

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.statusCode === 403) return 'Your role does not allow this view. Ask an organization owner or security admin.';
    if (error.statusCode === 401) return 'Your session has expired. Sign in again.';
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Unexpected error';
}

/** Contextual error with an explicit retry action (Axiom 1.3). */
export function ErrorState({ title, error, onRetry }: { title: string; error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm flex items-start gap-3">
      <XCircle className="size-5 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-destructive">{title}</p>
        <p className="text-destructive/90 mt-0.5 break-words">{errorMessage(error)}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" /> Retry
        </button>
      )}
    </div>
  );
}

export function Notice({
  tone,
  title,
  children,
}: {
  tone: 'info' | 'warning' | 'success';
  title: string;
  children?: React.ReactNode;
}) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'warning' ? AlertTriangle : Info;
  const cls =
    tone === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/10'
      : tone === 'warning'
      ? 'border-amber-500/40 bg-amber-500/10'
      : 'border-primary/30 bg-primary/5';
  return (
    <div role={tone === 'warning' ? 'alert' : 'status'} className={`rounded-xl border p-4 text-sm flex items-start gap-3 ${cls}`}>
      <Icon className="size-5 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold text-foreground">{title}</p>
        {children && <div className="text-muted-foreground mt-0.5">{children}</div>}
      </div>
    </div>
  );
}

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse motion-reduce:animate-none rounded-lg bg-muted ${className}`} />;
}

export function InlineSpinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
      <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * Usage meter: text + progress bar; the exceeded / near-limit state is carried
 * by an icon and a text label, never by colour alone (Axiom 1.5).
 */
export function UsageMeterRow({
  meterKey,
  used,
  limit,
  unlimited,
}: {
  meterKey: string;
  used: number;
  limit: number;
  unlimited: boolean;
}) {
  const label = METER_LABELS[meterKey] ?? meterKey;
  const ratio = unlimited || limit <= 0 ? 0 : Math.min(1, used / limit);
  const exceeded = !unlimited && limit >= 0 && used >= limit;
  const near = !exceeded && !unlimited && ratio >= 0.8;
  const state = unlimited ? 'Unlimited' : exceeded ? 'Limit reached' : near ? 'Near limit' : 'Within limit';
  const StateIcon = unlimited ? CircleSlash : exceeded ? XCircle : near ? AlertTriangle : CheckCircle2;
  const bar = exceeded ? 'bg-destructive' : near ? 'bg-amber-500' : 'bg-primary';
  const valueText = unlimited
    ? `${formatMeterValue(meterKey, used)} used, unlimited`
    : `${formatMeterValue(meterKey, used)} of ${formatMeterValue(meterKey, limit)}`;

  return (
    <div className="space-y-1.5" data-testid={`meter-${meterKey}`}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground tabular-nums">{valueText}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={unlimited ? undefined : limit}
        aria-valuenow={used}
        aria-valuetext={`${valueText} — ${state}`}
        className="h-2 w-full rounded-full bg-muted overflow-hidden"
      >
        <div className={`h-full ${bar} transition-[width] motion-reduce:transition-none`} style={{ width: `${unlimited ? 0 : ratio * 100}%` }} />
      </div>
      <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
        <StateIcon className="size-3.5" aria-hidden="true" />
        {state}
      </p>
    </div>
  );
}

const STATUS_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  ACTIVE: { label: 'Active', icon: CheckCircle2, cls: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300' },
  TRIALING: { label: 'Trialing', icon: Clock, cls: 'border-primary/40 text-primary' },
  PAST_DUE: { label: 'Payment past due', icon: AlertTriangle, cls: 'border-amber-500/50 text-amber-700 dark:text-amber-300' },
  UNPAID: { label: 'Unpaid', icon: XCircle, cls: 'border-destructive/50 text-destructive' },
  CANCELED: { label: 'Canceled', icon: CircleSlash, cls: 'border-border text-muted-foreground' },
  INCOMPLETE: { label: 'Incomplete', icon: AlertTriangle, cls: 'border-amber-500/50 text-amber-700 dark:text-amber-300' },
  NONE: { label: 'No subscription', icon: CircleSlash, cls: 'border-border text-muted-foreground' },
};

export function SubscriptionStatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.NONE;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${meta.cls}`}>
      <Icon className="size-3.5" aria-hidden="true" />
      {meta.label}
    </span>
  );
}
