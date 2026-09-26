'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Boxes, CalendarCheck, Clock3, ListChecks } from 'lucide-react';
import { useFormatter, useLocale, useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/translate';
import { useDebouncedSearch } from '@/hooks/pacer';
import { fetchPublicSearch, toolKeys } from '@/lib/public-tools';
import { localizePath } from '@/lib/routing';
import { LocalizedState, ResultSkeleton, SearchField, ToolError, toolRetry, useUrlParam } from './client-common';

/** Renders "[[term]]" highlight markers from the API as <mark> — text only, never HTML. */
export function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(\[\[[^\]]*\]\])/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('[[') && p.endsWith(']]') ? (
          <mark key={i} className="rounded bg-amber-100 px-0.5 text-inherit dark:bg-amber-900/60">
            {p.slice(2, -2)}
          </mark>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        )
      )}
    </>
  );
}

function Group({ icon: Icon, title, count, children }: { icon: React.ComponentType<{ className?: string }>; title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="size-4" aria-hidden="true" /> {title} <span className="text-xs font-normal text-muted-foreground">({count})</span>
      </h2>
      {children}
    </section>
  );
}

/** Public knowledge & error search: reviewed articles, global SAP objects, engine finding codes. */
export function SearchTool() {
  const t = useT();
  const locale = useLocale();
  const format = useFormatter();
  const [q, setQ] = useUrlParam('q');
  const [term, setTerm] = React.useState(q);
  const { debouncedValue } = useDebouncedSearch(term.trim(), 350);
  React.useEffect(() => {
    if (debouncedValue !== q) setQ(debouncedValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedValue]);
  const enabled = debouncedValue.length >= 2;
  const query = useQuery({
    queryKey: toolKeys.search(debouncedValue, locale),
    queryFn: ({ signal }) => fetchPublicSearch(debouncedValue, locale, signal),
    enabled,
    staleTime: 60_000,
    retry: toolRetry,
  });
  const d = query.data;

  return (
    <section className="space-y-4" aria-label={t('publicTools.tools.search.name')}>
      <SearchField
        id="search-q"
        label={t('publicTools.search.label')}
        placeholder={t('publicTools.search.placeholder')}
        value={term}
        onChange={setTerm}
        busy={query.isFetching}
      />
      <div aria-live="polite" className="space-y-5">
        {!enabled ? (
          <p className="text-sm text-muted-foreground">{t('publicTools.search.hint')}</p>
        ) : query.isLoading ? (
          <ResultSkeleton rows={4} height="h-16" />
        ) : query.isError ? (
          <ToolError error={query.error} onRetry={() => query.refetch()} />
        ) : d ? (
          <>
            <Group icon={BookOpen} title={t('publicTools.search.articles')} count={d.articles.length}>
              {d.articles.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('publicTools.search.noArticles')}</p>
              ) : (
                <ul className="space-y-2" data-testid="search-articles">
                  {d.articles.map((a) => (
                    <li key={a.slug} className="rounded-lg border border-border bg-card p-3">
                      <Link href={localizePath(locale, `/knowledge/${a.slug}`)} className="font-semibold hover:text-primary">
                        {a.title}
                      </Link>
                      {a.updateRequired ? (
                        <span className="ml-2 inline-flex items-center gap-1 rounded border border-amber-300 px-1 text-[10px] text-amber-800 dark:text-amber-200">
                          <Clock3 className="size-3" aria-hidden="true" /> {t('publicTools.search.updateRequired')}
                        </span>
                      ) : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        <Highlighted text={a.snippet || a.summary} />
                      </p>
                      {a.reviewedAt ? (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                          <CalendarCheck className="size-3" aria-hidden="true" /> {t('common.lastReviewed')}:{' '}
                          {format.dateTime(new Date(a.reviewedAt), { dateStyle: 'medium' })}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Group>
            <Group icon={Boxes} title={t('publicTools.search.objects')} count={d.objects.length}>
              {d.objects.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('publicTools.search.noObjects')}</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2" data-testid="search-objects">
                  {d.objects.map((o) => {
                    const head = o.states.find((s) => s.scheme === 'RELEASE_CONTRACT' && s.editionCode === 'CLOUD_PRIVATE') ?? o.states[0];
                    return (
                      <li key={`${o.sapObjectType}-${o.objectKey}`} className="rounded-lg border border-border bg-card p-2 text-xs">
                        {o.slug ? (
                          <Link href={localizePath(locale, `/sap/clean-core/${o.slug}`)} className="font-mono font-semibold hover:text-primary">
                            {o.objectKey}
                          </Link>
                        ) : (
                          <span className="font-mono font-semibold">{o.objectKey}</span>
                        )}{' '}
                        <span className="text-muted-foreground">{o.sapObjectType}</span>
                        {head ? (
                          <span className="ml-1">
                            <LocalizedState state={head.supportState} />
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Group>
            <Group icon={ListChecks} title={t('publicTools.search.rules')} count={d.rules.length}>
              {!d.engineCatalogAvailable ? (
                <p className="text-xs text-muted-foreground">{t('publicTools.search.rulesUnavailable')}</p>
              ) : d.rules.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('publicTools.search.noRules')}</p>
              ) : (
                <ul className="space-y-1.5" data-testid="search-rules">
                  {d.rules.map((r) => (
                    <li key={r.code} className="text-xs">
                      <Link href={localizePath(locale, `/docs/engines/${r.engineType}`)} className="font-mono font-semibold hover:text-primary">
                        {r.code}
                      </Link>{' '}
                      — {r.title}{' '}
                      <span className="text-muted-foreground">
                        ({r.engineName} · {t(`publicTools.severity.${r.severity}` as MessageKey)})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Group>
          </>
        ) : null}
      </div>
    </section>
  );
}
