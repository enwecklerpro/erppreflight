'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../../lib/query/query-keys';
import { SapObject } from '@erppreflight/schemas';
import { DataTable } from '../../../../components/data-table/data-table';
import { useTableUrlSync } from '../../../../hooks/useTableUrlSync';
import { buildObjectFacetedFilters, getObjectColumns } from '../../../../components/objects/object-columns';
import { ObjectDetailDrawer } from '../../../../components/objects/object-detail-drawer';
import { fetchProjectObjects } from '../../../../components/objects/types';
import { Boxes, RefreshCw, ChevronRight, ArrowLeft } from 'lucide-react';
import { useFmt, useT } from '../../../../i18n/client';

/** Inventory metrics computed from the loaded objects — nothing is estimated. */
function summarize(objects: SapObject[]) {
  const total = objects.length;
  const cloudReady = objects.filter((o) => o.cleanCoreTier === 'TIER_1_CLOUD' || o.cleanCoreTier === 'TIER_2_DEVELOPER').length;
  const classic = objects.filter((o) => o.cleanCoreTier === 'TIER_3_CLASSIC').length;
  const findings = objects.reduce((sum, o) => sum + (o.findingSummary?.totalCount ?? 0), 0);
  const affected = objects.filter((o) => (o.findingSummary?.totalCount ?? 0) > 0).length;
  return { total, compliance: total > 0 ? cloudReady / total : null, classic, findings, affected };
}

function Metric({ title, value, hint, tone = 'text-foreground' }: { title: string; value: string; hint: string; tone?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-xs">
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">{title}</span>
      <span className={`text-2xl font-extrabold mt-1 block ${tone}`}>{value}</span>
      <span className="text-xs text-muted-foreground mt-1 block">{hint}</span>
    </div>
  );
}

function ProjectObjectInventoryContent() {
  const t = useT();
  const fmt = useFmt();
  const params = useParams();
  const projectId = (params?.id as string) || '';

  const { tableProps } = useTableUrlSync(50);
  const [selectedObject, setSelectedObject] = React.useState<SapObject | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: queryKeys.objects.byProject(projectId),
    queryFn: () => fetchProjectObjects({ projectId, enableVirtualization: true }),
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  const objects = React.useMemo(() => data?.items ?? [], [data]);
  const stats = React.useMemo(() => summarize(objects), [objects]);
  const facetedFilters = React.useMemo(() => buildObjectFacetedFilters(objects, t), [objects, t]);
  const columns = React.useMemo(
    () => getObjectColumns({ onSelectObject: (obj) => setSelectedObject(obj), t, fmt }),
    [t, fmt]
  );
  const closeDrawer = React.useCallback(() => setSelectedObject(null), []);
  const partial = data !== undefined && data.totalCount > objects.length;
  const dash = '—';

  return (
    <div className="space-y-6">
      <nav aria-label={t('app.objects.breadcrumb')} className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/projects" className="hover:text-foreground transition-colors">
          {t('app.objects.projects')}
        </Link>
        <ChevronRight className="size-3.5" aria-hidden="true" />
        <Link href={`/projects/${projectId}`} className="hover:text-foreground transition-colors">
          {t('app.objects.workspace')}
        </Link>
        <ChevronRight className="size-3.5" aria-hidden="true" />
        <span className="font-semibold text-foreground" aria-current="page">
          {t('app.objects.title')}
        </span>
      </nav>

      <div className="border-b border-border pb-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Boxes className="size-6 text-primary" aria-hidden="true" />
              <h1 className="text-xl sm:text-2xl font-extrabold text-foreground">{t('app.objects.title')}</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{t('app.objects.intro')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              title={t('app.objects.refreshLabel')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-sm font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`size-3.5 ${isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
              {t('app.objects.refresh')}
            </button>
            <Link
              href={`/projects/${projectId}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              {t('app.objects.back')}
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <Metric
            title={t('app.objects.metrics.total')}
            value={data ? fmt.number(data.totalCount) : dash}
            hint={t('app.objects.metrics.totalHint')}
          />
          <Metric
            title={t('app.objects.metrics.compliance')}
            value={stats.compliance === null ? dash : fmt.percent(stats.compliance)}
            hint={t('app.objects.metrics.complianceHint')}
            tone="text-emerald-700 dark:text-emerald-400"
          />
          <Metric
            title={t('app.objects.metrics.classic')}
            value={data ? fmt.number(stats.classic) : dash}
            hint={t('app.objects.metrics.classicHint')}
            tone="text-rose-700 dark:text-rose-400"
          />
          <Metric
            title={t('app.objects.metrics.findings')}
            value={data ? fmt.number(stats.findings) : dash}
            hint={t('app.objects.metrics.findingsHint', { count: stats.affected })}
            tone="text-amber-700 dark:text-amber-400"
          />
        </div>
        {partial && (
          <p className="mt-3 text-sm text-muted-foreground">
            {t('app.objects.metrics.partial', { loaded: fmt.number(objects.length), total: fmt.number(data.totalCount) })}
          </p>
        )}
      </div>

      <DataTable
        columns={columns}
        data={objects}
        tableProps={tableProps}
        getRowId={(row) => row.id}
        enableVirtualization={true}
        virtualHeight="calc(100vh - 360px)"
        estimateRowHeight={() => 54}
        overscan={10}
        facetedFilters={facetedFilters}
        searchPlaceholder={t('app.objects.searchPlaceholder')}
        ariaLabel={t('app.objects.gridLabel')}
        isLoading={isLoading}
        isError={isError}
        error={error as Error}
        onRetry={() => refetch()}
        emptyTitle={t('app.objects.emptyTitle')}
        emptyDescription={t('app.objects.emptyDescription')}
        rowCount={data?.totalCount}
      />

      <ObjectDetailDrawer object={selectedObject} onClose={closeDrawer} />
    </div>
  );
}

function InventoryFallback() {
  const t = useT();
  return <div className="p-12 text-center text-sm text-muted-foreground">{t('app.objects.loading')}</div>;
}

export default function ProjectObjectInventoryPage() {
  return (
    <React.Suspense fallback={<InventoryFallback />}>
      <ProjectObjectInventoryContent />
    </React.Suspense>
  );
}
