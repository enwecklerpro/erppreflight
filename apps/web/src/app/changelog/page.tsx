'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Calendar, Layers, RefreshCw, Sparkles } from 'lucide-react';
import { fetchChangelogs } from '../../lib/api-client';
import { useFmt, useLabel, useLocale, useT } from '../../i18n/client';

const CATEGORIES = ['ALL', 'PLATFORM', 'KNOWLEDGE_SNAPSHOT'] as const;
type Category = (typeof CATEGORIES)[number];

function Section({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5 pt-2">
      <h4 className={`text-xs font-bold uppercase tracking-wider ${tone}`}>{title}</h4>
      <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/90">
        {items.map((item, idx) => (
          <li key={idx}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export default function ChangelogPage() {
  const t = useT();
  const fmt = useFmt();
  const label = useLabel();
  const locale = useLocale();
  const [selectedCategory, setSelectedCategory] = useState<Category>('ALL');

  const { data: changelogs = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['changelog', selectedCategory, locale],
    queryFn: () => fetchChangelogs(selectedCategory === 'ALL' ? undefined : selectedCategory),
  });

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="border-b border-border pb-6 space-y-2">
        <span className="inline-block text-xs uppercase font-bold tracking-wider text-primary px-2 py-0.5 bg-primary/10 rounded">
          {t('app.changelog.badge')}
        </span>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">{t('app.changelog.title')}</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">{t('app.changelog.intro')}</p>
      </div>

      <div role="group" aria-label={t('app.changelog.filterLabel')} className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            aria-pressed={selectedCategory === cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              selectedCategory === cat ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {t(`app.changelog.categories.${cat}`)}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="space-y-6" role="status" aria-label={t('app.changelog.loading')}>
          {[1, 2].map((i) => (
            <div key={i} className="h-48 rounded-xl border border-border bg-card p-6 animate-pulse motion-reduce:animate-none" />
          ))}
        </div>
      )}

      {isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">{t('app.changelog.loadError')}</span>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 px-3 py-1.5 font-semibold hover:bg-destructive/10"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" /> {t('app.changelog.retry')}
          </button>
        </div>
      )}

      {!isLoading && !isError && changelogs.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t('app.changelog.empty')}</p>
      )}

      {changelogs.length > 0 && (
        <ol className="space-y-8 relative before:absolute before:inset-y-0 before:left-3.5 before:w-0.5 before:bg-border">
          {changelogs.map((item) => {
            const isKnowledge = item.category === 'KNOWLEDGE_SNAPSHOT';
            const date = new Date(item.releaseDate);
            return (
              <li key={item.id} className="relative pl-10">
                <div
                  aria-hidden="true"
                  className={`absolute left-0 top-1.5 h-7 w-7 rounded-full border-4 border-card flex items-center justify-center ${
                    isKnowledge ? 'bg-purple-600 text-white' : 'bg-primary text-white'
                  }`}
                >
                  {isKnowledge ? <Layers className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                </div>

                <article className="rounded-xl border border-border bg-card p-4 sm:p-6 space-y-4 shadow-sm">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-border/60 pb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                          isKnowledge
                            ? 'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                            : 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                        }`}
                      >
                        {item.version}
                      </span>
                      <span className="text-xs uppercase font-semibold text-muted-foreground">
                        {label('app.changelog.category', item.category)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                      <time dateTime={item.releaseDate}>{Number.isNaN(date.getTime()) ? item.releaseDate : fmt.date(date)}</time>
                    </div>
                  </div>

                  {/* Release notes arrive in the UI language (API Accept-Language). */}
                  <div>
                    <h2 className="text-lg font-bold text-foreground">{item.title}</h2>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{item.summary}</p>
                  </div>

                  <Section title={t('app.changelog.features')} items={item.features} tone="text-primary" />
                  <Section title={t('app.changelog.engineChanges')} items={item.engineChanges} tone="text-emerald-700 dark:text-emerald-400" />
                  <Section title={t('app.changelog.knowledgeUpdates')} items={item.knowledgeUpdates} tone="text-purple-700 dark:text-purple-400" />

                  {item.breakingChanges.length > 0 && (
                    <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/20 text-sm space-y-1 text-destructive">
                      <h4 className="flex items-center gap-1.5 font-bold">
                        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                        {t('app.changelog.breakingChanges')}
                      </h4>
                      <ul className="list-disc pl-5 space-y-0.5">
                        {item.breakingChanges.map((brk, idx) => (
                          <li key={idx}>{brk}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
