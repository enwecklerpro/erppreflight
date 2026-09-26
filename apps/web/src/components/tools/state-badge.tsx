import * as React from 'react';
import {
  Ban,
  BadgeCheck,
  CircleHelp,
  CircleSlash,
  Clock3,
  Library,
  Lock,
  AlertTriangle,
  Info,
  XCircle,
} from 'lucide-react';
import type { SupportState } from '@/lib/public-tools';

const STYLES: Record<SupportState, { icon: React.ComponentType<{ className?: string }>; className: string }> = {
  RELEASED: { icon: BadgeCheck, className: 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800' },
  DEPRECATED: { icon: Clock3, className: 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800' },
  NOT_RELEASED: { icon: CircleSlash, className: 'bg-red-50 text-red-800 border-red-300 dark:bg-red-950/60 dark:text-red-200 dark:border-red-800' },
  NOT_TO_BE_RELEASED_STABLE: { icon: Lock, className: 'bg-orange-50 text-orange-800 border-orange-300 dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-800' },
  CLASSIC_API: { icon: Library, className: 'bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-950/60 dark:text-sky-200 dark:border-sky-800' },
  NO_API: { icon: Ban, className: 'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800' },
  SUPPORTED: { icon: BadgeCheck, className: 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800' },
  BLOCKED: { icon: Ban, className: 'bg-red-50 text-red-800 border-red-300 dark:bg-red-950/60 dark:text-red-200 dark:border-red-800' },
  UNKNOWN: { icon: CircleHelp, className: 'bg-muted text-muted-foreground border-border' },
};

/** Release support state — icon + text label, never colour alone (AGENTS.md Axiom 1.5). */
export function StateBadge({ state, label, level }: { state: SupportState; label: string; level?: string | null }) {
  const s = STYLES[state] ?? STYLES.UNKNOWN;
  const Icon = s.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${s.className}`}
      data-state={state}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {label}
      {level ? <span className="font-mono font-normal opacity-80">· {level}</span> : null}
    </span>
  );
}

const ISSUE_STYLES = {
  ERROR: { icon: XCircle, className: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100' },
  WARNING: { icon: AlertTriangle, className: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100' },
  INFO: { icon: Info, className: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-100' },
} as const;

/** Severity of a checker issue — icon + text. */
export function IssueBadge({ severity, label }: { severity: keyof typeof ISSUE_STYLES; label: string }) {
  const s = ISSUE_STYLES[severity];
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${s.className}`}>
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}
