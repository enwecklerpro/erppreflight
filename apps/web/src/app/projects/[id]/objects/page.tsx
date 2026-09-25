'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../../lib/query/query-keys';
import { SapObject } from '@erppreflight/schemas';
import { DataTable } from '../../../../components/data-table/data-table';
import { useTableUrlSync } from '../../../../hooks/useTableUrlSync';
import { getObjectColumns, objectFacetedFilters } from '../../../../components/objects/object-columns';
import { ObjectDetailDrawer } from '../../../../components/objects/object-detail-drawer';
import { fetchProjectObjects } from '../../../../components/objects/types';
import {
  Boxes,
  RefreshCw,
  ChevronRight,
  ArrowLeft,
} from 'lucide-react';

function ProjectObjectInventoryContent() {
  const params = useParams();
  const projectId = (params?.id as string) || '';

  // 1. URL State Synchronization Hook
  const { state: urlState, updateUrl, resetAll, tableProps } = useTableUrlSync(50);

  // 2. Drawer Selection State
  const [selectedObject, setSelectedObject] = React.useState<SapObject | null>(null);

  // 3. TanStack Query for Objects (retrieves full 10,000 dataset for fluid client-side virtualization)
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: queryKeys.objects.byProject(projectId),
    queryFn: () =>
      fetchProjectObjects({
        projectId,
        enableVirtualization: true,
      }),
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  const objects = data?.items || [];

  // 4. Memoized Column Definitions
  const columns = React.useMemo(
    () => getObjectColumns({ onSelectObject: (obj) => setSelectedObject(obj) }),
    []
  );

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
        <span className="font-semibold text-foreground">Object Inventory</span>
      </nav>

      {/* Page Header */}
      <div className="border-b border-border pb-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Boxes className="size-6 text-primary" />
              <h1 className="text-xl sm:text-2xl font-extrabold text-foreground">
                SAP Custom Object Inventory & Clean Core Catalog
              </h1>
            </div>
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              Workspace ID: {projectId} • Virtualized High-Capacity Data Grid (10,000+ Objects)
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              aria-label="Refresh object list"
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

        {/* High-Level Inventory Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
          <div className="bg-card border border-border rounded-xl p-4 shadow-xs">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Total Catalog Objects
            </span>
            <span className="text-2xl font-extrabold text-foreground mt-1 block font-mono">
              {data?.totalCount !== undefined ? data.totalCount.toLocaleString() : '—'}
            </span>
            <span className="text-[11px] text-muted-foreground mt-1 block">
              Parsed from customer transports
            </span>
          </div>

          <div className="bg-card border border-border rounded-xl p-4 shadow-xs">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Clean Core Compliance
            </span>
            <span className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-1 block font-mono">
              74.2%
            </span>
            <span className="text-[11px] text-muted-foreground mt-1 block">
              Tier 1 / Tier 2 cloud qualified
            </span>
          </div>

          <div className="bg-card border border-border rounded-xl p-4 shadow-xs">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Classic Modifications
            </span>
            <span className="text-2xl font-extrabold text-rose-600 dark:text-rose-400 mt-1 block font-mono">
              142
            </span>
            <span className="text-[11px] text-muted-foreground mt-1 block">
              Tier 3 direct DB / SSCR keys
            </span>
          </div>

          <div className="bg-card border border-border rounded-xl p-4 shadow-xs">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Active Preflight Findings
            </span>
            <span className="text-2xl font-extrabold text-amber-600 dark:text-amber-400 mt-1 block font-mono">
              389
            </span>
            <span className="text-[11px] text-muted-foreground mt-1 block">
              Affecting 264 custom assets
            </span>
          </div>
        </div>
      </div>

      {/* Virtualized Data Grid Container */}
      <DataTable
        columns={columns}
        data={objects}
        tableProps={tableProps}
        getRowId={(row) => row.id}
        enableVirtualization={true}
        virtualHeight="calc(100vh - 360px)"
        estimateRowHeight={() => 54}
        overscan={10}
        facetedFilters={objectFacetedFilters}
        searchPlaceholder="Search objects by name, package, or description..."
        isLoading={isLoading}
        isError={isError}
        error={error as Error}
        onRetry={() => refetch()}
        emptyTitle="No SAP Objects Found"
        emptyDescription="Upload a CTS transport zip or run preflight discovery to populate the custom inventory."
        rowCount={data?.totalCount}
      />

      {/* Object Detail Slide-Over Drawer */}
      <ObjectDetailDrawer
        object={selectedObject}
        onClose={() => setSelectedObject(null)}
      />
    </div>
  );
}

export default function ProjectObjectInventoryPage() {
  return (
    <React.Suspense
      fallback={
        <div className="p-12 text-center text-xs text-muted-foreground">
          Loading SAP Object Inventory...
        </div>
      }
    >
      <ProjectObjectInventoryContent />
    </React.Suspense>
  );
}
