'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, RefreshCw, Search } from 'lucide-react';
import { useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/translate';
import { ApiError } from '@/lib/api/custom-instance';
import type { SupportState } from '@/lib/public-tools';
import { StateBadge } from './state-badge';

/** Updates several search parameters in one navigation (empty string removes a parameter). */
export function useUrlUpdate(): (updates: Record<string, string>) => void {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return React.useCallback(
    (updates: Record<string, string>) => {
      const p = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      const qs = p.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
    },
    [params, pathname, router]
  );
}

/** Keeps one search parameter in the URL (shareable tool results, Axiom 1 client state = URL). */
export function useUrlParam(name: string): [string, (value: string) => void] {
  const params = useSearchParams();
  const update = useUrlUpdate();
  const value = params.get(name) ?? '';
  const set = React.useCallback((next: string) => update({ [name]: next }), [name, update]);
  return [value, set];
}

/** Retries network/5xx errors twice; never retries validation, auth or rate-limit answers. */
export function toolRetry(count: number, err: unknown) {
  return !(err instanceof ApiError && [400, 401, 403, 404, 422, 429].includes(err.statusCode)) && count < 2;
}

export function ToolError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  const rateLimited = error instanceof ApiError && error.statusCode === 429;
  const badRequest = error instanceof ApiError && error.statusCode === 400;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="flex-1">
        {rateLimited
          ? t('publicTools.common.rateLimited')
          : badRequest && error instanceof Error
            ? error.message
            : t('publicTools.common.unavailable')}
      </p>
      {!badRequest ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-0.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
        >
          <RefreshCw className="size-3" aria-hidden="true" /> {t('publicTools.common.retry')}
        </button>
      ) : null}
    </div>
  );
}

export function SearchField({
  id,
  label,
  placeholder,
  value,
  onChange,
  busy,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  busy?: boolean;
}) {
  return (
    <form role="search" onSubmit={(e) => e.preventDefault()} className="relative">
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        {label}
      </label>
      <Search className="pointer-events-none absolute left-3 top-[2.35rem] size-4 text-muted-foreground" aria-hidden="true" />
      <input
        id={id}
        type="search"
        autoComplete="off"
        spellCheck={false}
        maxLength={120}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-busy={busy || undefined}
        className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-3 font-mono text-sm shadow-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
    </form>
  );
}

/** Skeleton rows with the height of a result card (no layout shift when results arrive). */
export function ResultSkeleton({ rows = 3, height = 'h-24' }: { rows?: number; height?: string }) {
  const t = useT();
  return (
    <ul className="space-y-2" aria-busy="true" aria-label={t('publicTools.common.loading')}>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className={`${height} animate-pulse rounded-xl border border-border bg-muted/40 motion-reduce:animate-none`} />
      ))}
    </ul>
  );
}

/** Localized state badge for client components. */
export function LocalizedState({ state, level }: { state: SupportState; level?: string | null }) {
  const t = useT();
  return <StateBadge state={state} label={t(`publicTools.states.${state}` as MessageKey)} level={level} />;
}
