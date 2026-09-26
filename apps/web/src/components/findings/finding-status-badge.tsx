'use client';

import * as React from 'react';
import {
  CircleDot,
  Eye,
  ShieldCheck,
  Ban,
  CheckCircle2,
  FlaskConical,
  EyeOff,
  type LucideIcon,
} from 'lucide-react';
import type { FindingStatus } from '@erppreflight/schemas';
import { useT } from '@/i18n/client';

/** Icon + text + ARIA label per status: never color alone (AGENTS.md Axiom 1 #5). */
export const FINDING_STATUS_STYLE: Record<FindingStatus, { icon: LucideIcon; className: string }> = {
  OPEN: {
    icon: CircleDot,
    className: 'bg-blue-50 text-blue-800 border-blue-300 dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-800',
  },
  ACKNOWLEDGED: {
    icon: Eye,
    className: 'bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-950/60 dark:text-sky-200 dark:border-sky-800',
  },
  ACCEPTED_RISK: {
    icon: ShieldCheck,
    className: 'bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800',
  },
  FALSE_POSITIVE: {
    icon: Ban,
    className: 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600',
  },
  RESOLVED: {
    icon: CheckCircle2,
    className: 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800',
  },
  REGRESSION_TEST_CREATED: {
    icon: FlaskConical,
    className: 'bg-violet-50 text-violet-800 border-violet-300 dark:bg-violet-950/60 dark:text-violet-200 dark:border-violet-800',
  },
  SUPPRESSED: {
    icon: EyeOff,
    className: 'bg-zinc-100 text-zinc-800 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-600',
  },
};

export function FindingStatusBadge({
  status,
  size = 'default',
  className = '',
}: {
  status: FindingStatus;
  size?: 'sm' | 'default';
  className?: string;
}) {
  const t = useT();
  const style = FINDING_STATUS_STYLE[status] ?? FINDING_STATUS_STYLE.OPEN;
  const Icon = style.icon;
  const label = t(`findingLifecycle.status.${status}`);
  return (
    <span
      role="status"
      aria-label={t('findingLifecycle.statusAria', { status: label })}
      data-finding-status={status}
      className={`inline-flex items-center gap-1 rounded-full border font-semibold whitespace-nowrap ${
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs'
      } ${style.className} ${className}`}
    >
      <Icon className={size === 'sm' ? 'size-3' : 'size-3.5'} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
