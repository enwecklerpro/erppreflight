'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronLeft, ChevronRight, SearchX } from 'lucide-react';
import { useLocale, useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/translate';
import { useDebouncedSearch } from '@/hooks/pacer';
import {
  CHANGE_TYPES,
  fetchApiLifecycle,
  fetchPublicReleaseDiff,
  fetchPublicReleases,
  toolKeys,
  type ApiLifecycle,
} from '@/lib/public-tools';
import { localizePath } from '@/lib/routing';
import { LocalizedState, ResultSkeleton, SearchField, ToolError, toolRetry, useUrlParam, useUrlUpdate } from './client-common';
import { VerdictBanner } from './verdict';

type Mode = 'search' | 'deprecated' | 'diff';
const MODES: Mode[] = ['search', 'deprecated', 'diff'];

function LifecycleCard({ o }: { o: ApiLifecycle['results'][number] }) {
  const t = useT();
  const locale = useLocale();
  const successors = o.headline?.successors ?? [];
  return (
    <li className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="api-result">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-mono text-base font-bold break-all">
          {o.slug ? (
            <Link href={localizePath(locale, `/sap/clean-core/${o.slug}`)} className="hover:underline">
              {o.objectKey}
            </Link>
          ) : (
            o.objectKey
          )}
        </h3>
        <span className="text-xs text-muted-foreground">
          {o.sapObjectType} · {o.objectType.replace(/_/g, ' ').toLowerCase()}
        </span>
      </div>
      <VerdictBanner verdict={o.verdict} headline={o.headline} t={t} />
      {o.lifecycle.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[520px] text-left text-xs">
            <caption className="sr-only">{t('publicTools.sap.lifecycleTitle')}</caption>
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">{t('publicTools.common.edition')}</th>
                <th scope="col" className="px-3 py-2">{t('publicTools.api.current')}</th>
                <th scope="col" className="px-3 py-2">{t('publicTools.api.firstReleased')}</th>
                <th scope="col" className="px-3 py-2">{t('publicTools.api.firstDeprecated')}</th>
              </tr>
            </thead>
            <tbody>
              {o.lifecycle.map((l) => (
                <tr key={l.editionCode} className="border-t border-border">
                  <td className="px-3 py-2">{t(`publicTools.editions.${l.editionCode}` as MessageKey)}</td>
                  <td className="px-3 py-2">
                    <LocalizedState state={l.currentState} />
                  </td>
                  <td className="px-3 py-2">{l.firstReleasedIn ?? t('publicTools.api.neverReleased')}</td>
                  <td className="px-3 py-2">{l.firstDeprecatedIn ?? t('publicTools.api.notYet')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {successors.length > 0 ? (
        <p className="flex flex-wrap items-center gap-1.5 text-xs">
          <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">{t('publicTools.common.successors')}:</span>
          {successors.map((s) =>
            s.slug ? (
              <Link key={s.objectKey} href={localizePath(locale, `/sap/clean-core/${s.slug}`)} className="font-mono text-primary hover:underline">
                {s.objectKey}
              </Link>
            ) : (
              <span key={s.objectKey} className="font-mono">
                {s.objectKey}
              </span>
            )
          )}
        </p>
      ) : null}
    </li>
  );
}

function SearchMode() {
  const t = useT();
  const [q, setQ] = useUrlParam('q');
  const [term, setTerm] = React.useState(q);
  const { debouncedValue } = useDebouncedSearch(term.trim(), 350);
  React.useEffect(() => {
    if (debouncedValue !== q) setQ(debouncedValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedValue]);
  const query = useQuery({
    queryKey: toolKeys.api(debouncedValue, false, 0),
    queryFn: ({ signal }) => fetchApiLifecycle({ q: debouncedValue }, signal),
    enabled: debouncedValue.length > 0,
    staleTime: 60_000,
    retry: toolRetry,
  });
  return (
    <div className="space-y-4">
      <SearchField
        id="api-q"
        label={t('publicTools.api.label')}
        placeholder={t('publicTools.api.placeholder')}
        value={term}
        onChange={setTerm}
        busy={query.isFetching}
      />
      <div aria-live="polite">
        {!debouncedValue ? (
          <p className="text-sm text-muted-foreground">{t('publicTools.api.hint')}</p>
        ) : query.isLoading ? (
          <ResultSkeleton rows={2} height="h-48" />
        ) : query.isError ? (
          <ToolError error={query.error} onRetry={() => query.refetch()} />
        ) : query.data && query.data.results.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center" data-testid="tool-empty">
            <SearchX className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">{t('publicTools.common.notFoundQuery', { query: debouncedValue })}</p>
          </div>
        ) : query.data ? (
          <ul className="space-y-3">
            {query.data.results.map((o) => (
              <LifecycleCard key={`${o.sapObjectType}-${o.objectKey}`} o={o} />
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function Pager({ offset, pageSize, total, onChange }: { offset: number; pageSize: number; total: number; onChange: (o: number) => void }) {
  const t = useT();
  const page = Math.floor(offset / pageSize) + 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="flex items-center justify-between gap-2 text-xs" aria-label={t('publicTools.common.pageOf', { page, pages })}>
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(Math.max(0, offset - pageSize))}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 disabled:opacity-50"
      >
        <ChevronLeft className="size-3.5" aria-hidden="true" /> {t('publicTools.common.previous')}
      </button>
      <span className="text-muted-foreground">{t('publicTools.common.pageOf', { page, pages })}</span>
      <button
        type="button"
        disabled={page >= pages}
        onClick={() => onChange(offset + pageSize)}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 disabled:opacity-50"
      >
        {t('publicTools.common.next')} <ChevronRight className="size-3.5" aria-hidden="true" />
      </button>
    </nav>
  );
}

function DeprecatedMode() {
  const t = useT();
  const [offsetParam, setOffsetParam] = useUrlParam('offset');
  const offset = Math.max(0, Number(offsetParam) || 0);
  const query = useQuery({
    queryKey: toolKeys.api('', true, offset),
    queryFn: ({ signal }) => fetchApiLifecycle({ deprecated: true, offset }, signal),
    staleTime: 300_000,
    retry: toolRetry,
  });
  if (query.isLoading) return <ResultSkeleton rows={3} height="h-48" />;
  if (query.isError) return <ToolError error={query.error} onRetry={() => query.refetch()} />;
  if (!query.data) return null;
  const total = query.data.total ?? 0;
  return (
    <div className="space-y-3" aria-live="polite">
      <p className="text-sm" data-testid="deprecated-count">
        {t('publicTools.api.deprecatedIntro', { count: total })}
      </p>
      <ul className="space-y-3">
        {query.data.results.map((o) => (
          <LifecycleCard key={`${o.sapObjectType}-${o.objectKey}`} o={o} />
        ))}
      </ul>
      {total > 20 ? <Pager offset={offset} pageSize={20} total={total} onChange={(o) => setOffsetParam(o ? String(o) : '')} /> : null}
    </div>
  );
}

function DiffMode() {
  const t = useT();
  const locale = useLocale();
  const [from] = useUrlParam('from');
  const [to] = useUrlParam('to');
  const [changeType] = useUrlParam('change');
  const [offsetParam, setOffsetParam] = useUrlParam('offset');
  const update = useUrlUpdate();
  const offset = Math.max(0, Number(offsetParam) || 0);
  const releases = useQuery({ queryKey: toolKeys.releases, queryFn: ({ signal }) => fetchPublicReleases(signal), staleTime: 600_000, retry: toolRetry });
  const ready = Boolean(from && to && from !== to);
  const diff = useQuery({
    queryKey: toolKeys.diff(from, to, changeType, offset),
    queryFn: ({ signal }) =>
      fetchPublicReleaseDiff({ fromRelease: from, toRelease: to, changeType: changeType || undefined, offset }, signal),
    enabled: ready,
    staleTime: 300_000,
    retry: toolRetry,
  });

  const options = (releases.data?.releases ?? []).map((r) => ({
    value: r.id,
    label: `${t(`publicTools.editions.${r.editionCode}` as MessageKey)} — ${r.label}`,
  }));
  const selectClass =
    'h-10 w-full rounded-lg border border-input bg-background px-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40';

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('publicTools.api.diffIntro')}</p>
      {releases.isError ? <ToolError error={releases.error} onRetry={() => releases.refetch()} /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-semibold">
          {t('publicTools.api.from')}
          <select
            className={selectClass}
            value={from}
            onChange={(e) => update({ from: e.target.value, offset: '' })}
            disabled={releases.isLoading}
            data-testid="diff-from"
          >
            <option value="">—</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          {t('publicTools.api.to')}
          <select
            className={selectClass}
            value={to}
            onChange={(e) => update({ to: e.target.value, offset: '' })}
            disabled={releases.isLoading}
            data-testid="diff-to"
          >
            <option value="">—</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          {t('publicTools.api.changeType')}
          <select
            className={selectClass}
            value={changeType}
            onChange={(e) => update({ change: e.target.value, offset: '' })}
          >
            <option value="">{t('publicTools.api.allChanges')}</option>
            {CHANGE_TYPES.map((c) => (
              <option key={c} value={c}>
                {t(`publicTools.changeTypes.${c}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {from && to && from === to ? <p className="text-sm text-destructive" role="alert">{t('publicTools.api.sameRelease')}</p> : null}
      <div aria-live="polite">
        {!ready ? null : diff.isLoading ? (
          <ResultSkeleton rows={4} height="h-10" />
        ) : diff.isError ? (
          <ToolError error={diff.error} onRetry={() => diff.refetch()} />
        ) : diff.data ? (
          <div className="space-y-3" data-testid="diff-result">
            <ul className="flex flex-wrap gap-2 text-xs">
              {Object.entries(diff.data.summary).map(([k, n]) => (
                <li key={k} className="rounded-md border border-border bg-muted/40 px-2 py-1">
                  {t(`publicTools.changeTypes.${k}` as MessageKey)}: <strong>{n}</strong>
                </li>
              ))}
            </ul>
            {diff.data.items.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('publicTools.api.diffEmpty')}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <caption className="sr-only">{t('publicTools.api.modeDiff')}</caption>
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2">SAP</th>
                      <th scope="col" className="px-3 py-2">{t('publicTools.api.changeType')}</th>
                      <th scope="col" className="px-3 py-2">{t('publicTools.api.previousState')}</th>
                      <th scope="col" className="px-3 py-2">{t('publicTools.api.currentState')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.data.items.map((i) => (
                      <tr key={`${i.sapObjectType}-${i.objectKey}`} className="border-t border-border">
                        <td className="px-3 py-2">
                          {i.slug ? (
                            <Link href={localizePath(locale, `/sap/clean-core/${i.slug}`)} className="font-mono text-primary hover:underline">
                              {i.objectKey}
                            </Link>
                          ) : (
                            <span className="font-mono">{i.objectKey}</span>
                          )}{' '}
                          <span className="text-muted-foreground">{i.sapObjectType}</span>
                        </td>
                        <td className="px-3 py-2">{t(`publicTools.changeTypes.${i.changeType}` as MessageKey)}</td>
                        <td className="px-3 py-2">{i.previous ? <LocalizedState state={i.previous.supportState} /> : '—'}</td>
                        <td className="px-3 py-2">{i.current ? <LocalizedState state={i.current.supportState} /> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {diff.data.total > 25 ? (
              <Pager offset={offset} pageSize={25} total={diff.data.total} onChange={(o) => setOffsetParam(o ? String(o) : '')} />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** API deprecation lookup: search, browse deprecated APIs, release diff. */
export function ApiDeprecationTool() {
  const t = useT();
  const [modeParam] = useUrlParam('mode');
  const update = useUrlUpdate();
  const setMode = (m: string) => update({ mode: m, offset: '' });
  const mode: Mode = (MODES as string[]).includes(modeParam) ? (modeParam as Mode) : 'search';
  const labels: Record<Mode, string> = {
    search: t('publicTools.api.modeSearch'),
    deprecated: t('publicTools.api.modeDeprecated'),
    diff: t('publicTools.api.modeDiff'),
  };
  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = MODES[(i + (e.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length];
    setMode(next === 'search' ? '' : next);
    document.getElementById(`api-tab-${next}`)?.focus();
  };
  return (
    <section className="space-y-4" aria-label={t('publicTools.tools.api-deprecations.name')}>
      <div role="tablist" aria-label={t('publicTools.tools.api-deprecations.name')} className="flex flex-wrap gap-2 border-b border-border">
        {MODES.map((m, i) => (
          <button
            key={m}
            id={`api-tab-${m}`}
            role="tab"
            type="button"
            aria-selected={mode === m}
            aria-controls={`api-panel-${m}`}
            tabIndex={mode === m ? 0 : -1}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => setMode(m === 'search' ? '' : m)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              mode === m ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            data-testid={`api-mode-${m}`}
          >
            {labels[m]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`api-panel-${mode}`} aria-labelledby={`api-tab-${mode}`}>
        {mode === 'search' ? <SearchMode /> : mode === 'deprecated' ? <DeprecatedMode /> : <DiffMode />}
      </div>
    </section>
  );
}
