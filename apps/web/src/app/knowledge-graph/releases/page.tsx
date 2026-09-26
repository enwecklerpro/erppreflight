'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { GitCompareArrows, History, Package } from 'lucide-react';
import { KnowledgeGraphNav, QueryErrorState } from '@/components/knowledge-graph/kg-nav';
import { SupportStateBadge, TrustLevelBadge, isSupportState, useChangeLabel } from '@/components/knowledge-graph/badges';
import { useFmt, useT } from '@/i18n/client';
import {
  fetchCatalog,
  fetchReleaseDiff,
  fetchSnapshotDiff,
  fetchSnapshots,
  kgKeys,
  type DiffPage,
} from '@/lib/knowledge-graph';

function DiffTable({ page, caption }: { page: DiffPage; caption: string }) {
  const t = useT();
  const changeLabel = useChangeLabel();
  if (page.items.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">{t('app.kg.releases.noDiff')}</p>;
  }
  const state = (s: { supportState: string } | null) => {
    if (!s) return <span className="text-muted-foreground">{t('app.kg.releases.notListed')}</span>;
    return isSupportState(s.supportState) ? <SupportStateBadge state={s.supportState} /> : s.supportState;
  };
  const succ = (s: { successors?: unknown } | null) =>
    s && Array.isArray(s.successors) && s.successors.length > 0
      ? (s.successors as Array<{ objectKey?: string }>).map((x) => x.objectKey).filter(Boolean).join(', ')
      : '—';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/60 text-left">
          <tr>
            <th scope="col" className="px-3 py-2">{t('app.kg.releases.colObject')}</th>
            <th scope="col" className="px-3 py-2">{t('app.kg.releases.colChange')}</th>
            <th scope="col" className="px-3 py-2">{t('app.kg.releases.colBefore')}</th>
            <th scope="col" className="px-3 py-2">{t('app.kg.releases.colAfter')}</th>
            <th scope="col" className="px-3 py-2">{t('app.kg.releases.colSuccessor')}</th>
          </tr>
        </thead>
        <tbody>
          {page.items.map((i, idx) => (
            <tr key={`${i.objectId}-${idx}`} className="border-t border-border align-top">
              <td className="px-3 py-1.5">
                <Link href={`/knowledge-graph/objects/${i.objectId}`} className="font-mono text-primary hover:underline">
                  {i.objectKey}
                </Link>{' '}
                <span className="text-[10px] text-muted-foreground">{i.sapObjectType}</span>
                {i.releaseLabel ? <div className="text-[10px] text-muted-foreground">{i.releaseLabel}</div> : null}
              </td>
              <td className="px-3 py-1.5 font-medium">{changeLabel(i.changeType)}</td>
              <td className="px-3 py-1.5">{state(i.previous)}</td>
              <td className="px-3 py-1.5">{state(i.current)}</td>
              <td className="px-3 py-1.5 font-mono text-[11px]">
                {succ(i.previous)} → {succ(i.current)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryChips({ summary, value, onChange }: { summary: Record<string, number>; value: string; onChange: (v: string) => void }) {
  const t = useT();
  const fmt = useFmt();
  const changeLabel = useChangeLabel();
  const nf = { format: (n: number) => fmt.number(n) };
  const entries = Object.entries(summary).sort((a, b) => b[1] - a[1]);
  return (
    <div role="group" aria-label={t('app.kg.releases.filterLabel')} className="flex flex-wrap gap-1.5">
      <button
        type="button"
        aria-pressed={value === ''}
        onClick={() => onChange('')}
        className={`rounded-full border px-2.5 py-0.5 text-xs ${value === '' ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}
      >
        {t('app.kg.releases.all', { count: nf.format(entries.reduce((a, [, n]) => a + n, 0)) })}
      </button>
      {entries.map(([k, n]) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          onClick={() => onChange(k)}
          className={`rounded-full border px-2.5 py-0.5 text-xs ${value === k ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}
        >
          {changeLabel(k)} ({nf.format(n)})
        </button>
      ))}
    </div>
  );
}

function Pager({ offset, total, onChange }: { offset: number; total: number; onChange: (o: number) => void }) {
  const t = useT();
  const fmt = useFmt();
  return (
    <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
      <span>
        {t('app.kg.releases.range', { from: total === 0 ? 0 : offset + 1, to: Math.min(offset + 50, total), total: fmt.number(total) })}
      </span>
      <div className="flex gap-1">
        <button type="button" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - 50))} className="rounded border border-border px-2 py-0.5 disabled:opacity-40">
          {t('app.kg.releases.previous')}
        </button>
        <button type="button" disabled={offset + 50 >= total} onClick={() => onChange(offset + 50)} className="rounded border border-border px-2 py-0.5 disabled:opacity-40">
          {t('app.kg.releases.next')}
        </button>
      </div>
    </div>
  );
}

