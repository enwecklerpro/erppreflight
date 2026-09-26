'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { GitCompareArrows, History, Package } from 'lucide-react';
import { KnowledgeGraphNav, QueryErrorState } from '@/components/knowledge-graph/kg-nav';
import { CHANGE_LABELS, SupportStateBadge, TrustLevelBadge, isSupportState } from '@/components/knowledge-graph/badges';
import {
  fetchCatalog,
  fetchReleaseDiff,
  fetchSnapshotDiff,
  fetchSnapshots,
  kgKeys,
  type DiffPage,
} from '@/lib/knowledge-graph';

const nf = new Intl.NumberFormat('en');

function DiffTable({ page, caption }: { page: DiffPage; caption: string }) {
  if (page.items.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No differences for this selection.</p>;
  }
  const state = (s: { supportState: string } | null) =>
    s ? isSupportState(s.supportState) ? <SupportStateBadge state={s.supportState} /> : s.supportState : <span className="text-muted-foreground">not listed</span>;
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
            <th scope="col" className="px-3 py-2">Object</th>
            <th scope="col" className="px-3 py-2">Change</th>
            <th scope="col" className="px-3 py-2">Before</th>
            <th scope="col" className="px-3 py-2">After</th>
            <th scope="col" className="px-3 py-2">Successor before → after</th>
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
              <td className="px-3 py-1.5 font-medium">{CHANGE_LABELS[i.changeType] ?? i.changeType}</td>
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
  const entries = Object.entries(summary).sort((a, b) => b[1] - a[1]);
  return (
    <div role="group" aria-label="Filter by change type" className="flex flex-wrap gap-1.5">
      <button
        type="button"
        aria-pressed={value === ''}
        onClick={() => onChange('')}
        className={`rounded-full border px-2.5 py-0.5 text-xs ${value === '' ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}
      >
        All ({nf.format(entries.reduce((a, [, n]) => a + n, 0))})
      </button>
      {entries.map(([k, n]) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          onClick={() => onChange(k)}
          className={`rounded-full border px-2.5 py-0.5 text-xs ${value === k ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}
        >
          {CHANGE_LABELS[k] ?? k} ({nf.format(n)})
        </button>
      ))}
    </div>
  );
}

function Pager({ offset, total, onChange }: { offset: number; total: number; onChange: (o: number) => void }) {
  return (
    <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
      <span>
        {total === 0 ? 0 : offset + 1}–{Math.min(offset + 50, total)} of {nf.format(total)}
      </span>
      <div className="flex gap-1">
        <button type="button" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - 50))} className="rounded border border-border px-2 py-0.5 disabled:opacity-40">
          Previous
        </button>
        <button type="button" disabled={offset + 50 >= total} onClick={() => onChange(offset + 50)} className="rounded border border-border px-2 py-0.5 disabled:opacity-40">
          Next
        </button>
      </div>
    </div>
  );
}

export default function ReleasesPage() {
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
    <div className="space-y-8">
      <KnowledgeGraphNav />
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <GitCompareArrows className="size-6 text-primary" aria-hidden="true" /> Release intelligence
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Release catalog, release-to-release comparison of released objects and what changed in each knowledge snapshot.
        </p>
      </header>

      <section aria-labelledby="catalog-title" className="space-y-3">
        <h2 id="catalog-title" className="flex items-center gap-1.5 text-base font-semibold">
          <Package className="size-4" aria-hidden="true" /> Release catalog
        </h2>
        {catalog.isLoading ? (
          <div className="grid gap-3 md:grid-cols-3" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-48 animate-pulse rounded-xl bg-muted/50 motion-reduce:animate-none" />
            ))}
          </div>
        ) : catalog.isError ? (
          <QueryErrorState error={catalog.error} onRetry={() => catalog.refetch()} what="the release catalog" />
        ) : catalog.data && catalog.data.products.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            No knowledge snapshot has been published yet. A super admin can run the Cloudification Repository sync.
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
                            {nf.format(c.RELEASED ?? 0)} released · {nf.format(c.DEPRECATED ?? 0)} deprecated · {nf.format((c.NOT_RELEASED ?? 0) + (c.NOT_TO_BE_RELEASED_STABLE ?? 0))} not released
                            {classic.CLASSIC_API ? ` · ${nf.format(classic.CLASSIC_API)} classic APIs` : ''}
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
          Compare releases
        </h2>
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">From</span>
            <select value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} className="rounded-md border border-input bg-background px-2 py-1.5">
              {releases.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">To</span>
            <select value={to} onChange={(e) => { setTo(e.target.value); setOffset(0); }} className="rounded-md border border-input bg-background px-2 py-1.5">
              {releases.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </label>
        </div>
        {from === to && from ? <p className="text-xs text-muted-foreground">Choose two different releases.</p> : null}
        {diff.isError ? (
          <QueryErrorState error={diff.error} onRetry={() => diff.refetch()} what="the release comparison" />
        ) : diff.isLoading ? (
          <div className="h-64 animate-pulse rounded-xl bg-muted/50 motion-reduce:animate-none" aria-busy="true" />
        ) : diff.data ? (
          <div className="space-y-2">
            <SummaryChips summary={diff.data.summary} value={changeType} onChange={(v) => { setChangeType(v); setOffset(0); }} />
            <div className={`rounded-xl border border-border ${diff.isFetching ? 'opacity-70' : ''}`}>
              <DiffTable page={diff.data} caption="Differences between the selected releases" />
              <Pager offset={offset} total={diff.data.total} onChange={setOffset} />
            </div>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="snap-title" className="space-y-3">
        <h2 id="snap-title" className="flex items-center gap-1.5 text-base font-semibold">
          <History className="size-4" aria-hidden="true" /> Knowledge snapshots
        </h2>
        {snapshots.isLoading ? (
          <div className="h-24 animate-pulse rounded-xl bg-muted/50 motion-reduce:animate-none" aria-busy="true" />
        ) : snapshots.isError ? (
          <QueryErrorState error={snapshots.error} onRetry={() => snapshots.refetch()} what="knowledge snapshots" />
        ) : snapList.length === 0 ? (
          <p className="text-sm text-muted-foreground">No snapshot published yet.</p>
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
                    <span className="font-semibold">#{s.seq}</span> · {s.publishedAt ? new Date(s.publishedAt).toLocaleString() : '—'}
                    <div className="font-mono text-[10px] text-muted-foreground">{s.contentSha256.slice(0, 16)}… · {s.sourceVersions.length} sources</div>
                  </button>
                </li>
              ))}
            </ul>
            {prevSeq === 0 ? (
              <p className="text-sm text-muted-foreground">Snapshot #{selected} is the initial load; there is no previous snapshot to compare with.</p>
            ) : snapDiff.isError ? (
              <QueryErrorState error={snapDiff.error} onRetry={() => snapDiff.refetch()} what="the snapshot comparison" />
            ) : snapDiff.data ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Changes from snapshot #{prevSeq} to #{selected}</p>
                <SummaryChips summary={snapDiff.data.summary} value={snapType} onChange={(v) => { setSnapType(v); setSnapOffset(0); }} />
                <div className="rounded-xl border border-border">
                  <DiffTable page={snapDiff.data} caption="Changes between knowledge snapshots" />
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
