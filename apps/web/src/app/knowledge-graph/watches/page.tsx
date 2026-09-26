'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Loader2, Pause, Play, Trash2 } from 'lucide-react';
import { KnowledgeGraphNav, QueryErrorState } from '@/components/knowledge-graph/kg-nav';
import { CHANGE_LABELS, SupportStateBadge, isSupportState } from '@/components/knowledge-graph/badges';
import { deleteWatch, fetchWatchEvents, fetchWatches, kgKeys, updateWatch, type Watch } from '@/lib/knowledge-graph';

function WatchEvents({ id }: { id: string }) {
  const events = useQuery({ queryKey: kgKeys.watchEvents(id), queryFn: ({ signal }) => fetchWatchEvents(id, signal) });
  if (events.isLoading) return <div className="h-16 animate-pulse rounded bg-muted/40 motion-reduce:animate-none" aria-busy="true" />;
  if (events.isError) return <QueryErrorState error={events.error} onRetry={() => events.refetch()} what="watch events" />;
  if (!events.data || events.data.length === 0) {
    return <p className="text-xs text-muted-foreground">No change detected since the watch was created. You will be notified after the next knowledge sync that affects it.</p>;
  }
  return (
    <ul className="space-y-1">
      {events.data.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold">{CHANGE_LABELS[e.eventType] ?? e.eventType}</span>
          <span className="font-mono">{e.objectKey}</span>
          <span className="text-muted-foreground">{e.releaseLabel}</span>
          {e.previous && isSupportState(e.previous.supportState) ? <SupportStateBadge state={e.previous.supportState} /> : <span className="text-muted-foreground">not listed</span>}
          <span aria-hidden="true">→</span>
          <span className="sr-only">changed to</span>
          {e.current && isSupportState(e.current.supportState) ? <SupportStateBadge state={e.current.supportState} /> : <span className="text-muted-foreground">not listed</span>}
          {e.eventType === 'SUCCESSOR_CHANGED' ? (
            <span className="font-mono text-[11px]">
              {(e.previous?.successors ?? []).join(', ') || '—'} → {(e.current?.successors ?? []).join(', ') || '—'}
            </span>
          ) : null}
          <span className="text-muted-foreground">snapshot #{e.snapshotSeq} · {new Date(e.createdAt).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

function WatchCard({ w, highlighted }: { w: Watch; highlighted: boolean }) {
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
            {w.watchType.replace(/_/g, ' ').toLowerCase()} · {w.releaseLabel ?? 'all releases'} · targets:{' '}
            {w.targets.map((t) => (
              <Link key={t.id} href={`/knowledge-graph/objects/${t.id}`} className="mr-1 font-mono text-primary hover:underline">
                {t.objectKey}
              </Link>
            ))}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Status: <span className="font-medium">{w.status === 'ACTIVE' ? 'Active' : 'Paused'}</span> · baseline {w.baselineSupportStates.join(', ') || 'no state'} ·{' '}
            {w.eventCount} event{w.eventCount === 1 ? '' : 's'}
            {w.lastEvaluatedAt ? ` · evaluated ${new Date(w.lastEvaluatedAt).toLocaleString()}` : ''}
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
            {w.status === 'ACTIVE' ? 'Pause' : 'Resume'}
          </button>
          {confirmDelete ? (
            <>
              <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending} className="rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                {remove.isPending ? 'Deleting…' : 'Confirm delete'}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-md border border-border px-2 py-1 text-xs">
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
              <Trash2 className="size-3" aria-hidden="true" /> Delete
            </button>
          )}
        </div>
      </div>
      {toggle.isError || remove.isError ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {((toggle.error ?? remove.error) as Error)?.message ?? 'Action failed'}
        </p>
      ) : null}
      <div className="mt-3 border-t border-border pt-2">
        <WatchEvents id={w.id} />
      </div>
    </li>
  );
}

function WatchesContent() {
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
    <QueryErrorState error={watches.error} onRetry={() => watches.refetch()} what="release watches" />
  ) : watches.data && watches.data.length === 0 ? (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-10 text-center">
      <Eye className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">You are not watching any SAP object yet.</p>
      <p className="max-w-md text-xs text-muted-foreground">
        Open an object in the explorer and create a watch to be notified when a gap closes, an API is deprecated or a
        successor changes.
      </p>
      <button type="button" onClick={() => router.push('/knowledge-graph')} className="mt-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
        Find an object to watch
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
  return (
    <div className="space-y-6">
      <KnowledgeGraphNav />
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Eye className="size-6 text-primary" aria-hidden="true" /> Release watches
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Watches are re-evaluated after every knowledge sync. Changes are delivered as in-app notifications, signed
          webhooks and (when configured) e-mail.
        </p>
      </header>
      <Suspense fallback={<div className="h-32 animate-pulse rounded-xl bg-muted/50" />}>
        <WatchesContent />
      </Suspense>
    </div>
  );
}
