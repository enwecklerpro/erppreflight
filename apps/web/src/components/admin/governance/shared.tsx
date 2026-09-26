'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Lock, RefreshCw } from 'lucide-react';
import { fetchCurrentUser } from '@/lib/api-client';
import { SkeletonBlock } from '@/components/commercial/states';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useT } from '@/i18n/client';

export const card = 'bg-card border border-border rounded-xl p-5 shadow-sm';
export const th = 'px-3 py-2 text-left text-xs font-semibold text-muted-foreground';
export const td = 'px-3 py-2 align-top';
export const btn =
  'inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50';
export const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50';
export const selectCls = 'h-9 rounded-lg border border-input bg-background px-2 text-sm';

/**
 * Renders children only for platform administrators (SUPER_ADMIN). The API enforces
 * the same rule on every endpoint; this gate only avoids rendering an unusable page.
 */
export function SuperAdminGate({ children }: { children: React.ReactNode }) {
  const t = useT();
  const me = useQuery({ queryKey: ['auth', 'me'], queryFn: fetchCurrentUser, retry: 1 });
  if (me.isLoading) {
    return (
      <div className="space-y-4" role="status" aria-label={t('app.admin.verifying')}>
        <SkeletonBlock className="h-24" />
        <SkeletonBlock className="h-64" />
      </div>
    );
  }
  if (me.isError || me.data?.user?.systemRole !== 'SUPER_ADMIN') {
    return (
      <div className="max-w-xl mx-auto py-16">
        <div className="bg-card border border-destructive/30 rounded-2xl p-6 sm:p-8 shadow-sm text-center space-y-4">
          <div className="inline-flex p-3 bg-destructive/10 rounded-full text-destructive">
            <Lock className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold">{t('app.admin.deniedTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('app.admin.deniedBody')}</p>
          <Link href="/login" className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg">
            {t('app.admin.signIn')} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function GovernanceHeader({
  title,
  intro,
  onRefresh,
  refreshing,
  actions,
}: {
  title: string;
  intro: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  actions?: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="space-y-3">
      <Link href="/admin" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden="true" /> {t('app.governance.common.backToAdmin')}
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{intro}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions}
          {onRefresh && (
            <button type="button" onClick={onRefresh} className={btn} disabled={refreshing}>
              <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
              {t('app.governance.common.refresh')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export type Tone = 'good' | 'bad' | 'warn' | 'neutral' | 'info';
const TONES: Record<Tone, string> = {
  good: 'bg-green-100 text-green-900 border-green-300 dark:bg-green-950 dark:text-green-200 dark:border-green-800',
  bad: 'bg-red-100 text-red-900 border-red-300 dark:bg-red-950 dark:text-red-200 dark:border-red-800',
  warn: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800',
  info: 'bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-800',
  neutral: 'bg-muted text-foreground border-border',
};

/** Status label with icon + text (never colour alone, Axiom 1.5). */
export function Pill({ tone, icon: Icon, children, title }: { tone: Tone; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {children}
    </span>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className={card}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Registers the unsaved-changes guard for a TanStack form (Axiom 1.7). */
export function FormGuard({ isDirty, isSubmitting, children }: { isDirty: boolean; isSubmitting: boolean; children: React.ReactNode }) {
  const t = useT();
  useUnsavedChangesGuard({ isDirty, isSubmitting });
  return (
    <>
      {children}
      {isDirty && !isSubmitting && (
        <p className="text-xs text-muted-foreground" role="status">
          {t('app.governance.common.unsavedHint')}
        </p>
      )}
    </>
  );
}

export function Pager({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (offset: number) => void }) {
  const t = useT();
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <nav className="flex flex-wrap items-center justify-between gap-2 text-xs" aria-label={t('app.governance.common.pageOf', { page, pages })}>
      <span className="text-muted-foreground">
        {t('app.governance.common.showing', { from: offset + 1, to: Math.min(offset + limit, total), total })}
      </span>
      <span className="flex gap-2">
        <button type="button" className={btn} disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          {t('app.governance.common.previous')}
        </button>
        <span className="self-center">{t('app.governance.common.pageOf', { page, pages })}</span>
        <button type="button" className={btn} disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
          {t('app.governance.common.next')}
        </button>
      </span>
    </nav>
  );
}
