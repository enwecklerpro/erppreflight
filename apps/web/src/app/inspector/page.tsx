'use client';

import * as React from 'react';
import { SearchCode, RefreshCw } from 'lucide-react';
import { useFindingsPage } from '../../hooks/useFindingsPage';
import { DataTable } from '../../components/data-table';
import {
  findingColumns,
  findingFacetedFilters,
} from '../../components/findings/finding-columns';
import { FindingDetailRow } from '../../components/findings/finding-detail-row';
import { useTableUrlSync } from '../../hooks/useTableUrlSync';
import { useT } from '../../i18n/client';

function UniversalInspectorContent() {
  const t = useT();
  const { state: urlState, tableProps } = useTableUrlSync(50);

  // Server-paginated findings across all projects of the tenant
  const { data, isLoading, isError, error, refetch, isFetching } = useFindingsPage(urlState);
  const findings = data?.items ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-6">
      <div className="border-b border-border pb-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2.5">
              <SearchCode className="size-6 text-primary" aria-hidden="true" />
              {t('app.inspector.title')}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{t('app.inspector.intro')}</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              title={t('app.inspector.refreshLabel')}
            >
              <RefreshCw className={`size-3.5 ${isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
              {t('app.inspector.refresh')}
            </button>
          </div>
        </div>
      </div>

      <DataTable
        columns={findingColumns}
        data={findings}
        tableProps={tableProps}
        pageCount={pagination?.totalPages ?? 0}
        rowCount={pagination?.total ?? 0}
        facetedFilters={findingFacetedFilters}
        searchColumnId="title"
        searchPlaceholder={t('app.inspector.searchPlaceholder')}
        ariaLabel={t('app.inspector.gridLabel')}
        renderExpandedRow={(row) => <FindingDetailRow finding={row.original} />}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        emptyTitle={t('app.inspector.emptyTitle')}
        emptyDescription={t('app.inspector.emptyDescription')}
      />
    </div>
  );
}

function InspectorFallback() {
  const t = useT();
  return <div className="p-12 text-center text-sm text-muted-foreground">{t('app.inspector.loading')}</div>;
}

export default function UniversalInspectorPage() {
  return (
    <React.Suspense fallback={<InspectorFallback />}>
      <UniversalInspectorContent />
    </React.Suspense>
  );
}