export default function ReleasesPage() {
  const t = useT();
  const fmt = useFmt();
  const nf = { format: (n: number) => fmt.number(n) };
  const catalog = useQuery({ queryKey: kgKeys.catalog, queryFn: ({ signal }) => fetchCatalog(signal) });
  const snapshots = useQuery({ queryKey: kgKeys.snapshots, queryFn: ({ signal }) => fetchSnapshots(signal) });

  const releases = useMemo(
    () =>
      catalog.data?.products.flatMap((p) =>
        p.editions.flatMap((e) => e.releases.map((r) => ({ id: r.id, label: `${e.name} — ${r.label}`, edition: e.code })))
      ) ?? [],
    [catalog.data]
  );
  const [fromRelease, setFrom] = useState('');
  const [toRelease, setTo] = useState('');
  const [changeType, setChangeType] = useState('');
  const [offset, setOffset] = useState(0);
  const from = fromRelease || releases.find((r) => r.label.includes('2023 FPS03'))?.id || releases[1]?.id || '';
  const to = toRelease || releases.find((r) => r.label.includes('2025 FPS01'))?.id || releases[0]?.id || '';

  const diff = useQuery({
    queryKey: kgKeys.releaseDiff({ from, to, changeType, offset }),
    queryFn: ({ signal }) => fetchReleaseDiff({ fromRelease: from, toRelease: to, changeType: changeType || undefined, offset }, signal),
    enabled: Boolean(from && to && from !== to),
    placeholderData: keepPreviousData,
  });

  const [snapSeq, setSnapSeq] = useState<number | null>(null);
  const [snapType, setSnapType] = useState('');
  const [snapOffset, setSnapOffset] = useState(0);
  const snapList = snapshots.data ?? [];
  const selected = snapSeq ?? snapList[0]?.seq ?? null;
  const prevSeq = selected !== null ? snapList.find((s) => s.seq < selected)?.seq ?? 0 : null;
  const snapDiff = useQuery({
    queryKey: kgKeys.snapshotDiff({ selected, prevSeq, snapType, snapOffset }),
    queryFn: ({ signal }) => fetchSnapshotDiff({ from: prevSeq ?? 0, to: selected ?? 1, changeType: snapType || undefined, offset: snapOffset }, signal),
    enabled: selected !== null && prevSeq !== null && prevSeq > 0,
    placeholderData: keepPreviousData,
  });

  return (
    <div className="min-w-0 space-y-8">
      <KnowledgeGraphNav />
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <GitCompareArrows className="size-6 text-primary" aria-hidden="true" /> {t('app.kg.releases.title')}
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t('app.kg.releases.intro')}</p>
      </header>

      <section aria-labelledby="catalog-title" className="space-y-3">
        <h2 id="catalog-title" className="flex items-center gap-1.5 text-base font-semibold">
          <Package className="size-4" aria-hidden="true" /> {t('app.kg.releases.catalog')}
        </h2>
        {catalog.isLoading ? (
          <div className="grid gap-3 md:grid-cols-3" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-48 animate-pulse rounded-xl bg-muted/50 motion-reduce:animate-none" />
            ))}
          </div>
        ) : catalog.isError ? (
          <QueryErrorState error={catalog.error} onRetry={() => catalog.refetch()} title={t('app.kg.error.catalog')} />
        ) : catalog.data && catalog.data.products.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            {t('app.kg.releases.noSnapshot')}
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {catalog.data?.products.flatMap((p) =>
              p.editions.map((e) => (
                <div key={`${p.code}-${e.code}`} className="rounded-xl border border-border bg-card p-3">
                  <h3 className="text-sm font-semibold">{e.name}</h3>
                  <p className="text-[11px] text-muted-foreground">{p.name}</p>
                  <ul className="mt-2 space-y-1 text-xs">
                    {e.releases.map((r) => {
                      const c = r.counts.RELEASE_CONTRACT ?? {};
                      const classic = r.counts.CLASSIC_API_CLASSIFICATION ?? {};
                      return (
                        <li key={r.id} className="flex flex-wrap items-center justify-between gap-1 border-t border-border/60 pt-1">
                          <span className="font-medium">{r.label}</span>
                          <span className="text-muted-foreground">
                            {t('app.kg.releases.counts', {
                              released: nf.format(c.RELEASED ?? 0),
                              deprecated: nf.format(c.DEPRECATED ?? 0),
                              notReleased: nf.format((c.NOT_RELEASED ?? 0) + (c.NOT_TO_BE_RELEASED_STABLE ?? 0)),
                            })}
                            {classic.CLASSIC_API ? t('app.kg.releases.classicCount', { count: nf.format(classic.CLASSIC_API) }) : ''}
                          </span>
                          {r.sources[0] ? <TrustLevelBadge level={r.sources[0].trustLevel} /> : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="diff-title" className="space-y-3">
        <h2 id="diff-title" className="text-base font-semibold">
          {t('app.kg.releases.compare')}
        </h2>
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
            <span className="text-muted-foreground">{t('app.kg.releases.from')}</span>
            <select value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} className="w-full max-w-full rounded-md border border-input bg-background px-2 py-1.5 sm:max-w-xs">
              {releases.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </label>
          <label className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
            <span className="text-muted-foreground">{t('app.kg.releases.to')}</span>
            <select value={to} onChange={(e) => { setTo(e.target.value); setOffset(0); }} className="w-full max-w-full rounded-md border border-input bg-background px-2 py-1.5 sm:max-w-xs">
              {releases.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </label>
        </div>
        {from === to && from ? <p className="text-xs text-muted-foreground">{t('app.kg.releases.sameRelease')}</p> : null}
        {diff.isError ? (
          <QueryErrorState error={diff.error} onRetry={() => diff.refetch()} title={t('app.kg.error.releaseDiff')} />
        ) : diff.isLoading ? (
          <div className="h-64 animate-pulse rounded-xl bg-muted/50 motion-reduce:animate-none" aria-busy="true" />
        ) : diff.data ? (
          <div className="space-y-2">
            <SummaryChips summary={diff.data.summary} value={changeType} onChange={(v) => { setChangeType(v); setOffset(0); }} />
            <div className={`min-w-0 overflow-hidden rounded-xl border border-border ${diff.isFetching ? 'opacity-70' : ''}`}>
              <DiffTable page={diff.data} caption={t('app.kg.releases.diffCaption')} />
              <Pager offset={offset} total={diff.data.total} onChange={setOffset} />
            </div>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="snap-title" className="space-y-3">
        <h2 id="snap-title" className="flex items-center gap-1.5 text-base font-semibold">
          <History className="size-4" aria-hidden="true" /> {t('app.kg.releases.snapshots')}
        </h2>
        {snapshots.isLoading ? (
          <div className="h-24 animate-pulse rounded-xl bg-muted/50 motion-reduce:animate-none" aria-busy="true" />
        ) : snapshots.isError ? (
          <QueryErrorState error={snapshots.error} onRetry={() => snapshots.refetch()} title={t('app.kg.error.snapshots')} />
        ) : snapList.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('app.kg.releases.noSnapshots')}</p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-2">
              {snapList.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-pressed={selected === s.seq}
                    onClick={() => { setSnapSeq(s.seq); setSnapOffset(0); setSnapType(''); }}
                    className={`rounded-lg border px-3 py-1.5 text-left text-xs ${selected === s.seq ? 'border-primary bg-primary/5' : 'border-border'}`}
                  >
                    <span className="font-semibold">#{s.seq}</span> · {fmt.dateTime(s.publishedAt)}
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {s.contentSha256.slice(0, 16)}… · {t('app.kg.releases.sources', { count: s.sourceVersions.length })}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            {prevSeq === 0 ? (
              <p className="text-sm text-muted-foreground">{t('app.kg.releases.initial', { seq: selected ?? 0 })}</p>
            ) : snapDiff.isError ? (
              <QueryErrorState error={snapDiff.error} onRetry={() => snapDiff.refetch()} title={t('app.kg.error.snapshotDiff')} />
            ) : snapDiff.data ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{t('app.kg.releases.snapshotChanges', { from: prevSeq ?? 0, to: selected ?? 0 })}</p>
                <SummaryChips summary={snapDiff.data.summary} value={snapType} onChange={(v) => { setSnapType(v); setSnapOffset(0); }} />
                <div className="rounded-xl border border-border">
                  <DiffTable page={snapDiff.data} caption={t('app.kg.releases.snapshotCaption')} />
                  <Pager offset={snapOffset} total={snapDiff.data.total} onChange={setSnapOffset} />
                </div>
              </div>
            ) : (
              <div className="h-24 animate-pulse rounded-xl bg-muted/50 motion-reduce:animate-none" aria-busy="true" />
            )}
          </>
        )}
      </section>
    </div>
  );
}
