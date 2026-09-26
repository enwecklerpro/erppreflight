'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, Loader2, RefreshCw, Search, SearchX } from 'lucide-react';
import { useDebouncedSearch } from '@/hooks/pacer';
import { kgKeys, lookupObjects, type LookupItem } from '@/lib/knowledge-graph';
import { ApiError } from '@/lib/api/custom-instance';
import { SupportStateBadge } from './badges';
import { objectHref, type ObjectLinkMode } from './object-detail';

const EDITION_LABEL: Record<string, string> = {
  CLOUD_PUBLIC: 'Cloud ERP',
  CLOUD_PRIVATE: 'Cloud ERP Private',
  ABAP_ENVIRONMENT: 'BTP ABAP',
};

function ResultRow({ item, mode }: { item: LookupItem; mode: ObjectLinkMode }) {
  const contract = item.states.filter((s) => s.scheme === 'RELEASE_CONTRACT');
  const classic = item.states.find((s) => s.scheme === 'CLASSIC_API_CLASSIFICATION');
  const successors = [...new Set(contract.flatMap((s) => s.successors.map((x) => x.objectKey)))];
  return (
    <li>
      <Link
        href={objectHref(mode, item)}
        className="block rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/50 hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="font-mono text-sm font-bold break-all">{item.objectKey}</span>{' '}
            <span className="text-xs text-muted-foreground">
              {item.sapObjectType} · {item.objectType.replace(/_/g, ' ').toLowerCase()}
              {item.applicationComponent ? ` · ${item.applicationComponent}` : ''}
              {item.scope === 'TENANT' ? ' · your organization' : ''}
            </span>
          </div>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {item.matchType.toLowerCase()} match
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {contract.length === 0 && !classic ? (
            <span className="text-xs text-muted-foreground">No release state in the current snapshot</span>
          ) : null}
          {contract.map((s) => (
            <span key={`${s.editionCode}-${s.releaseCode}`} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              {EDITION_LABEL[s.editionCode] ?? s.editionCode}: <SupportStateBadge state={s.supportState} level={s.cleanCoreLevel} />
            </span>
          ))}
          {classic ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              Classic model: <SupportStateBadge state={classic.supportState} level={classic.cleanCoreLevel} />
            </span>
          ) : null}
        </div>
        {successors.length > 0 ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-1 text-xs">
            <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />
            <span className="text-muted-foreground">Use instead:</span>
            {successors.slice(0, 6).map((s) => (
              <span key={s} className="font-mono">{s}</span>
            ))}
            {successors.length > 6 ? <span className="text-muted-foreground">+{successors.length - 6}</span> : null}
          </p>
        ) : null}
      </Link>
    </li>
  );
}

/**
 * Debounced object lookup with URL-synced query (?q=). `mode="public"` calls
 * the rate-limited public endpoint that only returns global reviewed knowledge.
 */
export function ObjectLookup({ mode }: { mode: ObjectLinkMode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [term, setTerm] = useState(params.get('q') ?? '');
  const { debouncedValue, isPending } = useDebouncedSearch(term.trim(), 300);

  useEffect(() => {
    const next = new URLSearchParams(params.toString());
    if (debouncedValue) next.set('q', debouncedValue);
    else next.delete('q');
    const url = `${pathname}${next.toString() ? `?${next}` : ''}`;
    router.replace(url, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedValue]);

  const query = useQuery({
    queryKey: kgKeys.lookup(debouncedValue, null, mode === 'public'),
    queryFn: ({ signal }) => lookupObjects(debouncedValue, { isPublic: mode === 'public', signal }),
    enabled: debouncedValue.length > 0,
    staleTime: 60_000,
    retry: (count, err) => !(err instanceof ApiError && [400, 401, 403, 429].includes(err.statusCode)) && count < 2,
  });

  const rateLimited = query.error instanceof ApiError && query.error.statusCode === 429;

  return (
    <div className="space-y-4">
      <form role="search" onSubmit={(e) => e.preventDefault()} className="relative">
        <label htmlFor="kg-lookup" className="sr-only">
          SAP object name
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          id="kg-lookup"
          type="search"
          autoComplete="off"
          spellCheck={false}
          maxLength={120}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Table, CDS view, class, function module… e.g. MARA, BSEG, I_PRODUCT, CL_ABAP_TYPEDESCR"
          className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-10 font-mono text-sm shadow-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        {isPending || query.isFetching ? (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Searching" />
        ) : null}
      </form>

      <div aria-live="polite">
        {!debouncedValue ? (
          <p className="text-sm text-muted-foreground">
            Type an object name. Exact, prefix and fuzzy matches are shown with their release state per edition and the
            official successor to use instead.
          </p>
        ) : query.isLoading ? (
          <ul className="space-y-2" aria-busy="true" aria-label="Loading results">
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="h-[88px] animate-pulse rounded-xl border border-border bg-muted/40 motion-reduce:animate-none" />
            ))}
          </ul>
        ) : query.isError ? (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="flex-1">
              {rateLimited
                ? 'Too many lookups from your network. Please wait a minute and try again.'
                : `Lookup failed: ${query.error instanceof Error ? query.error.message : 'unknown error'}`}
            </div>
            <button type="button" onClick={() => query.refetch()} className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-0.5 text-xs">
              <RefreshCw className="size-3" aria-hidden="true" /> Retry
            </button>
          </div>
        ) : query.data && query.data.results.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
            <SearchX className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">No SAP object matches “{debouncedValue}”.</p>
            <p className="max-w-md text-xs text-muted-foreground">
              Objects that SAP does not list in the Cloudification Repository are not released for ABAP Cloud. Check the
              spelling or search by prefix (e.g. I_PRODUCT).
            </p>
          </div>
        ) : query.data ? (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {query.data.results.length} result{query.data.results.length === 1 ? '' : 's'}
              {query.data.snapshot ? ` · knowledge snapshot #${query.data.snapshot.seq}` : ''}
            </p>
            <ul className="space-y-2">
              {query.data.results.map((r) => (
                <ResultRow key={r.id} item={r} mode={mode} />
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
