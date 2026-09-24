'use client';

import * as React from 'react';
import { Table } from '@tanstack/react-table';
import {
  X,
  FileSpreadsheet,
  FileJson,
  UserCheck,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { triggerExport } from './export';

export interface DataTableBulkActionsProps<TData> {
  table: Table<TData>;
  serverExportUrl?: string;
  onExport?: (format: 'csv' | 'json', selectedOnly: boolean) => Promise<void> | void;
}

export function DataTableBulkActions<TData>({
  table,
  serverExportUrl,
  onExport,
}: DataTableBulkActionsProps<TData>) {
  const selectedRows = table.getFilteredSelectedRowModel().rows;
  const count = selectedRows.length;

  if (count === 0) return null;

  const handleExport = async (format: 'csv' | 'json') => {
    if (onExport) {
      await onExport(format, true);
    } else {
      await triggerExport({
        table,
        format,
        serverExportUrl,
        selectedOnly: true,
      });
    }
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-2xl border border-border/80 bg-card/95 px-5 py-3 shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom-5 duration-200">
      <div className="flex items-center gap-2 border-r border-border pr-3">
        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
          {count}
        </span>
        <span className="text-xs font-semibold text-foreground select-none">
          selected
        </span>
      </div>

      {/* Export Selected Controls */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => handleExport('csv')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors shadow-xs"
        >
          <FileSpreadsheet className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>Export CSV</span>
        </button>
        <button
          type="button"
          onClick={() => handleExport('json')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors shadow-xs"
        >
          <FileJson className="size-3.5 text-blue-600 dark:text-blue-400" />
          <span>Export JSON</span>
        </button>
      </div>

      <div className="h-4 w-px bg-border" />

      {/* Batch Operations */}
      <button
        type="button"
        onClick={() => {
          alert(`Assign consultant to ${count} findings.`);
        }}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors shadow-xs"
      >
        <UserCheck className="size-3.5 text-primary" />
        <span>Assign</span>
      </button>

      <button
        type="button"
        onClick={() => {
          alert(`Accept Clean Core deviation for ${count} findings.`);
        }}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors shadow-xs"
      >
        <ShieldCheck className="size-3.5 text-amber-600 dark:text-amber-400" />
        <span>Accept Deviation</span>
      </button>

      <button
        type="button"
        onClick={() => {
          alert(`Mark ${count} findings as verified resolved.`);
        }}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors shadow-xs"
      >
        <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        <span>Mark Resolved</span>
      </button>

      <div className="h-4 w-px bg-border" />

      {/* Clear Selection */}
      <button
        type="button"
        onClick={() => table.resetRowSelection()}
        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-label="Clear selection"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
