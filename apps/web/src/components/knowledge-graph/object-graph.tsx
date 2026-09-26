'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Network, Table2, AlertCircle } from 'lucide-react';
import type { Neighborhood } from '@/lib/knowledge-graph';
import { SupportStateBadge } from './badges';
import { useLabel, useT } from '@/i18n/client';
import type { TFunction } from '@/i18n/translate';

const NODE_W = 190;
const NODE_H = 56;

type LaidOut = { nodes: Node[]; edges: Edge[] };

/** ELK layered layout (the approved graph layout engine, AGENTS.md §4.2). Loaded lazily. */
async function layout(graph: Neighborhood, t: TFunction, supportLabel: (s: string) => string): Promise<LaidOut> {
  const ELK = (await import('elkjs/lib/elk.bundled.js')).default;
  const elk = new ELK();
  const res = await elk.layout({
    id: 'root',
    // Hub-shaped neighborhoods (one object with many successors/predecessors) read best radially;
    // chains keep the layered left-to-right layout.
    layoutOptions:
      graph.nodes.length > 8
        ? { 'elk.algorithm': 'radial', 'elk.spacing.nodeNode': '40', 'elk.radial.compactor': 'WEDGE_COMPACTION' }
        : {
            'elk.algorithm': 'layered',
            'elk.direction': 'RIGHT',
            'elk.spacing.nodeNode': '24',
            'elk.layered.spacing.nodeNodeBetweenLayers': '70',
          },
    children: graph.nodes.map((n) => ({ id: n.id, width: NODE_W, height: NODE_H })),
    edges: graph.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  });
  const pos = new Map((res.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
  const nodes: Node[] = graph.nodes.map((n) => {
    const headline = (n.states ?? []).find((s) => s.scheme === 'RELEASE_CONTRACT');
    const isRelease = n.kind === 'RELEASE';
    return {
      id: n.id,
      position: pos.get(n.id) ?? { x: 0, y: 0 },
      data: {
        label: (
          <div className="text-left leading-tight">
            <div className="font-mono text-[11px] font-bold truncate" title={n.objectKey}>
              {n.objectKey}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">
              {isRelease ? t('app.kg.graph.release') : `${n.sapObjectType ?? ''} · ${headline ? supportLabel(headline.supportState) : t('app.kg.graph.noState')}`}
            </div>
          </div>
        ),
      },
      style: {
        width: NODE_W,
        height: NODE_H,
        borderRadius: 10,
        border: n.isRoot ? '2px solid #2563eb' : isRelease ? '1px dashed #64748b' : '1px solid #cbd5e1',
        background: isRelease ? '#f1f5f9' : '#ffffff',
        color: '#0f172a',
        padding: 6,
      },
      ariaLabel: `${isRelease ? t('app.kg.graph.release') : t('app.kg.graph.object')} ${n.objectKey}`,
    } satisfies Node;
  });
  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.relationshipType.replace(/_/g, ' ').toLowerCase(),
    labelStyle: { fontSize: 9 },
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { strokeDasharray: e.relationshipType.includes('RELEASE') ? '4 3' : undefined },
  }));
  return { nodes, edges };
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/**
 * Knowledge-graph neighborhood: React Flow canvas with ELK layout plus an
 * accessible table fallback (default for keyboard / screen-reader users who
 * choose it; always available via the toggle).
 */
export function ObjectGraph({ graph }: { graph: Neighborhood }) {
  const t = useT();
  const label = useLabel();
  const [view, setView] = useState<'graph' | 'table'>('graph');
  const [laid, setLaid] = useState<LaidOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  useEffect(() => {
    let cancelled = false;
    setLaid(null);
    setError(null);
    layout(graph, t, (s) => label('app.kg.support', s))
      .then((r) => !cancelled && setLaid(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Layout failed'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, t]);

  return (
    <section aria-labelledby="kg-graph-title" className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 id="kg-graph-title" className="text-sm font-semibold">
          {t('app.kg.graph.title')}{' '}
          <span className="font-normal text-muted-foreground">
            {t(graph.truncated ? 'app.kg.graph.statsTruncated' : 'app.kg.graph.stats', { nodes: graph.nodes.length, edges: graph.edges.length, depth: graph.depth })}
          </span>
        </h2>
        <div role="group" aria-label={t('app.kg.graph.viewLabel')} className="inline-flex rounded-lg border border-border p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setView('graph')}
            aria-pressed={view === 'graph'}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${view === 'graph' ? 'bg-primary text-primary-foreground' : ''}`}
          >
            <Network className="size-3.5" aria-hidden="true" /> {t('app.kg.graph.graph')}
          </button>
          <button
            type="button"
            onClick={() => setView('table')}
            aria-pressed={view === 'table'}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${view === 'table' ? 'bg-primary text-primary-foreground' : ''}`}
          >
            <Table2 className="size-3.5" aria-hidden="true" /> {t('app.kg.graph.table')}
          </button>
        </div>
      </div>

      {view === 'graph' ? (
        <div className="h-[420px]" aria-hidden={false}>
          {error ? (
            <div role="alert" className="flex h-full items-center justify-center gap-2 text-sm text-destructive">
              <AlertCircle className="size-4" aria-hidden="true" /> {t('app.kg.graph.layoutFailed', { error })}
            </div>
          ) : !laid ? (
            <div className="h-full animate-pulse bg-muted/40" aria-busy="true" aria-label={t('app.kg.graph.layingOut')} />
          ) : (
            <ReactFlow
              nodes={laid.nodes}
              edges={laid.edges}
              fitView
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              proOptions={{ hideAttribution: true }}
              minZoom={0.2}
              panOnScroll={false}
              zoomOnDoubleClick={!reducedMotion}
            >
              <Background gap={16} />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">{t('app.kg.graph.caption')}</caption>
            <thead className="sticky top-0 bg-muted/80 text-left">
              <tr>
                <th scope="col" className="px-3 py-2">{t('app.kg.graph.colSource')}</th>
                <th scope="col" className="px-3 py-2">{t('app.kg.graph.colRelation')}</th>
                <th scope="col" className="px-3 py-2">{t('app.kg.graph.colTarget')}</th>
                <th scope="col" className="px-3 py-2">{t('app.kg.graph.colReleases')}</th>
              </tr>
            </thead>
            <tbody>
              {graph.edges.map((e) => {
                const s = nodeById.get(e.source);
                const t = nodeById.get(e.target);
                const cell = (n: typeof s, id: string) =>
                  n && n.kind === 'OBJECT' ? (
                    <Link href={`/knowledge-graph/objects/${id}`} className="font-mono text-primary hover:underline">
                      {n.objectKey}
                    </Link>
                  ) : (
                    <span>{n?.objectKey ?? id}</span>
                  );
                const headline = t?.states?.find((x) => x.scheme === 'RELEASE_CONTRACT');
                return (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-3 py-1.5">{cell(s, e.source)}</td>
                    <td className="px-3 py-1.5">{e.relationshipType.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        {cell(t, e.target)}
                        {headline ? <SupportStateBadge state={headline.supportState} /> : null}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{e.releases.slice(0, 3).join(', ')}{e.releases.length > 3 ? ` +${e.releases.length - 3}` : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {graph.edges.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t('app.kg.graph.empty')}</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
