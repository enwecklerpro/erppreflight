'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { DataTable } from '@/components/data-table';
import { buildFindingColumns, buildFindingFacetedFilters } from '@/components/findings/finding-columns';
import { FindingDetailRow } from '@/components/findings/finding-detail-row';
import { useT } from '@/i18n/client';
import { analysisRunKeys, fetchRunFindings } from '@/lib/api/analysis-lifecycle';

/**
 * Findings of one analysis run, rendered with the shared findings table (sorting, facets,
 * search, expandable evidence rows, virtualisation for large runs). Findings are immutable
 * per run; the table never mixes in other runs.
 */
export function RunFindingsTable({ analysisId, status }: { analysisId: string; status: string }) {
  const t = useT();
  const terminal = status === 'COMPLETED' || status === 'PARTIAL' || status === 'FAILED' || status === 'CANCELLED';
  const query = useQuery({
    queryKey: analysisRunKeys.findings(analysisId),
    queryFn: ({ signal }) => fetchRunFindings(analysisId, signal),
    enabled: Boolean(analysisId),
    retry: 2,
    staleTime: terminal ? 5 * 60_000 : 0,
  });
  const findings = query.data ?? [];
  const columns = React.useMemo(() => buildFindingColumns(t), [t]);
  const facetedFilters = React.useMemo(() => buildFindingFacetedFilters(t), [t]);

  let emptyTitle = t('app.analysisRun.findings.emptyTitle');
  let emptyDescription = t('app.analysisRun.findings.emptyDescription');
  if (!terminal) {
    emptyTitle = t('app.analysisRun.findings.pendingTitle');
    emptyDescription = t('app.analysisRun.findings.pendingDescription');
  } else if (status === 'CANCELLED') {
    emptyTitle = t('app.analysisRun.findings.cancelledTitle');
    emptyDescription = t('app.analysisRun.findings.cancelledDescription');
  } else if (status === 'FAILED') {
    emptyTitle = t('app.analysisRun.findings.failedTitle');
    emptyDescription = t('app.analysisRun.findings.failedDescription');
  }

  return (
    <div data-testid="analysis-findings" data-count={findings.length}>
      <DataTable
        ariaLabel={t('app.analysisRun.findings.ariaLabel')}
        columns={columns}
        data={findings}
        facetedFilters={facetedFilters}
        searchColumnId="title"
        searchPlaceholder={t('app.analysisRun.findings.search')}
        renderExpandedRow={(row) => <FindingDetailRow finding={row.original} />}
        enableVirtualization={findings.length > 100}
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error as Error | null}
        onRetry={() => query.refetch()}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
      />
    </div>
  );
}
