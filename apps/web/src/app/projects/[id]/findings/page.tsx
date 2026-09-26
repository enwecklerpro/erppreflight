'use client';

import * as React from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronRight,
  ShieldAlert,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react';
import { useFindingsPage } from '../../../../hooks/useFindingsPage';
import { DataTable } from '../../../../components/data-table';
import {
  buildFindingColumns,
  buildFindingFacetedFilters,
} from '../../../../components/findings/finding-columns';
import { FindingDetailRow } from '../../../../components/findings/finding-detail-row';
import { useTableUrlSync } from '../../../../hooks/useTableUrlSync';
import { useT } from '@/i18n/client';
import {
  findingLifecycleFilters,
  withLifecycleColumns,
} from '../../../../components/findings/finding-lifecycle-columns';
import { FindingsBulkActions } from '../../../../components/findings/findings-bulk-actions';
import { FocusedFinding } from '../../../../components/findings/focused-finding';
import { focusedFindingId } from '../../../../lib/api/platform-hardening';

function ProjectFindingsContent() {
  const params = useParams();
  const projectId = (params?.id as string) || '';
  const t = useT();
  // Notification deep link: /projects/:id/findings?finding=:findingId
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const focusedId = focusedFindingId(searchParams.get('finding'));
  const closeFocus = React.useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete('finding');
    next.delete('org');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);
  // Finding lifecycle (Part 01 §1.7): status / owner / due columns and server-side filters.
  const columns = React.useMemo(() => withLifecycleColumns(buildFindingColumns(t), t), [t]);
  const facetedFilters = React.useMemo(
    () => [...findingLifecycleFilters(t), ...buildFindingFacetedFilters(t)],
    [t]
  );

  // URL synchronization hook for table filters, sorts, search and pagination
  const { state: urlState, tableProps } = useTableUrlSync(50);

  // Server-paginated findings (page / pageSize / search / single-value filters)
  const { data, isLoading, isError, error, refetch, isFetching } = useFindingsPage(
    urlState,
    projectId
  );

  const findings = data?.items ?? [];
  const pagination = data?.pagination;

  // Statistics for the current page (the total comes from the server)
  const blockerCount = findings.filter((f) => f.severity === 'BLOCKER').length;
  const criticalCount = findings.filter((f) => f.severity === 'CRITICAL').length;
  const tier3Count = findings.filter((f) =>
    f.affectedObjects?.some((obj) => obj.tier === 'TIER_3_CLASSIC')
  ).length;

  return (
    <div className="space-y-6">
      {/* Breadcrumb Navigation */}
      <nav aria-label={t('app.findings.page.breadcrumb')} className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/projects" className="hover:text-foreground transition-colors">
          {t('app.findings.page.projects')}
        </Link>
        <ChevronRight className="size-3.5" />
        <Link href={`/projects/${projectId}`} className="hover:text-foreground transition-colors font-mono">
          {t('app.findings.page.workspace')}
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="font-semibold text-foreground">{t('app.findings.page.current')}</span>
      </nav>

      {/* Header Bar */}
      <div className="border-b border-border pb-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <ShieldAlert className="size-6 text-primary" />
              <h1 className="text-xl sm:text-2xl font-extrabold text-foreground">
                {t('app.findings.page.title')}
              </h1>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('app.findings.page.intro')}{' '}
              <span className="font-mono text-foreground font-semibold">{projectId}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              aria-label={t('app.findings.page.refreshLabel')}
            >
              <RefreshCw className={`size-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              {t('app.findings.page.refresh')}
            </button>
            <Link
              href={`/projects/${projectId}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shadow-xs"
            >
              <ArrowLeft className="size-3.5" />
              {t('app.findings.page.back')}
            </Link>
          </div>
        </div>

        {/* Metric Badges */}
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-card border border-border shadow-xs">
            <span className="text-muted-foreground">{t('app.findings.page.total')}</span>
            <span className="font-bold text-foreground font-mono">
              {pagination ? pagination.total : '—'}
            </span>
          </div>
          <span className="text-muted-foreground">{t('app.findings.page.pageNote')}</span>
          <span className="text-muted-foreground">{t('findingLifecycle.table.latestOnlyNote')}</span>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/60 dark:text-red-200 dark:border-red-900 shadow-xs">
            <span className="font-semibold">{t('app.findings.page.blockers')}</span>
            <span className="font-bold font-mono">{blockerCount}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-orange-50 border border-orange-200 text-orange-800 dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-900 shadow-xs">
            <span className="font-semibold">{t('app.findings.page.critical')}</span>
            <span className="font-bold font-mono">{criticalCount}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-900 shadow-xs">
            <span className="font-semibold">{t('app.findings.page.tier3')}</span>
            <span className="font-bold font-mono">{tier3Count}</span>
          </div>
        </div>
      </div>

      {focusedId ? (
        <FocusedFinding
          projectId={projectId}
          findingId={focusedId}
          organizationId={focusedFindingId(searchParams.get('org'))}
          onClose={closeFocus}
        />
      ) : null}

      {/* Main Virtualized Findings Grid */}
      <DataTable
        columns={columns}
        data={findings}
        tableProps={tableProps}
        pageCount={pagination?.totalPages ?? 0}
        rowCount={pagination?.total ?? 0}
        facetedFilters={facetedFilters}
        bulkActions={(table) => <FindingsBulkActions table={table} />}
        searchColumnId="title"
        searchPlaceholder={t('app.findings.page.search')}
        renderExpandedRow={(row) => <FindingDetailRow finding={row.original} />}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        emptyTitle={t('app.findings.page.emptyTitle')}
        emptyDescription={t('app.findings.page.emptyDescription')}
      />
    </div>
  );
}

export default function ProjectFindingsPage() {
  const t = useT();
  return (
    <React.Suspense
      fallback={
        <div className="p-12 text-center text-xs text-muted-foreground">
          {t('app.findings.page.loading')}
        </div>
      }
    >
      <ProjectFindingsContent />
    </React.Suspense>
  );
}
