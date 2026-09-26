'use client';

import * as React from 'react';
import { Table } from '@tanstack/react-table';
import { Search, X, FileSpreadsheet, FileJson } from 'lucide-react';
import { FilterDef } from './types';
import { DataTableFacetedFilter } from './data-table-faceted-filter';
import { DataTableViewOptions } from './data-table-view-options';
import { triggerExport } from './export';
import { useT } from '../../i18n/client';

export interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  facetedFilters?: FilterDef[];
  searchColumnId?: string;
  searchPlaceholder?: string;
  serverExportUrl?: string;
  onExport?: (format: 'csv' | 'json', selectedOnly: boolean) => Promise<void> | void;
}

export function DataTableToolbar<TData>({
  table,
  facetedFilters = [],
  searchColumnId,
  searchPlaceholder,
  serverExportUrl,
  onExport,
}: DataTableToolbarProps<TData>) {
  const t = useT();
  const isFiltered =
    table.getState().columnFilters.length > 0 || !!table.getState().globalFilter;

  const searchValue = searchColumnId
    ? (table.getColumn(searchColumnId)?.getFilterValue() as string) ?? ''
    : table.getState().globalFilter ?? '';

  const handleSearchChange = (value: string) => {
    if (searchColumnId) {
      table.getColumn(searchColumnId)?.setFilterValue(value || undefined);
    } else {
      table.setGlobalFilter(value || undefined);
    }
  };

  const handleExport = async (format: 'csv' | 'json') => {
    if (onExport) {
      await onExport(format, false);
    } else {
      await triggerExport({
        table,
        format,
        serverExportUrl,
        selectedOnly: false,
      });
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {/* Left side: Search & Faceted Filter Buttons */}
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            value={searchValue}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={searchPlaceholder ?? t('app.dataTable.filterPlaceholder')}
            className="w-full rounded-lg border border-input bg-background pl-9 pr-8 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
            aria-label={searchPlaceholder ?? t('app.dataTable.filterLabel')}
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => handleSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={t('app.dataTable.clearSearch')}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Faceted Multi-Select Popovers */}
        {facetedFilters.map((filter) => {
          const column = table.getColumn(filter.id);
          if (!column) return null;
          return (
            <DataTableFacetedFilter
              key={filter.id}
              column={column}
              title={filter.title}
              options={filter.options}
              singleSelect={filter.singleSelect}
            />
          );
        })}

        {/* Reset Active Filters Button */}
        {isFiltered && (
          <button
            type="button"
            onClick={() => {
              table.resetColumnFilters();
              table.setGlobalFilter('');
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
          >
            <X className="size-3.5" />
            <span>{t('app.dataTable.reset')}</span>
          </button>
        )}
      </div>

      {/* Right side: Export & Column Visibility Dropdowns */}
      <div className="flex items-center gap-2">
        {/* Export Buttons */}
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5 shadow-xs">
          <button
            type="button"
            onClick={() => handleExport('csv')}
            title={t('app.dataTable.exportCsvTitle')}
            aria-label={t('app.dataTable.exportCsvTitle')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          >
            <FileSpreadsheet className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>CSV</span>
          </button>
          <div className="w-px bg-border my-1" />
          <button
            type="button"
            onClick={() => handleExport('json')}
            title={t('app.dataTable.exportJsonTitle')}
            aria-label={t('app.dataTable.exportJsonTitle')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          >
            <FileJson className="size-3.5 text-blue-600 dark:text-blue-400" />
            <span>JSON</span>
          </button>
        </div>

        {/* Column Visibility Options */}
        <DataTableViewOptions table={table} />
      </div>
    </div>
  );
}
