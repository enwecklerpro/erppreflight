'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Loader2, Pause, Play, Trash2 } from 'lucide-react';
import { KnowledgeGraphNav, QueryErrorState } from '@/components/knowledge-graph/kg-nav';
import { SupportStateBadge, isSupportState, useChangeLabel } from '@/components/knowledge-graph/badges';
import { useErrorText, useFmt, useLabel, useT } from '@/i18n/client';
import { deleteWatch, fetchWatchEvents, fetchWatches, kgKeys, updateWatch, type Watch } from '@/lib/knowledge-graph';

function WatchEvents({ id }: { id: string }) {
  const t = useT();
  const fmt = useFmt();
  const changeLabel = useChangeLabel();
  const events = useQuery({ queryKey: kgKeys.watchEvents(id), queryFn: ({ signal }) => fetchWatchEvents(id, signal) });
  if (events.isLoading) return <div className="h-16 animate-pulse rounded bg-muted/40 motion-reduce:animate-none" aria-busy="true" />;
  if (events.isError) return <QueryErrorState error={events.error} onRetry={() => events.refetch()} title={t('app.kg.error.watchEvents')} />;
  if (!events.data || events.data.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('app.kg.watches.noEvents')}</p>;
  }
  return (
    <ul className="space-y-1">
      {events.data.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold">{changeLabel(e.eventType)}</span>
          <span className="font-mono">{e.objectKey}</span>
          <span className="text-muted-foreground">{e.releaseLabel}</span>
          {e.previous && isSupportState(e.previous.supportState) ? <SupportStateBadge state={e.previous.supportState} /> : <span className="text-muted-foreground">{t('app.kg.watches.notListed')}</span>}
          <span aria-hidden="true">→</span>
          <span className="sr-only">{t('app.kg.watches.changedTo')}</span>
          {e.current && isSupportState(e.current.supportState) ? <SupportStateBadge state={e.current.supportState} /> : <span className="text-muted-foreground">{t('app.kg.watches.notListed')}</span>}
          {e.eventType === 'SUCCESSOR_CHANGED' ? (
            <span className="font-mono text-[11px]">
              {(e.previous?.successors ?? []).join(', ') || '—'} → {(e.current?.successors ?? []).join(', ') || '—'}
            </span>
          ) : null}
          <span className="text-muted-foreground">{t('app.kg.watches.eventMeta', { seq: e.snapshotSeq, date: fmt.dateTime(e.createdAt) })}</span>
        </li>
      ))}
    </ul>
  );
}

function WatchCard({ w, highlighted }: { w: Watch; highlighted: boolean }) {
  const t = useT();
  const fmt = useFmt();
  const label = useLabel();
  const errText = useErrorText();
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => updateWatch(w.id, { status: w.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: kgKeys.watches }),
  });
  const remove = useMutation({
    mutationFn: () => deleteWatch(w.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: kgKeys.watches }),
  });
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  return (
    <li id={`watch-${w.id}`} className={`rounded-xl border bg-card p-4 ${highlighted ? 'border-primary ring-2 ring-primary/30' : 'border-border'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{w.label}</h2>
          <p className="text-xs text-muted-foreground">
            {label('app.kg.watches.type', w.watchType)} · {w.releaseLabel ?? t('app.kg.watches.allReleases')} · {t('app.kg.watches.targets')}{' '}
            {w.targets.map((t) => (
              <Link key={t.id} href={`/knowledge-graph/objects/${t.id}`} className="mr-1 font-mono text-primary hover:underline">
                {t.objectKey}
              </Link>
            ))}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('app.kg.watches.status')} <span className="font-medium">{w.status === 'ACTIVE' ? t('app.kg.watches.active') : t('app.kg.watches.paused')}</span> ·{' '}
            {t('app.kg.watches.baseline', { states: w.baselineSupportStates.join(', ') || t('app.kg.watches.noState') })} ·{' '}
            {t('app.kg.watches.events', { count: w.eventCount })}
            {w.lastEvaluatedAt ? ` · ${t('app.kg.watches.evaluated', { date: fmt.dateTime(w.lastEvaluatedAt) })}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => toggle.mutate()}
            disabled={toggle.isPending}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
          >
            {toggle.isPending ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : w.status === 'ACTIVE' ? <Pause className="size-3" aria-hidden="true" /> : <Play className="size-3" aria-hidden="true" />}
            {w.status === 'ACTIVE' ? t('app.kg.watches.pause') : t('app.kg.watches.resume')}
          </button>
          {confirmDelete ? (
            <>
              <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending} className="rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                {remove.isPending ? t('app.kg.watches.deleting') : t('app.kg.watches.confirmDelete')}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-md border border-border px-2 py-1 text-xs">
                {t('app.ui.cancel')}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
              <Trash2 className="size-3" aria-hidden="true" /> {t('app.kg.watches.delete')}
            </button>
          )}
        </div>
      </div>
      {toggle.isError || remove.isError ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {errText(toggle.error ?? remove.error, t('app.kg.watches.actionFailed'))}
        </p>
      ) : null}
      <div className="mt-3 border-t border-border pt-2">
        <WatchEvents id={w.id} />
      </div>
    </li>
  );
}

function WatchesContent() {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const focus = params.get('watch');
  const watches = useQuery({ queryKey: kgKeys.watches, queryFn: ({ signal }) => fetchWatches(signal) });
  return watches.isLoading ? (
    <ul className="space-y-3" aria-busy="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i} className="h-32 animate-pulse rounded-xl bg-muted/50 motion-reduce:animate-none" />
      ))}
    </ul>
  ) : watches.isError ? (
    <QueryErrorState error={watches.error} onRetry={() => watches.refetch()} title={t('app.kg.error.watches')} />
  ) : watches.data && watches.data.length === 0 ? (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-10 text-center">
      <Eye className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">{t('app.kg.watches.emptyTitle')}</p>
      <p className="max-w-md text-sm text-muted-foreground">{t('app.kg.watches.emptyBody')}</p>
      <button type="button" onClick={() => router.push('/knowledge-graph')} className="mt-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
        {t('app.kg.watches.find')}
      </button>
    </div>
  ) : (
    <ul className="space-y-3">
      {watches.data?.map((w) => (
        <WatchCard key={w.id} w={w} highlighted={focus === w.id} />
      ))}
    </ul>
  );
}

export default function WatchesPage() {
  const t = useT();
  return (
    <div className="space-y-6">
      <KnowledgeGraphNav />
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Eye className="size-6 text-primary" aria-hidden="true" /> {t('app.kg.watches.title')}
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t('app.kg.watches.intro')}</p>
      </header>
      <Suspense fallback={<div className="h-32 animate-pulse rounded-xl bg-muted/50" />}>
        <WatchesContent />
      </Suspense>
    </div>
  );
}
