'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Download, FileBarChart, FilePlus2, Filter, Loader2, RotateCcw } from 'lucide-react';
import { FormField, FormSelect } from '@/components/form';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useLabel, useT } from '@/i18n/client';
import { fetchAnalyses, fetchProjects } from '@/lib/api-client';
import { fetchReportsHub, orchestrationKeys, type ReportFilters } from '@/lib/api/analysis-orchestration';
import {
  EXPORT_FORMATS,
  REPORT_TYPES,
  downloadReportFile,
  formatBytes,
  generateReport,
  type ReportFormat,
  type ReportTypeId,
} from '@/lib/api/commercial';
import { ErrorState, errorMessage } from '@/components/commercial/states';

const FILTER_KEYS = ['projectId', 'reportType', 'format', 'from', 'to', 'page'] as const;
const FINISHED = new Set(['COMPLETED', 'PARTIAL']);

export default function ReportsRoute() {
  return (
    <React.Suspense fallback={<div className="mx-auto max-w-6xl h-64 rounded-xl bg-muted animate-pulse motion-reduce:animate-none" aria-hidden="true" />}>
      <ReportsHubPage />
    </React.Suspense>
  );
}

function ReportsHubPage() {
  const t = useT();
  const label = useLabel();
  const router = useRouter();
  const pathname = usePathname() || '/reports';
  const searchParams = useSearchParams();
  const [downloadError, setDownloadError] = React.useState<string | null>(null);

  // Filters live in the URL (shareable, back-button friendly).
  const filters: ReportFilters = {
    projectId: searchParams?.get('projectId') || undefined,
    reportType: searchParams?.get('reportType') || undefined,
    format: searchParams?.get('format') || undefined,
    from: searchParams?.get('from') || undefined,
    to: searchParams?.get('to') || undefined,
    page: Math.max(1, Number(searchParams?.get('page') || '1') || 1),
    pageSize: 20,
  };
  const hasFilters = Boolean(filters.projectId || filters.reportType || filters.format || filters.from || filters.to);

  const setFilter = (key: (typeof FILTER_KEYS)[number], value: string | undefined) => {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const projects = useQuery({ queryKey: ['projects'], queryFn: fetchProjects, staleTime: 30_000 });
  const reports = useQuery({
    queryKey: orchestrationKeys.reports(filters as Record<string, unknown>),
    queryFn: () => fetchReportsHub(filters),
    placeholderData: (prev) => prev,
  });

  const download = useMutation({
    mutationFn: ({ id, fileName }: { id: string; fileName: string }) => downloadReportFile(id, fileName),
    onMutate: () => setDownloadError(null),
    onError: (err) => setDownloadError(t('reportsHub.downloadFailed', { message: errorMessage(err) })),
  });

  const projectOptions = [{ value: '', label: t('reportsHub.allProjects') }, ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="border-b border-border pb-4">
        <h1 className="flex items-center gap-2 text-xl font-extrabold text-foreground sm:text-2xl">
          <FileBarChart className="size-6 text-primary" aria-hidden="true" /> {t('reportsHub.title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('reportsHub.subtitle')}</p>
      </header>

      <section aria-labelledby="reports-filters" className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h2 id="reports-filters" className="mb-3 flex items-center gap-1.5 text-sm font-bold">
          <Filter className="size-4" aria-hidden="true" /> {t('reportsHub.filters')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <FormField id="flt-project" label={t('reportsHub.project')}>
            <FormSelect value={filters.projectId ?? ''} onChange={(e) => setFilter('projectId', e.target.value || undefined)} options={projectOptions} data-testid="reports-filter-project" />
          </FormField>
          <FormField id="flt-type" label={t('reportsHub.type')}>
            <FormSelect
              value={filters.reportType ?? ''}
              onChange={(e) => setFilter('reportType', e.target.value || undefined)}
              options={[{ value: '', label: t('reportsHub.allTypes') }, ...REPORT_TYPES.map((r) => ({ value: r, label: label('app.commercial.exports.type', r) }))]}
            />
          </FormField>
          <FormField id="flt-format" label={t('reportsHub.format')}>
            <FormSelect
              value={filters.format ?? ''}
              onChange={(e) => setFilter('format', e.target.value || undefined)}
              options={[{ value: '', label: t('reportsHub.allFormats') }, ...EXPORT_FORMATS.map((f) => ({ value: f, label: label('app.commercial.exports.format', f) }))]}
            />
          </FormField>
          <FormField id="flt-from" label={t('reportsHub.from')}>
            <input type="date" className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm" value={filters.from ?? ''} onChange={(e) => setFilter('from', e.target.value || undefined)} />
          </FormField>
          <FormField id="flt-to" label={t('reportsHub.to')}>
            <input type="date" className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm" value={filters.to ?? ''} onChange={(e) => setFilter('to', e.target.value || undefined)} />
          </FormField>
        </div>
        {hasFilters && (
          <button type="button" onClick={() => router.replace(pathname, { scroll: false })} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary underline">
            <RotateCcw className="size-3.5" aria-hidden="true" /> {t('reportsHub.reset')}
          </button>
        )}
      </section>

      <section aria-label={t('reportsHub.title')} className="rounded-xl border border-border bg-card shadow-sm">
        {downloadError && (
          <p role="alert" className="m-4 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            {downloadError}
          </p>
        )}
        {reports.isLoading ? (
          <div className="space-y-2 p-4" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 rounded-lg bg-muted animate-pulse motion-reduce:animate-none" />
            ))}
          </div>
        ) : reports.isError ? (
          <div className="p-4">
            <ErrorState title={t('reportsHub.loadError')} error={reports.error} onRetry={() => reports.refetch()} />
          </div>
        ) : (reports.data?.items.length ?? 0) === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground" role="status" data-testid="reports-empty">
            {hasFilters ? t('reportsHub.empty') : t('reportsHub.emptyNoFilters')}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs" data-testid="reports-table">
                <thead className="border-b border-border bg-muted/40 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2">{t('reportsHub.colFile')}</th>
                    <th scope="col" className="px-4 py-2">{t('reportsHub.colProject')}</th>
                    <th scope="col" className="px-4 py-2">{t('reportsHub.colType')}</th>
                    <th scope="col" className="px-4 py-2">{t('reportsHub.colFormat')}</th>
                    <th scope="col" className="px-4 py-2">{t('reportsHub.colSize')}</th>
                    <th scope="col" className="px-4 py-2">{t('reportsHub.colCreated')}</th>
                    <th scope="col" className="px-4 py-2"><span className="sr-only">{t('reportsHub.download')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {reports.data!.items.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0" data-testid="report-row" data-report-id={r.id}>
                      <td className="px-4 py-2">
                        <span className="block max-w-[260px] truncate font-medium text-foreground" title={r.fileName}>{r.fileName}</span>
                        <span className="block font-mono text-[10px] text-muted-foreground" title={r.checksumSha256}>
                          {t('reportsHub.colChecksum')} {r.checksumSha256.slice(0, 12)}…
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        {r.projectName}
                        {r.analysisKind === 'FULL_PREFLIGHT' && (
                          <span className="ml-1 rounded border border-border px-1 text-[10px]">{t('reportsHub.fullPreflightTag')}</span>
                        )}
                      </td>
                      <td className="px-4 py-2">{label('app.commercial.exports.type', r.reportType)}</td>
                      <td className="px-4 py-2 font-mono">{r.format}</td>
                      <td className="px-4 py-2">{formatBytes(r.fileSize)}</td>
                      <td className="px-4 py-2">{new Date(r.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => download.mutate({ id: r.id, fileName: r.fileName })}
                          disabled={download.isPending}
                          data-testid="report-download"
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 font-medium hover:bg-muted disabled:opacity-60"
                        >
                          {download.isPending && download.variables?.id === r.id ? (
                            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                          ) : (
                            <Download className="size-3.5" aria-hidden="true" />
                          )}
                          {t('reportsHub.download')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs text-muted-foreground">
              <span>
                {t('reportsHub.pageInfo', {
                  page: reports.data!.pagination.page,
                  pages: reports.data!.pagination.totalPages,
                  total: reports.data!.pagination.total,
                })}
              </span>
              <div className="flex gap-2">
                <button type="button" disabled={filters.page! <= 1} onClick={() => setFilter('page', String(filters.page! - 1))} className="rounded border border-border px-2 py-1 disabled:opacity-50">
                  {t('reportsHub.previous')}
                </button>
                <button
                  type="button"
                  disabled={filters.page! >= reports.data!.pagination.totalPages}
                  onClick={() => setFilter('page', String(filters.page! + 1))}
                  className="rounded border border-border px-2 py-1 disabled:opacity-50"
                >
                  {t('reportsHub.next')}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <GenerateReportForm projects={projects.data ?? []} defaultProjectId={filters.projectId} />
    </div>
  );
}

function DirtyGuard({ isDirty, isSubmitting, children }: { isDirty: boolean; isSubmitting: boolean; children: React.ReactNode }) {
  useUnsavedChangesGuard({ isDirty, isSubmitting });
  return <>{children}</>;
}

/** Generates a report from a finished analysis (reuses the export service). TanStack Form + Zod. */
function GenerateReportForm({ projects, defaultProjectId }: { projects: Array<{ id: string; name: string }>; defaultProjectId?: string }) {
  const t = useT();
  const label = useLabel();
  const queryClient = useQueryClient();
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);
  const schema = React.useMemo(
    () =>
      z.object({
        projectId: z.string().uuid(t('reportsHub.validation.project')),
        analysisId: z.string().uuid(t('reportsHub.validation.analysis')),
        reportType: z.enum(REPORT_TYPES as unknown as [ReportTypeId, ...ReportTypeId[]]),
        format: z.enum(EXPORT_FORMATS),
      }),
    [t]
  );
  type Values = z.infer<typeof schema>;

  const mutation = useMutation({
    mutationFn: (v: Values) => generateReport(v.projectId, v.analysisId, v.format as ReportFormat, v.reportType),
    onSuccess: (res) => {
      setMessage({ ok: true, text: t('reportsHub.generated', { file: res.fileName }) });
      void queryClient.invalidateQueries({ queryKey: ['reports-hub'] });
      void queryClient.invalidateQueries({ queryKey: ['billing', 'overview'] });
    },
    onError: (err) => setMessage({ ok: false, text: t('reportsHub.generateFailed', { message: errorMessage(err) }) }),
  });

  const form = useForm({
    defaultValues: { projectId: defaultProjectId ?? '', analysisId: '', reportType: 'TECHNICAL', format: 'PDF' } as Values,
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setMessage(null);
      await mutation.mutateAsync(value).catch(() => undefined);
      form.reset(value);
    },
  });

  const [projectId, setProjectId] = React.useState(defaultProjectId ?? '');
  const analyses = useQuery({
    queryKey: ['analyses', projectId],
    queryFn: () => fetchAnalyses(projectId),
    enabled: Boolean(projectId),
  });
  const finished = (analyses.data ?? []).filter((a) => FINISHED.has(String(a.status)));

  return (
    <form.Subscribe
      selector={(s) => ({ isDirty: s.isDirty, isSubmitting: s.isSubmitting })}
      children={({ isDirty, isSubmitting }) => (
        <DirtyGuard isDirty={isDirty} isSubmitting={isSubmitting}>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void form.handleSubmit();
            }}
            className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm"
            aria-labelledby="generate-title"
            data-testid="reports-generate"
          >
            <div>
              <h2 id="generate-title" className="flex items-center gap-2 text-sm font-bold text-foreground">
                <FilePlus2 className="size-4 text-primary" aria-hidden="true" /> {t('reportsHub.generateTitle')}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">{t('reportsHub.generateHelp')}</p>
            </div>
            {message && (
              <p role={message.ok ? 'status' : 'alert'} className={`text-xs ${message.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-destructive'}`}>
                {message.text}
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-4">
              <form.Field
                name="projectId"
                children={(field) => (
                  <FormField id="gen-project" name={field.name} label={t('reportsHub.project')} required error={field.state.meta.errors as any}>
                    <FormSelect
                      value={field.state.value}
                      onChange={(e) => {
                        field.handleChange(e.target.value);
                        setProjectId(e.target.value);
                        form.setFieldValue('analysisId', '');
                      }}
                      options={[{ value: '', label: t('analyze.projectPlaceholder') }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
                      data-testid="gen-project"
                    />
                  </FormField>
                )}
              />
              <form.Field
                name="analysisId"
                children={(field) => (
                  <FormField
                    id="gen-analysis"
                    name={field.name}
                    label={t('reportsHub.analysis')}
                    required
                    error={field.state.meta.errors as any}
                    description={projectId && !analyses.isLoading && finished.length === 0 ? t('reportsHub.noAnalyses') : undefined}
                  >
                    <FormSelect
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={!projectId || analyses.isLoading}
                      options={[
                        { value: '', label: t('reportsHub.selectAnalysis') },
                        ...finished.map((a) => ({
                          value: a.id,
                          label: `${a.id.slice(0, 8)} · ${String((a as { kind?: string }).kind ?? 'STANDARD')} · ${a.status} · ${new Date(a.createdAt).toLocaleDateString()}`,
                        })),
                      ]}
                      data-testid="gen-analysis"
                    />
                  </FormField>
                )}
              />
              <form.Field
                name="reportType"
                children={(field) => (
                  <FormField id="gen-type" name={field.name} label={t('reportsHub.type')}>
                    <FormSelect value={field.state.value} onChange={(e) => field.handleChange(e.target.value as ReportTypeId)} options={REPORT_TYPES.map((r) => ({ value: r, label: label('app.commercial.exports.type', r) }))} />
                  </FormField>
                )}
              />
              <form.Field
                name="format"
                children={(field) => (
                  <FormField id="gen-format" name={field.name} label={t('reportsHub.format')}>
                    <FormSelect value={field.state.value} onChange={(e) => field.handleChange(e.target.value as Values['format'])} options={EXPORT_FORMATS.map((f) => ({ value: f, label: label('app.commercial.exports.format', f) }))} />
                  </FormField>
                )}
              />
            </div>
            {analyses.isError && <ErrorState title={t('reportsHub.analysis')} error={analyses.error} onRetry={() => analyses.refetch()} />}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={mutation.isPending}
                data-testid="gen-submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {mutation.isPending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <FilePlus2 className="size-4" aria-hidden="true" />}
                {mutation.isPending ? t('reportsHub.generating') : t('reportsHub.generate')}
              </button>
            </div>
          </form>
        </DirtyGuard>
      )}
    />
  );
}
