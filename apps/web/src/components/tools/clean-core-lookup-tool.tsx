'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, SearchX } from 'lucide-react';
import { objectKeyToSlug } from '@erppreflight/schemas';
import { useLocale, useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/translate';
import { useDebouncedSearch } from '@/hooks/pacer';
import { kgKeys, lookupObjects, type LookupItem } from '@/lib/knowledge-graph';
import { localizePath } from '@/lib/routing';
import { LocalizedState, ResultSkeleton, SearchField, ToolError, toolRetry, useUrlParam } from './client-common';

function ResultRow({ item }: { item: LookupItem }) {
  const t = useT();
  const locale = useLocale();
  const contract = item.states.filter((s) => s.scheme === 'RELEASE_CONTRACT');
  const classic = item.states.find((s) => s.scheme === 'CLASSIC_API_CLASSIFICATION');
  const successors = [...new Set(contract.flatMap((s) => s.successors.map((x) => x.objectKey)))];
  const slug = objectKeyToSlug(item.objectKey);
  const body = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-mono text-sm font-bold break-all">{item.objectKey}</span>{' '}
          <span className="text-xs text-muted-foreground">
            {item.sapObjectType} · {item.objectType.replace(/_/g, ' ').toLowerCase()}
            {item.applicationComponent ? ` · ${item.applicationComponent}` : ''}
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t('publicTools.cleanCore.match', { type: item.matchType.toLowerCase() })}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {contract.length === 0 && !classic ? (
          <span className="text-xs text-muted-foreground">{t('publicTools.verdicts.NO_OFFICIAL_STATE')}</span>
        ) : null}
        {contract.map((s) => (
          <span key={`${s.editionCode}-${s.releaseCode}`} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            {t(`publicTools.editions.${s.editionCode}` as MessageKey)}: <LocalizedState state={s.supportState} level={s.cleanCoreLevel} />
          </span>
        ))}
        {classic ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            {t('publicTools.common.classicApi')}: <LocalizedState state={classic.supportState} level={classic.cleanCoreLevel} />
          </span>
        ) : null}
      </div>
      {successors.length > 0 ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-1 text-xs">
          <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">{t('publicTools.common.successors')}:</span>
          {successors.slice(0, 6).map((s) => (
            <span key={s} className="font-mono">
              {s}
            </span>
          ))}
          {successors.length > 6 ? <span className="text-muted-foreground">+{successors.length - 6}</span> : null}
        </p>
      ) : null}
    </>
  );
  return (
    <li>
      {slug ? (
        <Link
          href={localizePath(locale, `/sap/clean-core/${slug}`)}
          className="block rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/50 hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          data-testid="lookup-result"
        >
          {body}
        </Link>
      ) : (
        <div className="rounded-xl border border-border bg-card p-3" data-testid="lookup-result" title={t('publicTools.common.noSlug')}>
          {body}
        </div>
      )}
    </li>
  );
}

/** Clean Core Object Lookup (public, rate-limited endpoint: global reviewed knowledge only). */
export function CleanCoreLookupTool() {
  const t = useT();
  const [q, setQ] = useUrlParam('q');
  const [term, setTerm] = React.useState(q);
  const { debouncedValue } = useDebouncedSearch(term.trim(), 300);
  React.useEffect(() => {
    if (debouncedValue !== q) setQ(debouncedValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedValue]);

  const query = useQuery({
    queryKey: kgKeys.lookup(debouncedValue, null, true),
    queryFn: ({ signal }) => lookupObjects(debouncedValue, { isPublic: true, signal }),
    enabled: debouncedValue.length > 0,
    staleTime: 60_000,
    retry: toolRetry,
  });

  return (
    <section className="space-y-4" aria-label={t('publicTools.tools.clean-core-lookup.name')}>
      <SearchField
        id="clean-core-q"
        label={t('publicTools.cleanCore.label')}
        placeholder={t('publicTools.cleanCore.placeholder')}
        value={term}
        onChange={setTerm}
        busy={query.isFetching}
      />
      <div aria-live="polite">
        {!debouncedValue ? (
          <p className="text-sm text-muted-foreground">{t('publicTools.cleanCore.hint')}</p>
        ) : query.isLoading ? (
          <ResultSkeleton />
        ) : query.isError ? (
          <ToolError error={query.error} onRetry={() => query.refetch()} />
        ) : query.data && query.data.results.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center" data-testid="tool-empty">
            <SearchX className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">{t('publicTools.common.notFoundQuery', { query: debouncedValue })}</p>
            <p className="max-w-md text-xs text-muted-foreground">{t('publicTools.cleanCore.emptyHint')}</p>
          </div>
        ) : query.data ? (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {t('publicTools.common.results', { count: query.data.results.length })}
              {query.data.snapshot ? ` · ${t('publicTools.common.snapshot', { seq: query.data.snapshot.seq })}` : ''}
            </p>
            <ul className="space-y-2">
              {query.data.results.map((r) => (
                <ResultRow key={r.id} item={r} />
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </section>
  );
}
