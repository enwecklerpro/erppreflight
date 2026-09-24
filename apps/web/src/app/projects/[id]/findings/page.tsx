'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronRight,
  ShieldAlert,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react';
import { queryKeys } from '../../../../lib/query/query-keys';
import { fetchFindings } from '../../../../lib/api-client';
import { Finding } from '@erppreflight/schemas';
import { DataTable } from '../../../../components/data-table';
import {
  findingColumns,
  findingFacetedFilters,
} from '../../../../components/findings/finding-columns';
import { FindingDetailRow } from '../../../../components/findings/finding-detail-row';
import { useTableUrlSync } from '../../../../hooks/useTableUrlSync';

function ProjectFindingsContent() {
  const params = useParams();
  const projectId = (params?.id as string) || '';

  // TanStack Query for server state
  const {
    data: rawFindings = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<Finding[], Error>({
    queryKey: queryKeys.findings.byProject(projectId),
    queryFn: async () => {
      return fetchFindings({ projectId });
    },
    staleTime: 1000 * 60 * 2,
    refetchOnWindowFocus: false,
  });

  // URL synchronization hook for table filters, sorts, and search
  const { state: urlState, updateUrl, tableProps } = useTableUrlSync(50);

  const findings = rawFindings;

  // High-level statistics
  const blockerCount = findings.filter((f) => f.severity === 'BLOCKER').length;
  const criticalCount = findings.filter((f) => f.severity === 'CRITICAL').length;
  const tier3Count = findings.filter((f) =>
    f.affectedObjects?.some((obj) => obj.tier === 'TIER_3_CLASSIC')
  ).length;

  return (
    <div className="space-y-6">
      {/* Breadcrumb Navigation */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/projects" className="hover:text-foreground transition-colors">
          Projects
        </Link>
        <ChevronRight className="size-3.5" />
        <Link href={`/projects/${projectId}`} className="hover:text-foreground transition-colors font-mono">
          Workspace
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="font-semibold text-foreground">Findings & Preflight Ledger</span>
      </nav>

      {/* Header Bar */}
      <div className="border-b border-border pb-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <ShieldAlert className="size-6 text-primary" />
              <h1 className="text-xl sm:text-2xl font-extrabold text-foreground">
                Preflight Findings & Evidence Ledger
              </h1>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Verifiable preflight defects, Clean Core violations, and cryptographic SHA-256 evidence chain for Workspace{' '}
              <span className="font-mono text-foreground font-semibold">{projectId}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              aria-label="Refresh findings list"
            >
              <RefreshCw className={`size-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <Link
              href={`/projects/${projectId}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shadow-xs"
            >
              <ArrowLeft className="size-3.5" />
              Back to Overview
            </Link>
          </div>
        </div>

        {/* Metric Badges */}
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-card border border-border shadow-xs">
            <span className="text-muted-foreground">Total Findings:</span>
            <span className="font-bold text-foreground font-mono">{findings.length}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/60 dark:text-red-200 dark:border-red-900 shadow-xs">
            <span className="font-semibold">Blockers:</span>
            <span className="font-bold font-mono">{blockerCount}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-orange-50 border border-orange-200 text-orange-800 dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-900 shadow-xs">
            <span className="font-semibold">Critical:</span>
            <span className="font-bold font-mono">{criticalCount}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-900 shadow-xs">
            <span className="font-semibold">Tier 3 Classic Mutations:</span>
            <span className="font-bold font-mono">{tier3Count}</span>
          </div>
        </div>
      </div>

      {/* Main Virtualized Findings Grid */}
      <DataTable
        columns={findingColumns}
        data={findings}
        tableProps={tableProps}
        enableVirtualization={findings.length > 50}
        virtualHeight="calc(100vh - 340px)"
        facetedFilters={findingFacetedFilters}
        searchColumnId="title"
        searchPlaceholder="Filter by title, rule ID, or description..."
        renderExpandedRow={(row) => <FindingDetailRow finding={row.original} />}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        emptyTitle="Clean Core Verified — Zero Preflight Defects"
        emptyDescription="All evaluated SAP artifacts and custom objects comply with Clean Core guidelines. No migration blockers detected."
      />
    </div>
  );
}

export default function ProjectFindingsPage() {
  return (
    <React.Suspense
      fallback={
        <div className="p-12 text-center text-xs text-muted-foreground">
          Loading Preflight Findings Ledger...
        </div>
      }
    >
      <ProjectFindingsContent />
    </React.Suspense>
  );
}
