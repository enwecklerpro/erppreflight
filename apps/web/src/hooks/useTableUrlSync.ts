'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import {
  PaginationState,
  SortingState,
  ColumnFiltersState,
  OnChangeFn,
} from '@tanstack/react-table';

export interface TableUrlState {
  page: number;
  pageSize: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  filters: Record<string, string[]>;
}

export function useTableUrlSync(defaultPageSize = 50) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 1. Parse URL search parameters into canonical table state
  const state: TableUrlState = useMemo(() => {
    const parsedPage = parseInt(searchParams.get('page') || '1', 10);
    const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

    const parsedPageSize = parseInt(
      searchParams.get('pageSize') || String(defaultPageSize),
      10
    );
    const pageSize = Number.isFinite(parsedPageSize)
      ? Math.min(500, Math.max(10, parsedPageSize))
      : defaultPageSize;

    const sort = searchParams.get('sort');
    let sortField: string | undefined;
    let sortOrder: 'asc' | 'desc' | undefined;

    if (sort) {
      const parts = sort.split('.');
      sortField = parts[0];
      sortOrder = parts[1] === 'desc' ? 'desc' : 'asc';
    }

    const search = searchParams.get('search') || undefined;
    const filters: Record<string, string[]> = {};

    searchParams.forEach((value, key) => {
      // `finding` / `org` are the notification deep-link target (FocusedFinding), not column filters.
      if (!['page', 'pageSize', 'sort', 'search', 'finding', 'org'].includes(key)) {
        const parts = value.split(',').filter(Boolean);
        if (parts.length > 0) {
          filters[key] = filters[key] ? [...filters[key], ...parts] : parts;
        }
      }
    });

    return { page, pageSize, sortField, sortOrder, search, filters };
  }, [searchParams, defaultPageSize]);

  // 2. Push state updates back into URL search parameters
  const updateUrl = useCallback(
    (newState: Partial<TableUrlState>) => {
      const current = new URLSearchParams(searchParams.toString());

      if (newState.page !== undefined) {
        if (newState.page > 1) current.set('page', String(newState.page));
        else current.delete('page');
      }

      if (newState.pageSize !== undefined) {
        if (newState.pageSize !== defaultPageSize) {
          current.set('pageSize', String(newState.pageSize));
        } else {
          current.delete('pageSize');
        }
      }

      if (newState.sortField !== undefined) {
        if (newState.sortField) {
          current.set('sort', `${newState.sortField}.${newState.sortOrder || 'asc'}`);
        } else {
          current.delete('sort');
        }
      }

      if (newState.search !== undefined) {
        if (newState.search.trim()) current.set('search', newState.search.trim());
        else current.delete('search');
      }

      if (newState.filters) {
        Object.entries(newState.filters).forEach(([key, values]) => {
          if (values && values.length > 0) {
            current.set(key, values.join(','));
          } else {
            current.delete(key);
          }
        });
      }

      router.replace(`${pathname}?${current.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams, defaultPageSize]
  );

  // 3. Derived TanStack Table state adapters
  const pagination: PaginationState = useMemo(
    () => ({
      pageIndex: state.page - 1, // TanStack uses 0-based indexing
      pageSize: state.pageSize,
    }),
    [state.page, state.pageSize]
  );

  const sorting: SortingState = useMemo(() => {
    if (!state.sortField) return [];
    return [{ id: state.sortField, desc: state.sortOrder === 'desc' }];
  }, [state.sortField, state.sortOrder]);

  const columnFilters: ColumnFiltersState = useMemo(() => {
    return Object.entries(state.filters).map(([id, values]) => ({
      id,
      value: values,
    }));
  }, [state.filters]);

  const onPaginationChange: OnChangeFn<PaginationState> = useCallback(
    (updater) => {
      const next = typeof updater === 'function' ? updater(pagination) : updater;
      updateUrl({ page: next.pageIndex + 1, pageSize: next.pageSize });
    },
    [pagination, updateUrl]
  );

  const onSortingChange: OnChangeFn<SortingState> = useCallback(
    (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      if (next.length === 0) {
        updateUrl({ sortField: undefined, sortOrder: undefined });
      } else {
        updateUrl({
          sortField: next[0].id,
          sortOrder: next[0].desc ? 'desc' : 'asc',
          page: 1, // Reset page on sort change
        });
      }
    },
    [sorting, updateUrl]
  );

  const onColumnFiltersChange: OnChangeFn<ColumnFiltersState> = useCallback(
    (updater) => {
      const next = typeof updater === 'function' ? updater(columnFilters) : updater;
      const nextFilters: Record<string, string[]> = {};
      next.forEach((cf) => {
        if (Array.isArray(cf.value)) {
          nextFilters[cf.id] = cf.value;
        } else if (cf.value) {
          nextFilters[cf.id] = [String(cf.value)];
        }
      });
      updateUrl({ filters: nextFilters, page: 1 }); // Reset page on filter change
    },
    [columnFilters, updateUrl]
  );

  const onGlobalFilterChange = useCallback(
    (search: string) => {
      updateUrl({ search, page: 1 });
    },
    [updateUrl]
  );

  const resetAll = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  return {
    state,
    updateUrl,
    resetAll,
    tableProps: {
      pagination,
      sorting,
      columnFilters,
      globalFilter: state.search || '',
      onPaginationChange,
      onSortingChange,
      onColumnFiltersChange,
      onGlobalFilterChange,
    },
  };
}

export default useTableUrlSync;
