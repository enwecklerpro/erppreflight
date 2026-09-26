'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Download, FileJson, FileSpreadsheet, FileText, Globe, Loader2, Table2 } from 'lucide-react';
import { ErrorState, InlineSpinner, SkeletonBlock, useCommercialErrorText } from '@/components/commercial/states';
import { useFmt, useLabel, useT } from '@/i18n/client';
import {
  EXPORT_FORMATS,
  REPORT_TYPES,
  downloadReportFile,
  fetchAnalysisReports,
  generateReport,
  type ReportFormat,
  type ReportTypeId,
} from '@/lib/api/commercial';
import { ApiError } from '@/lib/api/custom-instance';

const FORMAT_ICONS: Record<ReportFormat, React.ComponentType<{ className?: string }>> = {
  PDF: FileText,
  XLSX: FileSpreadsheet,
  CSV: Table2,
  JSON_BUNDLE: FileJson,
  HTML_OFFLINE: Globe,
  ZIP_ALL: Archive,
};

/**
 * Report exports for one analysis: generate any format (incl. ZIP_ALL) and
 * download it through the authenticated API; lists previously generated reports.
 */
export function ReportExportPanel({ projectId, analysisId }: { projectId: string; analysisId: string }) {
  const t = useT();
  const label = useLabel();
  const fmt = useFmt();
  const errorText = useCommercialErrorText();
  const queryClient = useQueryClient();
  const [reportType, setReportType] = React.useState<ReportTypeId>('TECHNICAL');
  const [lastMessage, setLastMessage] = React.useState<string | null>(null);
  const reportsKey = ['reports', projectId, analysisId];

  const reports = useQuery({
    queryKey: reportsKey,
    queryFn: () => fetchAnalysisReports(projectId, analysisId),
  });

  const exportMutation = useMutation({
    mutationFn: async (format: ReportFormat) => {
      const created = await generateReport(projectId, analysisId, format, reportType);
      await downloadReportFile(created.reportId, created.fileName);
      return created;
    },
    onSuccess: (created) => {
      setLastMessage(t('app.commercial.exports.done', { file: created.fileName }));
      queryClient.invalidateQueries({ queryKey: reportsKey });
      queryClient.invalidateQueries({ queryKey: ['billing', 'overview'] });
    },
  });

  const redownload = useMutation({
    mutationFn: ({ id, fileName }: { id: string; fileName: string }) => downloadReportFile(id, fileName),
  });

  const limitHit = exportMutation.error instanceof ApiError && exportMutation.error.statusCode === 402;

  return (
    <section
      className="mt-3 rounded-lg border border-border bg-muted/20 p-4 space-y-4"
      aria-label={t('app.commercial.exports.panelLabel', { id: analysisId.slice(0, 8) })}
      data-testid={`export-panel-${analysisId}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <label className="text-sm font-medium text-foreground flex flex-col gap-1">
          {t('app.commercial.exports.reportType')}
          <select
            value={reportType}
            onChange={(e) => setReportType(e.target.value as ReportTypeId)}
            className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
            data-testid="report-type-select"
          >
            {REPORT_TYPES.map((type) => (
              <option key={type} value={type}>
                {label('app.commercial.exports.type', type)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('app.commercial.exports.formatGroup')}>
          {EXPORT_FORMATS.map((format) => {
            const Icon = FORMAT_ICONS[format];
            const pending = exportMutation.isPending && exportMutation.variables === format;
            return (
              <button
                key={format}
                type="button"
                onClick={() => {
                  setLastMessage(null);
                  exportMutation.mutate(format);
                }}
                disabled={exportMutation.isPending}
                data-testid={`export-${format}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                {pending ? (
                  <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <Icon className="size-3.5" aria-hidden="true" />
                )}
                {label('app.commercial.exports.format', format)}
              </button>
            );
          })}
        </div>
      </div>

      <div aria-live="polite">
        {exportMutation.isPending && <InlineSpinner label={t('app.commercial.exports.generating')} />}
        {lastMessage && !exportMutation.isPending && (
          <p className="text-sm text-foreground" role="status" data-testid="export-status">
            {lastMessage}
          </p>
        )}
        {exportMutation.isError && (
          <ErrorState
            title={limitHit ? t('app.commercial.exports.limitTitle') : t('app.commercial.exports.failed')}
            error={
              limitHit
                ? new Error(`${errorText(exportMutation.error)} ${t('app.commercial.exports.limitHint')}`)
                : exportMutation.error
            }
          />
        )}
      </div>

      <div>
        <h4 className="text-sm font-semibold text-foreground mb-2">{t('app.commercial.exports.previous')}</h4>
        {reports.isLoading ? (
          <SkeletonBlock className="h-16" />
        ) : reports.isError ? (
          <ErrorState title={t('app.commercial.exports.previousError')} error={reports.error} onRetry={() => reports.refetch()} />
        ) : reports.data && reports.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('app.commercial.exports.none')}</p>
        ) : (
          <ul className="divide-y divide-border text-xs" data-testid="report-history">
            {reports.data?.map((r) => (
              <li key={r.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-semibold">{r.format}</span>{' '}
                  <span className="text-muted-foreground">
                    · {label('app.commercial.exports.type', r.reportType)} · {fmt.bytes(r.fileSize)} ·{' '}
                    {fmt.dateTime(r.createdAt)}
                  </span>
                  {r.checksumSha256 && (
                    <span className="block font-mono text-[10px] text-muted-foreground break-all">sha256 {r.checksumSha256}</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => redownload.mutate({ id: r.id, fileName: r.fileName })}
                  disabled={redownload.isPending}
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 hover:bg-muted disabled:opacity-50"
                  aria-label={t('app.commercial.exports.downloadLabel', { file: r.fileName })}
                >
                  <Download className="size-3" aria-hidden="true" /> {t('app.commercial.exports.download')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {redownload.isError && <p role="alert" className="text-xs text-destructive mt-1">{errorText(redownload.error)}</p>}
      </div>
    </section>
  );
}

export default ReportExportPanel;
