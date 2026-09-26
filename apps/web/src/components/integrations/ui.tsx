'use client';

import * as React from 'react';
import { useErrorText, useFmt, useT } from '@/i18n/client';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Clock,
  Copy,
  Check,
  HelpCircle,
  Loader2,
  RefreshCw,
  ShieldAlert,
  XCircle,
  Zap,
} from 'lucide-react';
import { ApiError } from '@/lib/api/custom-instance';

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

const TONE: Record<Tone, string> = {
  ok: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
  bad: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30',
  info: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30',
  neutral: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30',
};

/** Status badge: colour is always paired with an icon and a text label (never colour alone). */
export function StatusBadge({ tone, icon: Icon, label, title }: { tone: Tone; icon: React.ElementType; label: string; title?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${TONE[tone]}`}
      title={title}
    >
      <Icon className="size-3" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function HealthBadge({ status }: { status: string }) {
  const t = useT();
  switch (status) {
    case 'HEALTHY':
      return <StatusBadge tone="ok" icon={CheckCircle2} label={t('app.integrations.health.HEALTHY')} />;
    case 'DEGRADED':
      return <StatusBadge tone="warn" icon={AlertTriangle} label={t('app.integrations.health.DEGRADED')} />;
    case 'UNHEALTHY':
      return <StatusBadge tone="bad" icon={XCircle} label={t('app.integrations.health.UNHEALTHY')} />;
    default:
      return <StatusBadge tone="neutral" icon={HelpCircle} label={t('app.integrations.health.UNKNOWN')} />;
  }
}

export function CircuitBadge({ state }: { state: string }) {
  const t = useT();
  if (state === 'OPEN') {
    return <StatusBadge tone="bad" icon={Ban} label={t('app.integrations.circuit.open')} title={t('app.integrations.circuit.openHint')} />;
  }
  if (state === 'HALF_OPEN') return <StatusBadge tone="warn" icon={CircleDashed} label={t('app.integrations.circuit.halfOpen')} />;
  return <StatusBadge tone="neutral" icon={Zap} label={t('app.integrations.circuit.closed')} />;
}

const OUTCOMES: Record<string, [Tone, React.ElementType]> = {
  SUCCESS: ['ok', CheckCircle2],
  SUCCEEDED: ['ok', CheckCircle2],
  FAILED: ['bad', XCircle],
  DEAD: ['bad', CircleSlash],
  BLOCKED: ['warn', Ban],
  CONFLICT: ['warn', AlertTriangle],
  SKIPPED: ['neutral', CircleDashed],
  PENDING: ['info', Clock],
};

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const t = useT();
  const known = OUTCOMES[outcome];
  const [tone, icon] = known ?? ['neutral', HelpCircle];
  const label = known ? t(`app.integrations.outcome.${outcome as 'SUCCESS'}`) : outcome;
  return <StatusBadge tone={tone} icon={icon} label={label} />;
}

export function RemediationBadge({ state }: { state: string }) {
  const t = useT();
  const map: Record<string, [Tone, React.ElementType]> = {
    OPEN: ['info', CircleDashed],
    IN_PROGRESS: ['info', Clock],
    PENDING_VERIFICATION: ['warn', ShieldAlert],
    VERIFIED_RESOLVED: ['ok', CheckCircle2],
  };
  const known = map[state];
  const [tone, icon] = known ?? ['neutral', HelpCircle];
  const label = known ? t(`app.traceability.remediation.${state as 'OPEN'}`) : state;
  return <StatusBadge tone={tone} icon={icon} label={label} title={t('app.traceability.remediation.hint')} />;
}

export function Card({ title, description, actions, children }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground max-w-2xl">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function PanelLoading({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 rounded-lg bg-muted/60 dark:bg-muted-dark/60 motion-safe:animate-pulse" />
      ))}
    </div>
  );
}

/** Raw (untranslated) server message; components use `useIntegrationText().errorText` for display. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return '';
}

/** Locale-aware helpers shared by the integration panels (dates, relative times, API errors). */
export function useIntegrationText() {
  const t = useT();
  const fmt = useFmt();
  const errText = useErrorText();
  return React.useMemo(
    () => ({
      t,
      errorText: (err: unknown) => errText(err, t('app.integrations.common.unexpectedError')),
      formatDate: (v: string | null | undefined) => fmt.dateTime(v),
      relative: (v: string | null | undefined) => (v ? fmt.relative(v) : t('app.integrations.common.never')),
    }),
    [t, fmt, errText]
  );
}

export function PanelError({ error, onRetry, what }: { error: unknown; onRetry: () => void; what: string }) {
  const { t, errorText } = useIntegrationText();
  return (
    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
      <div className="flex items-start gap-2 text-destructive">
        <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="font-semibold">{t('app.integrations.common.couldNotLoad', { what })}</p>
          <p className="opacity-90">{errorText(error)}</p>
        </div>
      </div>
      <Button variant="secondary" onClick={onRetry}>
        <RefreshCw className="size-3.5" aria-hidden="true" /> {t('app.integrations.common.retry')}
      </Button>
    </div>
  );
}

export function PanelEmpty({ icon: Icon, title, body, action }: { icon: React.ElementType; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center">
      <Icon className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
      <p className="mt-2 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">{body}</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

export function Button({
  variant = 'primary',
  busy,
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; busy?: boolean }) {
  const styles = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary-dark',
    secondary: 'border border-border bg-background text-foreground hover:bg-muted dark:hover:bg-muted-dark',
    danger: 'border border-destructive/40 text-destructive hover:bg-destructive/10',
    ghost: 'text-muted-foreground hover:text-foreground hover:bg-muted dark:hover:bg-muted-dark',
  }[variant];
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {busy && <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** Two-step confirmation for destructive / risk-increasing actions (Escape cancels). */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  variant = 'danger',
  busy,
}: {
  label: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  variant?: 'danger' | 'secondary' | 'primary';
  busy?: boolean;
}) {
  const t = useT();
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setArmed(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armed]);
  if (!armed) {
    return (
      <Button variant={variant === 'primary' ? 'secondary' : variant} onClick={() => setArmed(true)} busy={busy}>
        {label}
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1" role="group" aria-label={t('app.integrations.common.confirmAction')}>
      <Button variant={variant} onClick={() => { setArmed(false); onConfirm(); }} autoFocus>
        {confirmLabel}
      </Button>
      <Button variant="ghost" onClick={() => setArmed(false)}>
        {t('app.integrations.common.cancel')}
      </Button>
    </span>
  );
}

/** Displays a secret exactly once with a copy button. */
export function OneTimeSecret({ label, value, onDismiss }: { label: string; value: string; onDismiss: () => void }) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  return (
    <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs space-y-2">
      <p className="font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
        <ShieldAlert className="size-3.5" aria-hidden="true" /> {t('app.integrations.common.oneTimeSecret', { label })}
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 break-all rounded bg-background border border-border px-2 py-1 font-mono text-[11px]">{value}</code>
        <Button
          variant="secondary"
          onClick={() => {
            navigator.clipboard?.writeText(value).catch(() => undefined);
            setCopied(true);
          }}
          aria-label={t('app.integrations.common.copyToClipboard')}
        >
          {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
          {copied ? t('app.integrations.common.copied') : t('app.integrations.common.copy')}
        </Button>
        <Button variant="ghost" onClick={onDismiss}>
          {t('app.integrations.common.done')}
        </Button>
      </div>
    </div>
  );
}
