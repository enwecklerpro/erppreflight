'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { SearchCode, RefreshCw } from 'lucide-react';
import { queryKeys } from '../../lib/query/query-keys';
import { fetchFindings } from '../../lib/api-client';
import { Finding } from '@erppreflight/schemas';
import { DataTable } from '../../components/data-table';
import {
  findingColumns,
  findingFacetedFilters,
} from '../../components/findings/finding-columns';
import { FindingDetailRow } from '../../components/findings/finding-detail-row';
import { useTableUrlSync } from '../../hooks/useTableUrlSync';

function UniversalInspectorContent() {
  const {
    data: findings = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<Finding[], Error>({
    queryKey: queryKeys.findings.lists(),
    queryFn: async () => {
      return await fetchFindings();
    },
    staleTime: 1000 * 60 * 2,
    refetchOnWindowFocus: false,
  });

  const { state: urlState, updateUrl, tableProps } = useTableUrlSync(50);

  return (
    <div className="space-y-6">
      <div className="border-b border-border pb-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2.5">
              <SearchCode className="size-6 text-primary" />
              Universal Object & Analysis Inspector
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              Epistemic findings ledger with cryptographic SHA-256 evidence chain and Clean Core remediation guidance
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              aria-label="Refresh inspector findings"
            >
              <RefreshCw className={`size-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <DataTable
        columns={findingColumns}
        data={findings}
        tableProps={tableProps}
        enableVirtualization={findings.length > 50}
        virtualHeight="calc(100vh - 280px)"
        facetedFilters={findingFacetedFilters}
        searchColumnId="title"
        searchPlaceholder="Search findings by rule ID, title, engine, or object..."
        renderExpandedRow={(row) => <FindingDetailRow finding={row.original} />}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        emptyTitle="No Findings Detected"
        emptyDescription="No analysis findings matched the selected criteria or no runs have been executed."
      />
    </div>
  );
}

export default function UniversalInspectorPage() {
  return (
    <React.Suspense
      fallback={
        <div className="p-12 text-center text-xs text-muted-foreground">
          Loading Universal Inspector...
        </div>
      }
    >
      <UniversalInspectorContent />
    </React.Suspense>
  );
}
