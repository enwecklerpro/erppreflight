'use client';

import * as React from 'react';
import { Table } from '@tanstack/react-table';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { useT } from '../../i18n/client';

export interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  pageSizeOptions?: number[];
}

export function DataTablePagination<TData>({
  table,
  pageSizeOptions = [10, 25, 50, 100, 250],
}: DataTablePaginationProps<TData>) {
  const t = useT();
  const selectedCount = table.getFilteredSelectedRowModel().rows.length;
  const totalFilteredCount = table.getFilteredRowModel().rows.length;
  // With server-side pagination the table only holds the current page;
  // report the server-provided total instead.
  const totalRecordCount = table.options.manualPagination
    ? table.getRowCount()
    : totalFilteredCount;
  const pageIndex = table.getState().pagination.pageIndex;
  const pageSize = table.getState().pagination.pageSize;
  const pageCount = table.getPageCount();

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-2 py-1 text-xs text-muted-foreground">
      {/* Selected Rows Counter */}
      <div className="flex-1 select-none">
        {selectedCount > 0 ? (
          <span className="font-medium text-foreground">
            {t('app.dataTable.selectedOf', { selected: selectedCount, total: totalFilteredCount })}
          </span>
        ) : (
          <span>{t('app.dataTable.totalRecords', { count: totalRecordCount })}</span>
        )}
      </div>

      {/* Page Size & Navigation Controls */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <label htmlFor="page-size-select" className="select-none font-medium">
            {t('app.dataTable.rowsPerPage')}
          </label>
          <select
            id="page-size-select"
            value={pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
            className="rounded-md border border-input bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary shadow-xs cursor-pointer"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        {/* Page Index Indicator */}
        <div className="select-none font-medium text-foreground min-w-[5rem] text-center">
          {t('app.dataTable.pageOf', { page: pageCount === 0 ? 0 : pageIndex + 1, pages: Math.max(1, pageCount) })}
        </div>

        {/* Pager Action Buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
            aria-label={t('app.dataTable.firstPage')}
            className="p-1.5 rounded-md border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-xs"
          >
            <ChevronsLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label={t('app.dataTable.previousPage')}
            className="p-1.5 rounded-md border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-xs"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label={t('app.dataTable.nextPage')}
            className="p-1.5 rounded-md border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-xs"
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
            aria-label={t('app.dataTable.lastPage')}
            className="p-1.5 rounded-md border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-xs"
          >
            <ChevronsRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
