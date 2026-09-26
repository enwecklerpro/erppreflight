'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { KnowledgeGraphNav, QueryErrorState } from '@/components/knowledge-graph/kg-nav';
import { ObjectDetailView } from '@/components/knowledge-graph/object-detail';
import { ObjectGraph } from '@/components/knowledge-graph/object-graph';
import { CreateWatchForm } from '@/components/knowledge-graph/create-watch-form';
import { fetchNeighborhood, fetchObjectDetail, kgKeys } from '@/lib/knowledge-graph';
import { useT } from '@/i18n/client';

function DetailSkeleton() {
  const t = useT();
  return (
    <div className="space-y-4" aria-busy="true" aria-label={t('app.kg.detail.loading')}>
      <div className="h-5 w-48 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      <div className="h-8 w-72 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      <div className="h-64 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" />
    </div>
  );
}

export default function KnowledgeObjectPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const [depth, setDepth] = useState(1);
  const detail = useQuery({ queryKey: kgKeys.object(id), queryFn: ({ signal }) => fetchObjectDetail(id, signal) });
  const graph = useQuery({
    queryKey: kgKeys.neighborhood(id, depth),
    queryFn: ({ signal }) => fetchNeighborhood(id, depth, signal),
    enabled: detail.isSuccess,
  });

  const notReleased = detail.data?.states.some((s) => s.scheme === 'RELEASE_CONTRACT' && s.supportState !== 'RELEASED');

  return (
    <div className="space-y-6">
      <KnowledgeGraphNav />
      {detail.isLoading ? (
        <DetailSkeleton />
      ) : detail.isError ? (
        <QueryErrorState error={detail.error} onRetry={() => detail.refetch()} title={t('app.kg.error.object')} />
      ) : detail.data ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-6">
            <ObjectDetailView detail={detail.data} mode="app" />
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <label htmlFor="kg-depth" className="text-muted-foreground">
                  {t('app.kg.detail.depth')}
                </label>
                <select
                  id="kg-depth"
                  value={depth}
                  onChange={(e) => setDepth(Number(e.target.value))}
                  className="rounded-md border border-input bg-background px-2 py-1"
                >
                  {[1, 2, 3].map((d) => (
                    <option key={d} value={d}>
                      {t('app.kg.detail.hops', { count: d })}
                    </option>
                  ))}
                </select>
              </div>
              {graph.isLoading ? (
                <div className="h-[460px] animate-pulse rounded-xl bg-muted/50 motion-reduce:animate-none" aria-busy="true" aria-label={t('app.kg.detail.loadingGraph')} />
              ) : graph.isError ? (
                <QueryErrorState error={graph.error} onRetry={() => graph.refetch()} title={t('app.kg.error.graph')} />
              ) : graph.data ? (
                <ObjectGraph graph={graph.data} />
              ) : null}
            </div>
          </div>
          <aside className="space-y-4">
            <CreateWatchForm
              objectId={detail.data.object.id}
              objectKey={detail.data.object.objectKey}
              defaultType={notReleased ? 'GAP' : 'API'}
            />
          </aside>
        </div>
      ) : null}
    </div>
  );
}
