'use client';

import * as React from 'react';
import {
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  RowSelectionState,
  ExpandedState,
  PaginationState,
  OnChangeFn,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getExpandedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn, DataTableProps } from './types';
import { DataTableToolbar } from './data-table-toolbar';
import { DataTablePagination } from './data-table-pagination';
import { DataTableBulkActions } from './data-table-bulk-actions';
import {
  DataTableLoadingSkeleton,
  DataTableEmptyState,
  DataTableNoResults,
  DataTableErrorState,
} from './data-table-empty-state';

export function DataTable<TData, TValue = unknown>({
  columns,
  data,
  getRowId,
  enableVirtualization = false,
  virtualHeight = '620px',
  estimateRowHeight = () => 52,
  overscan = 10,
  renderExpandedRow,
  facetedFilters,
  searchColumnId,
  searchPlaceholder,
  bulkActions,
  isLoading = false,
  isError = false,
  error,
  onRetry,
  emptyTitle,
  emptyDescription,
  emptyAction,
  pageCount,
  rowCount,
  serverExportUrl,
  onExport,
  tableProps,
  columnFilters: controlledColumnFilters,
  onColumnFiltersChange: controlledOnColumnFiltersChange,
  sorting: controlledSorting,
  onSortingChange: controlledOnSortingChange,
  pagination: controlledPagination,
  onPaginationChange: controlledOnPaginationChange,
  globalFilter: controlledGlobalFilter,
  onGlobalFilterChange: controlledOnGlobalFilterChange,
}: DataTableProps<TData, TValue>) {
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [expanded, setExpanded] = React.useState<ExpandedState>({});

  // Internal uncontrolled state fallbacks
  const [internalColumnFilters, setInternalColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [internalSorting, setInternalSorting] = React.useState<SortingState>([]);
  const [internalGlobalFilter, setInternalGlobalFilter] = React.useState('');
  const [internalPagination, setInternalPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: enableVirtualization ? Math.max(100, data.length || 100) : 50,
  });

  // Determine active controlled state vs internal state
  const isFiltersControlled =
    controlledColumnFilters !== undefined || tableProps?.columnFilters !== undefined;
  const isSortingControlled =
    controlledSorting !== undefined || tableProps?.sorting !== undefined;
  const isPaginationControlled =
    controlledPagination !== undefined || tableProps?.pagination !== undefined;
  const isGlobalFilterControlled =
    controlledGlobalFilter !== undefined || tableProps?.globalFilter !== undefined;

  const rawColumnFilters =
    controlledColumnFilters ?? tableProps?.columnFilters ?? internalColumnFilters;
  const sorting =
    controlledSorting ?? tableProps?.sorting ?? internalSorting;
  const pagination =
    controlledPagination ?? tableProps?.pagination ?? internalPagination;
  const globalFilter =
    controlledGlobalFilter ?? tableProps?.globalFilter ?? internalGlobalFilter;

  // If searchColumnId is configured and globalFilter / search is active in URL state,
  // ensure the targeted search column's filter value reflects the search query
  const columnFilters = React.useMemo(() => {
    if (searchColumnId && globalFilter) {
      const exists = rawColumnFilters.some((f) => f.id === searchColumnId);
      if (!exists) {
        return [...rawColumnFilters, { id: searchColumnId, value: globalFilter }];
      }
    }
    return rawColumnFilters;
  }, [rawColumnFilters, searchColumnId, globalFilter]);

  // Synchronized change handlers
  const handleColumnFiltersChange: OnChangeFn<ColumnFiltersState> = React.useCallback(
    (updater) => {
      const next = typeof updater === 'function' ? updater(columnFilters) : updater;

      if (searchColumnId) {
        const searchFilter = next.find((f) => f.id === searchColumnId);
        const searchVal = searchFilter ? String(searchFilter.value ?? '') : '';

        // Dispatch search term to global filter handler
        if (controlledOnGlobalFilterChange) {
          controlledOnGlobalFilterChange(searchVal);
        } else if (tableProps?.onGlobalFilterChange) {
          tableProps.onGlobalFilterChange(searchVal);
        } else if (!isGlobalFilterControlled) {
          setInternalGlobalFilter(searchVal);
        }

        // Forward non-search facet filters to columnFilters handler
        const remainingFilters = next.filter((f) => f.id !== searchColumnId);
        if (controlledOnColumnFiltersChange) {
          controlledOnColumnFiltersChange(remainingFilters);
        } else if (tableProps?.onColumnFiltersChange) {
          tableProps.onColumnFiltersChange(remainingFilters);
        } else if (!isFiltersControlled) {
          setInternalColumnFilters(next);
        }
      } else {
        if (controlledOnColumnFiltersChange) {
          controlledOnColumnFiltersChange(updater);
        } else if (tableProps?.onColumnFiltersChange) {
          tableProps.onColumnFiltersChange(updater);
        } else if (!isFiltersControlled) {
          setInternalColumnFilters(updater);
        }
      }
    },
    [
      columnFilters,
      searchColumnId,
      controlledOnGlobalFilterChange,
      tableProps,
      isGlobalFilterControlled,
      controlledOnColumnFiltersChange,
      isFiltersControlled,
    ]
  );

  const handleSortingChange: OnChangeFn<SortingState> = React.useCallback(
    (updater) => {
      if (controlledOnSortingChange) {
        controlledOnSortingChange(updater);
      } else if (tableProps?.onSortingChange) {
        tableProps.onSortingChange(updater);
      } else if (!isSortingControlled) {
        setInternalSorting(updater);
      }
    },
    [controlledOnSortingChange, tableProps, isSortingControlled]
  );

  const handlePaginationChange: OnChangeFn<PaginationState> = React.useCallback(
    (updater) => {
      if (controlledOnPaginationChange) {
        controlledOnPaginationChange(updater);
      } else if (tableProps?.onPaginationChange) {
        tableProps.onPaginationChange(updater);
      } else if (!isPaginationControlled) {
        setInternalPagination(updater);
      }
    },
    [controlledOnPaginationChange, tableProps, isPaginationControlled]
  );

  const handleGlobalFilterChange = React.useCallback(
    (search: string) => {
      if (controlledOnGlobalFilterChange) {
        controlledOnGlobalFilterChange(search);
      } else if (tableProps?.onGlobalFilterChange) {
        tableProps.onGlobalFilterChange(search);
      } else if (!isGlobalFilterControlled) {
        setInternalGlobalFilter(search);
      }
    },
    [controlledOnGlobalFilterChange, tableProps, isGlobalFilterControlled]
  );

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      expanded,
      pagination,
      globalFilter,
    },
    enableRowSelection: true,
    enableMultiSort: true,
    getRowId: getRowId ?? ((row: any) => row.id ?? row.uuid),
    onRowSelectionChange: setRowSelection,
    onSortingChange: handleSortingChange,
    onColumnFiltersChange: handleColumnFiltersChange,
    onColumnVisibilityChange: setColumnVisibility,
    onExpandedChange: setExpanded,
    onPaginationChange: handlePaginationChange,
    onGlobalFilterChange: handleGlobalFilterChange,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: enableVirtualization ? undefined : getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    manualPagination: pageCount !== undefined,
    pageCount: pageCount ?? -1,
    rowCount,
  });

  const tableContainerRef = React.useRef<HTMLDivElement>(null);
  const rows = table.getRowModel().rows;
  const leafColumns = table.getVisibleLeafColumns();
  const columnsCount = leafColumns.length;

  // TanStack Virtual setup for high-volume row sets
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: estimateRowHeight,
    getItemKey: React.useCallback(
      (index: number) => rows[index]?.id ?? index,
      [rows]
    ),
    overscan,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

  // Handle keyboard navigation between rows
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTableElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const activeElement = document.activeElement as HTMLElement | null;
      if (activeElement && activeElement.tagName === 'TR') {
        e.preventDefault();
        let targetTr: HTMLElement | null = null;

        if (enableVirtualization) {
          const currentTbody = activeElement.closest('tbody');
          if (e.key === 'ArrowDown') {
            let nextTbody = currentTbody?.nextElementSibling as HTMLElement | null;
            while (nextTbody) {
              const tr = nextTbody.querySelector<HTMLElement>('tr[tabindex="0"]');
              if (tr) {
                targetTr = tr;
                break;
              }
              nextTbody = nextTbody.nextElementSibling as HTMLElement | null;
            }
          } else {
            let prevTbody = currentTbody?.previousElementSibling as HTMLElement | null;
            while (prevTbody) {
              const tr = prevTbody.querySelector<HTMLElement>('tr[tabindex="0"]');
              if (tr) {
                targetTr = tr;
                break;
              }
              prevTbody = prevTbody.previousElementSibling as HTMLElement | null;
            }
          }
        } else {
          let sibling =
            e.key === 'ArrowDown'
              ? (activeElement.nextElementSibling as HTMLElement | null)
              : (activeElement.previousElementSibling as HTMLElement | null);
          while (sibling) {
            if (sibling.tagName === 'TR' && sibling.getAttribute('tabindex') === '0') {
              targetTr = sibling;
              break;
            }
            sibling =
              e.key === 'ArrowDown'
                ? (sibling.nextElementSibling as HTMLElement | null)
                : (sibling.previousElementSibling as HTMLElement | null);
          }
        }

        if (targetTr) {
          targetTr.focus();
        }
      }
    }
  };

  return (
    <div className="space-y-4 w-full">
      {/* Table Toolbar */}
      <DataTableToolbar
        table={table}
        facetedFilters={facetedFilters}
        searchColumnId={searchColumnId}
        searchPlaceholder={searchPlaceholder}
        serverExportUrl={serverExportUrl}
        onExport={onExport}
      />

      {/* Main Table Container */}
      <div
        ref={enableVirtualization ? tableContainerRef : undefined}
        style={enableVirtualization ? { height: virtualHeight } : undefined}
        className={cn(
          'relative w-full rounded-xl border border-border bg-card shadow-xs focus:outline-none',
          enableVirtualization ? 'overflow-auto' : 'overflow-hidden'
        )}
        tabIndex={0}
        role="region"
        aria-label="Enterprise Data Grid"
      >
        <table
          onKeyDown={handleKeyDown}
          className="w-full text-left text-sm border-collapse"
          role="grid"
          aria-colcount={columnsCount}
          aria-rowcount={rows.length}
        >
          {/* Sticky Table Header */}
          <thead className="sticky top-0 z-20 bg-muted/90 backdrop-blur-xs border-b border-border shadow-xs">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                    className="px-4 py-3 font-semibold text-xs text-muted-foreground uppercase tracking-wider select-none"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          {/* Error State */}
          {isError ? (
            <tbody>
              <tr>
                <td colSpan={columnsCount} className="p-8">
                  <DataTableErrorState error={error} onRetry={onRetry} />
                </td>
              </tr>
            </tbody>
          ) : isLoading ? (
            /* Loading Skeleton State */
            <DataTableLoadingSkeleton columnsCount={columnsCount} rowCount={8} />
          ) : rows.length === 0 ? (
            /* Empty or No-Results State */
            <tbody>
              <tr>
                <td colSpan={columnsCount} className="p-12 text-center">
                  {table.getState().columnFilters.length > 0 || globalFilter ? (
                    <DataTableNoResults
                      onReset={() => {
                        table.resetColumnFilters();
                        table.setGlobalFilter('');
                        handleGlobalFilterChange('');
                      }}
                    />
                  ) : (
                    <DataTableEmptyState
                      title={emptyTitle}
                      description={emptyDescription}
                      action={emptyAction}
                    />
                  )}
                </td>
              </tr>
            </tbody>
          ) : enableVirtualization ? (
            /* Virtualized Compound Row Groups Pattern */
            <>
              {paddingTop > 0 && (
                <tbody>
                  <tr>
                    <td
                      style={{ height: `${paddingTop}px` }}
                      colSpan={columnsCount}
                      aria-hidden="true"
                    />
                  </tr>
                </tbody>
              )}

              {virtualItems.map((virtualRow) => {
                const row = rows[virtualRow.index];
                if (!row) return null;
                const isExpanded = row.getIsExpanded();

                return (
                  <tbody
                    key={row.id}
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    className={cn(
                      'border-b border-border/60 transition-colors',
                      row.getIsSelected() && 'bg-primary/5'
                    )}
                  >
                    {/* Primary Row */}
                    <tr
                      tabIndex={0}
                      role="row"
                      aria-selected={row.getIsSelected()}
                      className={cn(
                        'hover:bg-muted/40 transition-colors group cursor-pointer focus:outline-none focus:bg-muted/60',
                        row.getIsSelected() && 'bg-primary/5'
                      )}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          row.toggleExpanded();
                        } else if (e.key === ' ') {
                          e.preventDefault();
                          row.toggleSelected();
                        }
                      }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          className="px-4 py-3 text-foreground align-middle text-sm"
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>

                    {/* Dynamic Height Expanded Finding Details */}
                    {isExpanded && renderExpandedRow && (
                      <tr className="border-t border-border/40 bg-muted/20">
                        <td colSpan={columnsCount} className="p-4">
                          {renderExpandedRow(row)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}

              {paddingBottom > 0 && (
                <tbody>
                  <tr>
                    <td
                      style={{ height: `${paddingBottom}px` }}
                      colSpan={columnsCount}
                      aria-hidden="true"
                    />
                  </tr>
                </tbody>
              )}
            </>
          ) : (
            /* Standard Non-Virtualized Rows */
            <tbody className="divide-y divide-border">
              {rows.map((row) => {
                const isExpanded = row.getIsExpanded();
                return (
                  <React.Fragment key={row.id}>
                    <tr
                      tabIndex={0}
                      role="row"
                      aria-selected={row.getIsSelected()}
                      className={cn(
                        'hover:bg-muted/40 transition-colors group cursor-pointer focus:outline-none focus:bg-muted/60',
                        row.getIsSelected() && 'bg-primary/5'
                      )}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          row.toggleExpanded();
                        } else if (e.key === ' ') {
                          e.preventDefault();
                          row.toggleSelected();
                        }
                      }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          className="px-4 py-3 text-foreground align-middle text-sm"
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                    {isExpanded && renderExpandedRow && (
                      <tr className="border-t border-border/40 bg-muted/20">
                        <td colSpan={columnsCount} className="p-4">
                          {renderExpandedRow(row)}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          )}
        </table>
      </div>

      {/* Floating Bulk Actions Bar when rows are selected */}
      {table.getFilteredSelectedRowModel().rows.length > 0 &&
        (bulkActions ? (
          bulkActions(table)
        ) : (
          <DataTableBulkActions
            table={table}
            serverExportUrl={serverExportUrl}
            onExport={onExport}
          />
        ))}

      {/* Table Pagination Controls (for non-virtualized or server-windowed grids) */}
      {!enableVirtualization && (
        <DataTablePagination
          table={table}
          pageSizeOptions={pageCount !== undefined ? [10, 25, 50, 100] : undefined}
        />
      )}
    </div>
  );
}

export default DataTable;
