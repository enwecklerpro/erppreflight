'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Info, SearchX } from 'lucide-react';
import { useLocale, useT } from '@/i18n/client';
import { useDebouncedSearch } from '@/hooks/pacer';
import { fetchSuccessors, toolKeys, type DescribedObject } from '@/lib/public-tools';
import { localizePath } from '@/lib/routing';
import { ResultSkeleton, SearchField, ToolError, toolRetry, useUrlParam } from './client-common';
import { ReleaseTable, VerdictBanner } from './verdict';

function ObjectCard({ o }: { o: DescribedObject }) {
  const t = useT();
  const locale = useLocale();
  return (
    <li className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="successor-result">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-lg font-bold break-all">{o.objectKey}</h2>
        <span className="text-xs text-muted-foreground">
          {o.sapObjectType} · {o.objectType.replace(/_/g, ' ').toLowerCase()}
          {o.applicationComponent ? ` · ${o.applicationComponent}` : ''}
        </span>
      </div>
      <VerdictBanner verdict={o.verdict} headline={o.headline} t={t} />
      {o.releases.length > 0 ? (
        <details open={o.releases.length <= 4}>
          <summary className="cursor-pointer text-sm font-semibold">{t('publicTools.successor.releaseTable')}</summary>
          <div className="mt-2">
            <ReleaseTable releases={o.releases} t={t} locale={locale} caption={t('publicTools.successor.releaseTable')} />
          </div>
        </details>
      ) : null}
      {o.headline ? (
        <p className="text-[11px] text-muted-foreground">
          {t('publicTools.common.evidenceFrom', { source: o.headline.evidence.title })}
        </p>
      ) : null}
      {o.slug ? (
        <Link
          href={localizePath(locale, `/sap/${o.verdict === 'SUCCESSOR_AVAILABLE' || o.verdict === 'CONCEPT_AVAILABLE' ? 'cloud/migration' : 'clean-core'}/${o.slug}`)}
          className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
        >
          {t('publicTools.common.openObjectPage')} <ExternalLink className="size-3.5" aria-hidden="true" />
        </Link>
      ) : null}
    </li>
  );
}

/** Legacy object / transaction → cloud successor (official successor per release; never guessed). */
export function SuccessorTool() {
  const t = useT();
  const [q, setQ] = useUrlParam('q');
  const [term, setTerm] = React.useState(q);
  const { debouncedValue } = useDebouncedSearch(term.trim(), 350);
  React.useEffect(() => {
    if (debouncedValue !== q) setQ(debouncedValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedValue]);

  const query = useQuery({
    queryKey: toolKeys.successors(debouncedValue),
    queryFn: ({ signal }) => fetchSuccessors(debouncedValue, signal),
    enabled: debouncedValue.length > 0,
    staleTime: 60_000,
    retry: toolRetry,
  });

  return (
    <section className="space-y-4" aria-label={t('publicTools.tools.cloud-successor.name')}>
      <SearchField
        id="successor-q"
        label={t('publicTools.successor.label')}
        placeholder={t('publicTools.successor.placeholder')}
        value={term}
        onChange={setTerm}
        busy={query.isFetching}
      />
      <div aria-live="polite" className="space-y-3">
        {!debouncedValue ? (
          <p className="text-sm text-muted-foreground">{t('publicTools.successor.hint')}</p>
        ) : query.isLoading ? (
          <ResultSkeleton rows={2} height="h-40" />
        ) : query.isError ? (
          <ToolError error={query.error} onRetry={() => query.refetch()} />
        ) : query.data ? (
          <>
            {query.data.results.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center" data-testid="tool-empty">
                <SearchX className="size-6 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm font-medium">{t('publicTools.common.notFoundQuery', { query: debouncedValue })}</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {query.data.results.map((o) => (
                  <ObjectCard key={`${o.sapObjectType}-${o.objectKey}`} o={o} />
                ))}
              </ul>
            )}
            {query.data.coverage.transactionCodes === 0 ? (
              <p className="flex gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground" data-testid="tcode-coverage">
                <Info className="size-4 shrink-0" aria-hidden="true" />
                {t('publicTools.successor.tcodeCoverage')}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
