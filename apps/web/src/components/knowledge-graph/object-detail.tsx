import React from 'react';
import Link from 'next/link';
import { ArrowRight, ExternalLink, Fingerprint, History, ShieldCheck } from 'lucide-react';
import type { ObjectDetail, ObjectState } from '@/lib/knowledge-graph';
import { CHANGE_LABELS, SupportStateBadge, TrustLevelBadge, isSupportState } from './badges';

export type ObjectLinkMode = 'app' | 'public';

export function objectHref(mode: ObjectLinkMode, o: { id?: string | null; sapObjectType: string; objectKey: string }) {
  if (mode === 'app' && o.id) return `/knowledge-graph/objects/${o.id}`;
  return `/knowledge-graph/lookup/${encodeURIComponent(o.sapObjectType)}/${encodeURIComponent(o.objectKey)}`;
}

function groupByEdition(states: ObjectState[]) {
  const groups = new Map<string, { title: string; rows: ObjectState[] }>();
  for (const s of states) {
    const k = `${s.productCode}|${s.editionCode}`;
    const g = groups.get(k) ?? { title: `${s.productName} — ${s.editionName}`, rows: [] };
    g.rows.push(s);
    groups.set(k, g);
  }
  return [...groups.values()];
}

/** Object detail body shared by the in-app explorer and the public lookup tool. */
export function ObjectDetailView({ detail, mode }: { detail: ObjectDetail; mode: ObjectLinkMode }) {
  const o = detail.object;
  const groups = groupByEdition(detail.states);
  const schemeLabel = (s: string) => (s === 'CLASSIC_API_CLASSIFICATION' ? 'Classic API classification' : s === 'RELEASE_CONTRACT' ? 'Release contract (C1)' : s);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{o.sapObjectType}</span>
          <span>{o.objectType.replace(/_/g, ' ').toLowerCase()}</span>
          {o.applicationComponent ? <span>· {o.applicationComponent}</span> : null}
          {o.softwareComponent ? <span>· {o.softwareComponent}</span> : null}
          <span>· {o.scope === 'GLOBAL' ? 'Global SAP knowledge' : 'Customer object (your organization only)'}</span>
        </div>
        <h1 className="font-mono text-2xl font-bold tracking-tight break-all">{o.objectKey}</h1>
        {o.description ? <p className="text-sm text-muted-foreground">{o.description}</p> : null}
        {detail.aliases.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Also known as:{' '}
            {detail.aliases.map((a) => (
              <span key={`${a.aliasType}-${a.alias}`} className="mr-2 font-mono">
                {a.alias} <span className="font-sans">({a.aliasType.replace(/_/g, ' ').toLowerCase()})</span>
              </span>
            ))}
          </p>
        ) : null}
      </header>

      <section aria-labelledby="kg-states" className="space-y-3">
        <h2 id="kg-states" className="text-base font-semibold">
          Release states per product, edition and release
        </h2>
        {groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            No release state is recorded for this object in the current knowledge snapshot. It is referenced by
            another object (for example as a successor) but not listed itself — treat its status as unknown.
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.title} className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[640px] text-xs">
                <caption className="bg-muted/60 px-3 py-2 text-left text-xs font-semibold">{g.title}</caption>
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2">Release</th>
                    <th scope="col" className="px-3 py-2">Scheme</th>
                    <th scope="col" className="px-3 py-2">State</th>
                    <th scope="col" className="px-3 py-2">Successor / alternative</th>
                    <th scope="col" className="px-3 py-2">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((s, i) => (
                    <tr key={`${s.releaseId}-${s.scheme}-${s.evidence.sourceId}-${i}`} className="border-t border-border align-top">
                      <td className="px-3 py-2 whitespace-nowrap">{s.releaseLabel}</td>
                      <td className="px-3 py-2 text-muted-foreground">{schemeLabel(s.scheme)}</td>
                      <td className="px-3 py-2">
                        {isSupportState(s.supportState) ? <SupportStateBadge state={s.supportState} level={s.cleanCoreLevel} /> : s.state}
                        {s.labels && s.labels.length > 0 ? (
                          <div className="mt-1 text-[10px] text-muted-foreground">{s.labels.join(', ')}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {s.successors.length === 0 && !s.successorConcept ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {s.successors.map((x) => (
                              <li key={`${x.sapObjectType}-${x.objectKey}`}>
                                <Link href={objectHref(mode, { id: x.objectId, sapObjectType: x.sapObjectType, objectKey: x.objectKey })} className="inline-flex items-center gap-1 font-mono text-primary hover:underline">
                                  <ArrowRight className="size-3" aria-hidden="true" />
                                  {x.objectKey}
                                </Link>{' '}
                                <span className="text-[10px] text-muted-foreground">{x.sapObjectType}</span>
                              </li>
                            ))}
                            {s.successorConcept ? <li className="text-muted-foreground">Concept: {s.successorConcept}</li> : null}
                          </ul>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <TrustLevelBadge level={s.evidence.trustLevel} />
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {s.confidenceClass} · since snapshot #{s.validFromSnapshotSeq}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </section>

      {detail.replaces.length > 0 ? (
        <section aria-labelledby="kg-replaces">
          <h2 id="kg-replaces" className="mb-2 text-base font-semibold">
            Successor of ({detail.replaces.length})
          </h2>
          <p className="mb-2 text-xs text-muted-foreground">Objects for which SAP names {o.objectKey} as successor.</p>
          <ul className="flex flex-wrap gap-2">
            {detail.replaces.map((r) => (
              <li key={r.id}>
                <Link href={objectHref(mode, r)} className="rounded-md border border-border px-2 py-1 font-mono text-xs hover:bg-muted">
                  {r.objectKey} <span className="text-muted-foreground">{r.sapObjectType}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="kg-evidence" className="space-y-2">
        <h2 id="kg-evidence" className="flex items-center gap-1.5 text-base font-semibold">
          <ShieldCheck className="size-4" aria-hidden="true" /> Evidence and provenance
        </h2>
        {detail.evidenceSources.length === 0 ? (
          <p className="text-sm text-muted-foreground">No evidence source is attached.</p>
        ) : (
          <ul className="space-y-2">
            {detail.evidenceSources.map((e) => (
              <li key={e.id} className="rounded-lg border border-border p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <TrustLevelBadge level={e.trustLevel} />
                  <span className="font-medium">{e.title}</span>
                  {e.publisher ? <span className="text-muted-foreground">· {e.publisher}</span> : null}
                </div>
                <dl className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-0.5 text-muted-foreground sm:grid-cols-2">
                  {e.url ? (
                    <div className="truncate">
                      <dt className="inline">Source: </dt>
                      <dd className="inline">
                        <a href={e.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                          {e.url.split('/').pop()} <ExternalLink className="size-3" aria-hidden="true" />
                        </a>
                      </dd>
                    </div>
                  ) : null}
                  {e.retrievedAt || e.lastRetrievedAt ? (
                    <div>
                      <dt className="inline">Retrieved: </dt>
                      <dd className="inline">{new Date(e.retrievedAt ?? e.lastRetrievedAt ?? '').toLocaleString()}</dd>
                    </div>
                  ) : null}
                  {e.sha256 ? (
                    <div className="truncate font-mono">
                      <dt className="inline font-sans">SHA-256: </dt>
                      <dd className="inline">{e.sha256}</dd>
                    </div>
                  ) : null}
                  {e.etag ? (
                    <div className="truncate font-mono">
                      <dt className="inline font-sans">Source version (ETag): </dt>
                      <dd className="inline">{e.etag}</dd>
                    </div>
                  ) : null}
                </dl>
              </li>
            ))}
          </ul>
        )}
        {detail.snapshot ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Fingerprint className="size-3.5" aria-hidden="true" />
            Knowledge snapshot #{detail.snapshot.seq} ({detail.snapshot.adapterId}, parser {detail.snapshot.parserVersion}) · content{' '}
            <span className="font-mono">{detail.snapshot.contentSha256.slice(0, 16)}…</span>
            {detail.snapshot.publishedAt ? ` · published ${new Date(detail.snapshot.publishedAt).toLocaleString()}` : ''}
          </p>
        ) : null}
      </section>

      {detail.history.length > 0 ? (
        <section aria-labelledby="kg-history">
          <h2 id="kg-history" className="mb-2 flex items-center gap-1.5 text-base font-semibold">
            <History className="size-4" aria-hidden="true" /> Change history
          </h2>
          <ul className="space-y-1 text-xs">
            {detail.history.map((h, i) => {
              const prev = (h.previous as { supportState?: string } | null)?.supportState;
              const cur = (h.current as { supportState?: string } | null)?.supportState;
              return (
                <li key={i} className="flex flex-wrap items-center gap-2 border-b border-border/60 py-1">
                  <span className="font-semibold">{CHANGE_LABELS[h.changeType] ?? h.changeType}</span>
                  <span className="text-muted-foreground">{h.releaseLabel}</span>
                  <span className="font-mono">{prev ?? '—'} → {cur ?? '—'}</span>
                  <span className="text-muted-foreground">snapshot #{h.snapshotSeq}</span>
                  {h.requiresReview ? <span className="rounded border border-amber-300 px-1 text-amber-800">needs review</span> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
