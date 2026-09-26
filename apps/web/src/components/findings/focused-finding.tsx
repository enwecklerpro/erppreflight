'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, BellRing, X } from 'lucide-react';
import { QueryErrorState } from '@/components/knowledge-graph/kg-nav';
import { ApiError, getStoredTenantId } from '@/lib/api/custom-instance';
import { accountKeys, fetchMyOrganizations } from '@/lib/account-api';
import { useTenantSwitch } from '@/lib/query/query-provider';
import { fetchFocusedFinding, focusedFindingKey } from '@/lib/api/platform-hardening';
import { useT } from '@/i18n/client';
import { FindingDetailRow } from './finding-detail-row';
import { SeverityBadge } from './severity-badge';

/**
 * Target of a notification deep link (`/projects/:id/findings?finding=:findingId`):
 * shows the one finding with its evidence and lifecycle panel above the ledger.
 * A finding of another project (or tenant) is reported as not found. When the link names
 * an organization (`org`) the user belongs to but is not signed in to, an explicit switch
 * is offered (never a silent tenant switch).
 */
export function FocusedFinding({
  projectId,
  findingId,
  organizationId = null,
  onClose,
}: {
  projectId: string;
  findingId: string;
  organizationId?: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const switchTenant = useTenantSwitch();
  const [switching, setSwitching] = React.useState(false);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const query = useQuery({
    queryKey: focusedFindingKey(findingId),
    queryFn: ({ signal }) => fetchFocusedFinding(findingId, signal),
    retry: (count, error) => !(error instanceof ApiError && [400, 403, 404].includes(error.statusCode)) && count < 2,
  });
  const finding = query.data && query.data.projectId === projectId ? query.data : null;

  React.useEffect(() => {
    // Move keyboard / screen-reader focus to the deep-linked finding once it is shown.
    if (finding) headingRef.current?.focus();
  }, [finding]);

  const notFound =
    (query.isError && query.error instanceof ApiError && [400, 403, 404].includes(query.error.statusCode)) ||
    (query.isSuccess && !finding);
  const otherOrg = Boolean(notFound && organizationId && organizationId !== getStoredTenantId());
  const orgs = useQuery({ queryKey: accountKeys.organizations, queryFn: fetchMyOrganizations, enabled: otherOrg, staleTime: 60_000 });
  const targetOrg = otherOrg ? orgs.data?.find((o) => o.id === organizationId) ?? null : null;

  return (
    <section
      aria-labelledby="focused-finding-title"
      data-testid="focused-finding"
      className="rounded-xl border-2 border-primary/40 bg-primary/5 p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="focused-finding-title"
          ref={headingRef}
          tabIndex={-1}
          className="inline-flex items-center gap-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <BellRing className="size-4 text-primary" aria-hidden="true" />
          {t('app.platformHardening.findingFocus.title')}
          {finding ? <SeverityBadge severity={finding.severity} size="sm" /> : null}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <X className="size-3.5" aria-hidden="true" /> {t('app.platformHardening.findingFocus.close')}
        </button>
      </div>
      {query.isLoading ? (
        <div aria-busy="true" aria-live="polite" className="space-y-2">
          <span className="sr-only">{t('app.platformHardening.findingFocus.loading')}</span>
          <div className="h-6 w-2/3 animate-pulse rounded bg-muted/60 motion-reduce:animate-none" />
          <div className="h-40 animate-pulse rounded-xl bg-muted/50 motion-reduce:animate-none" />
        </div>
      ) : targetOrg ? (
        <div className="flex flex-wrap items-center gap-3" role="status">
          <p className="text-sm text-muted-foreground">
            {t('app.platformHardening.findingFocus.otherOrganization', { name: targetOrg.name })}
          </p>
          <button
            type="button"
            disabled={switching}
            aria-busy={switching}
            data-testid="focused-finding-switch-org"
            onClick={async () => {
              setSwitching(true);
              try {
                // Evicts every tenant-scoped cache entry and stores the new X-Tenant-Id, then
                // reloads the same deep link so all queries start fresh in that organization.
                await switchTenant(targetOrg.id);
                window.location.assign(`${window.location.pathname}${window.location.search}`);
              } catch {
                setSwitching(false);
              }
            }}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <ArrowRightLeft className="size-3.5" aria-hidden="true" />
            {t('app.platformHardening.findingFocus.switchOrganization', { name: targetOrg.name })}
          </button>
        </div>
      ) : notFound ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('app.platformHardening.findingFocus.notFound')}
        </p>
      ) : query.isError ? (
        <QueryErrorState
          error={query.error}
          onRetry={() => query.refetch()}
          title={t('app.platformHardening.findingFocus.loadFailed')}
        />
      ) : finding ? (
        <FindingDetailRow finding={finding} />
      ) : null}
    </section>
  );
}
