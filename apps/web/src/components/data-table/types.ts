import * as React from 'react';
import {
  ColumnDef,
  Row,
  Table,
  ColumnFiltersState,
  SortingState,
  PaginationState,
  OnChangeFn,
} from '@tanstack/react-table';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Utility for merging Tailwind CSS classes safely with clsx.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export interface FilterOption {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  count?: number;
}

export interface FilterDef {
  id: string;
  title: string;
  options: FilterOption[];
  singleSelect?: boolean;
}

export interface TableUrlState {
  page: number;
  pageSize: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  filters: Record<string, string[]>;
}

/**
 * Synchronized table state contract compatible with useTableUrlSync.
 */
export interface DataTableSyncProps {
  pagination?: PaginationState;
  sorting?: SortingState;
  columnFilters?: ColumnFiltersState;
  globalFilter?: string;
  onPaginationChange?: OnChangeFn<PaginationState>;
  onSortingChange?: OnChangeFn<SortingState>;
  onColumnFiltersChange?: OnChangeFn<ColumnFiltersState>;
  onGlobalFilterChange?: (search: string) => void;
}

export interface DataTableProps<TData, TValue = unknown> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Optional unique identifier extractor for rows. Defaults to (row) => row.id */
  getRowId?: (row: TData, index: number) => string;
  /** Enables TanStack Virtual dynamic windowing. Recommended for >100 rows */
  enableVirtualization?: boolean;
  /** Container height for virtualizer viewport (e.g. '600px', 'calc(100vh - 280px)') */
  virtualHeight?: number | string;
  /** Estimated base row height in pixels. Defaults to 52 */
  estimateRowHeight?: (index: number) => number;
  /** Buffer rows rendered above and below viewport. Defaults to 10 */
  overscan?: number;
  /** Optional renderer for dynamic-height expanded detail views */
  renderExpandedRow?: (row: Row<TData>) => React.ReactNode;
  /** Faceted multi-select filter definitions */
  facetedFilters?: FilterDef[];
  /** Column ID to bind search input to. If omitted, global text filtering is used */
  searchColumnId?: string;
  searchPlaceholder?: string;
  /** Custom floating bulk action toolbar renderer when rows are selected */
  bulkActions?: (table: Table<TData>) => React.ReactNode;
  /** Loading state flag displaying layout-matched skeletons */
  isLoading?: boolean;
  /** Error indicator */
  isError?: boolean;
  error?: Error | null;
  /** Retry callback for error states */
  onRetry?: () => void;
  /** Empty state customization */
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  /** Server-side total page count (for Tier 1 server-side pagination) */
  pageCount?: number;
  /** Server-side total row count across all pages */
  rowCount?: number;
  /** Backend endpoint for full-dataset streaming export */
  serverExportUrl?: string;
  /** Custom export trigger override */
  onExport?: (format: 'csv' | 'json', selectedOnly: boolean) => Promise<void> | void;
  /** Optional synchronized tableProps from useTableUrlSync for bidirectional URL synchronization */
  tableProps?: DataTableSyncProps;
  /** Controlled column filters state */
  columnFilters?: ColumnFiltersState;
  /** Controlled column filters change handler */
  onColumnFiltersChange?: OnChangeFn<ColumnFiltersState>;
  /** Controlled sorting state */
  sorting?: SortingState;
  /** Controlled sorting change handler */
  onSortingChange?: OnChangeFn<SortingState>;
  /** Controlled pagination state */
  pagination?: PaginationState;
  /** Controlled pagination change handler */
  onPaginationChange?: OnChangeFn<PaginationState>;
  /** Controlled global filter / search term */
  globalFilter?: string;
  /** Controlled global filter change handler */
  onGlobalFilterChange?: (search: string) => void;
}

