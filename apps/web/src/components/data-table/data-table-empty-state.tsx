'use client';

import * as React from 'react';
import { useErrorText, useT } from '../../i18n/client';
import { AlertCircle, RotateCcw, SearchX, Inbox } from 'lucide-react';

export function DataTableLoadingSkeleton({
  columnsCount,
  rowCount = 6,
}: {
  columnsCount: number;
  rowCount?: number;
}) {
  return (
    <tbody className="divide-y divide-border">
      {Array.from({ length: rowCount }).map((_, rIdx) => (
        <tr key={rIdx} className="animate-pulse bg-card">
          {Array.from({ length: columnsCount }).map((_, cIdx) => (
            <td key={cIdx} className="px-4 py-3.5">
              <div
                className="h-4 rounded bg-muted/80"
                style={{
                  width: `${Math.max(40, ((cIdx * 27 + rIdx * 13) % 90) + 30)}%`,
                }}
              />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function DataTableEmptyState({
  title,
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center max-w-sm mx-auto">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/70 text-muted-foreground mb-3 shadow-xs">
        <Inbox className="size-6 stroke-[1.5]" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title ?? t('app.dataTable.emptyTitle')}</h3>
      <p className="text-xs text-muted-foreground mt-1 mb-4">{description ?? t('app.dataTable.emptyDescription')}</p>
      {action}
    </div>
  );
}

export function DataTableNoResults({ onReset }: { onReset: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center max-w-sm mx-auto">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/70 text-muted-foreground mb-3 shadow-xs">
        <SearchX className="size-6 stroke-[1.5]" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{t('app.dataTable.noResultsTitle')}</h3>
      <p className="text-xs text-muted-foreground mt-1 mb-4">{t('app.dataTable.noResultsDescription')}</p>
      <button
        type="button"
        onClick={onReset}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted shadow-xs transition-colors"
      >
        <RotateCcw className="size-3.5" />
        <span>{t('app.dataTable.resetAllFilters')}</span>
      </button>
    </div>
  );
}

export function DataTableErrorState({
  error,
  onRetry,
}: {
  error?: Error | null;
  onRetry?: () => void;
}) {
  const t = useT();
  const errText = useErrorText();
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-red-50 text-destructive dark:bg-red-950/50 mb-3 shadow-xs">
        <AlertCircle className="size-6 stroke-[1.5]" />
      </div>
      <h3 className="text-sm font-semibold text-destructive">{t('app.dataTable.errorTitle')}</h3>
      <p className="text-xs text-muted-foreground mt-1 mb-4">{error ? errText(error, t('app.dataTable.errorDescription')) : t('app.dataTable.errorDescription')}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 shadow-xs transition-colors"
        >
          <RotateCcw className="size-3.5" />
          <span>{t('app.dataTable.retry')}</span>
        </button>
      )}
    </div>
  );
}
