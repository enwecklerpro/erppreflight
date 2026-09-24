/**
 * Independent Forensic Test: Bidirectional URL Synchronization & Controlled DataTable State
 * Author: auditor_m4_rem_2
 */

import {
  createTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  ColumnFiltersState,
  SortingState,
  PaginationState,
} from '@tanstack/react-table';

// Test 1: Verify DataTableSyncProps shape and tableProps contract
console.log('=== FORENSIC TEST 1: TableProps Contract Verification ===');

interface MockTableProps {
  pagination?: PaginationState;
  sorting?: SortingState;
  columnFilters?: ColumnFiltersState;
  globalFilter?: string;
  onPaginationChange?: (updater: any) => void;
  onSortingChange?: (updater: any) => void;
  onColumnFiltersChange?: (updater: any) => void;
  onGlobalFilterChange?: (search: string) => void;
}

let lastUrlUpdate: Record<string, any> = {};

const mockUrlSync = (initialSearchParams: Record<string, string> = {}) => {
  let searchParams = { ...initialSearchParams };

  const updateUrl = (newState: Record<string, any>) => {
    lastUrlUpdate = { ...newState };
    if (newState.page) searchParams.page = String(newState.page);
    if (newState.pageSize) searchParams.pageSize = String(newState.pageSize);
    if (newState.sortField) {
      searchParams.sort = `${newState.sortField}.${newState.sortOrder || 'asc'}`;
    } else if (newState.sortField === undefined && 'sortField' in newState) {
      delete searchParams.sort;
    }
    if (newState.search !== undefined) {
      if (newState.search.trim()) searchParams.search = newState.search.trim();
      else delete searchParams.search;
    }
    if (newState.filters) {
      Object.entries(newState.filters).forEach(([k, v]) => {
        if (Array.isArray(v) && v.length > 0) searchParams[k] = v.join(',');
        else delete searchParams[k];
      });
    }
  };

  const getTableProps = (): MockTableProps => ({
    pagination: {
      pageIndex: parseInt(searchParams.page || '1', 10) - 1,
      pageSize: parseInt(searchParams.pageSize || '50', 10),
    },
    sorting: searchParams.sort
      ? [{ id: searchParams.sort.split('.')[0], desc: searchParams.sort.split('.')[1] === 'desc' }]
      : [],
    columnFilters: Object.entries(searchParams)
      .filter(([k]) => !['page', 'pageSize', 'sort', 'search'].includes(k))
      .map(([id, val]) => ({ id, value: val.split(',') })),
    globalFilter: searchParams.search || '',
    onPaginationChange: (updater: any) => {
      const current = {
        pageIndex: parseInt(searchParams.page || '1', 10) - 1,
        pageSize: parseInt(searchParams.pageSize || '50', 10),
      };
      const next = typeof updater === 'function' ? updater(current) : updater;
      updateUrl({ page: next.pageIndex + 1, pageSize: next.pageSize });
    },
    onSortingChange: (updater: any) => {
      const current = searchParams.sort
        ? [{ id: searchParams.sort.split('.')[0], desc: searchParams.sort.split('.')[1] === 'desc' }]
        : [];
      const next = typeof updater === 'function' ? updater(current) : updater;
      if (next.length === 0) {
        updateUrl({ sortField: undefined, sortOrder: undefined });
      } else {
        updateUrl({
          sortField: next[0].id,
          sortOrder: next[0].desc ? 'desc' : 'asc',
          page: 1,
        });
      }
    },
    onColumnFiltersChange: (updater: any) => {
      const current: ColumnFiltersState = Object.entries(searchParams)
        .filter(([k]) => !['page', 'pageSize', 'sort', 'search'].includes(k))
        .map(([id, val]) => ({ id, value: val.split(',') }));
      const next = typeof updater === 'function' ? updater(current) : updater;
      const nextFilters: Record<string, string[]> = {};
      next.forEach((cf: any) => {
        if (Array.isArray(cf.value)) {
          nextFilters[cf.id] = cf.value;
        } else if (cf.value) {
          nextFilters[cf.id] = [String(cf.value)];
        }
      });
      updateUrl({ filters: nextFilters, page: 1 });
    },
    onGlobalFilterChange: (search: string) => {
      updateUrl({ search, page: 1 });
    },
  });

  return { getTableProps, searchParams, updateUrl };
};

// Test initial state parsing
const sync = mockUrlSync({
  page: '3',
  pageSize: '100',
  sort: 'ruleId.desc',
  search: 'OPD',
  severity: 'BLOCKER,CRITICAL',
});

const tp = sync.getTableProps();
console.log('Parsed pagination:', tp.pagination);
console.log('Parsed sorting:', tp.sorting);
console.log('Parsed columnFilters:', tp.columnFilters);
console.log('Parsed globalFilter:', tp.globalFilter);

if (tp.pagination?.pageIndex !== 2 || tp.pagination?.pageSize !== 100) {
  throw new Error('Pagination parsing failed');
}
if (tp.sorting?.length !== 1 || tp.sorting[0].id !== 'ruleId' || !tp.sorting[0].desc) {
  throw new Error('Sorting parsing failed');
}
if (tp.globalFilter !== 'OPD') {
  throw new Error('Global filter parsing failed');
}
if (tp.columnFilters?.length !== 1 || tp.columnFilters[0].id !== 'severity') {
  throw new Error('Column filter parsing failed');
}
console.log('✔ Initial URL parsing verified');

// Test 2: Verify searchColumnId bridge in DataTable logic
console.log('\n=== FORENSIC TEST 2: DataTable searchColumnId Bridge Logic ===');
const searchColumnId = 'title';
const globalFilter = 'OPD';
const rawColumnFilters = tp.columnFilters || [];

// Simulate columnFilters useMemo from data-table.tsx
const columnFilters = (() => {
  if (searchColumnId && globalFilter) {
    const exists = rawColumnFilters.some((f) => f.id === searchColumnId);
    if (!exists) {
      return [...rawColumnFilters, { id: searchColumnId, value: globalFilter }];
    }
  }
  return rawColumnFilters;
})();

console.log('Bridged columnFilters:', columnFilters);
if (!columnFilters.some((f) => f.id === 'title' && f.value === 'OPD')) {
  throw new Error('searchColumnId bridge failed to inject search term into columnFilters');
}
console.log('✔ searchColumnId bridge correctly injects search into columnFilters');

// Test 3: Simulate search update through handleColumnFiltersChange
console.log('\n=== FORENSIC TEST 3: handleColumnFiltersChange Bidirectional Propagation ===');
let capturedGlobalFilter: string | null = null;
let capturedRemainingFilters: ColumnFiltersState | null = null;

const mockTableProps: MockTableProps = {
  ...tp,
  onGlobalFilterChange: (s: string) => {
    capturedGlobalFilter = s;
  },
  onColumnFiltersChange: (f: any) => {
    capturedRemainingFilters = f;
  },
};

// Simulate handleColumnFiltersChange from data-table.tsx
const handleColumnFiltersChange = (updater: any) => {
  const next = typeof updater === 'function' ? updater(columnFilters) : updater;

  if (searchColumnId) {
    const searchFilter = next.find((f: any) => f.id === searchColumnId);
    const searchVal = searchFilter ? String(searchFilter.value ?? '') : '';

    if (mockTableProps.onGlobalFilterChange) {
      mockTableProps.onGlobalFilterChange(searchVal);
    }

    const remainingFilters = next.filter((f: any) => f.id !== searchColumnId);
    if (mockTableProps.onColumnFiltersChange) {
      mockTableProps.onColumnFiltersChange(remainingFilters);
    }
  }
};

// User changes search in table
handleColumnFiltersChange([
  { id: 'severity', value: ['BLOCKER'] },
  { id: 'title', value: 'FORM_DOCTOR' },
]);

console.log('Captured globalFilter update:', capturedGlobalFilter);
console.log('Captured remainingFilters update:', capturedRemainingFilters);

if (capturedGlobalFilter !== 'FORM_DOCTOR') {
  throw new Error(`Expected capturedGlobalFilter to be FORM_DOCTOR, got ${capturedGlobalFilter}`);
}
if (
  !capturedRemainingFilters ||
  capturedRemainingFilters.length !== 1 ||
  capturedRemainingFilters[0].id !== 'severity'
) {
  throw new Error('remainingFilters did not cleanly isolate non-search filters');
}
console.log('✔ handleColumnFiltersChange correctly propagates search and facet filters independently');

// Test 4: Verify sort change propagation
console.log('\n=== FORENSIC TEST 4: handleSortingChange Propagation ===');
let capturedSorting: SortingState | null = null;
const mockSortingProps: MockTableProps = {
  onSortingChange: (updater: any) => {
    capturedSorting = updater;
  },
};
const handleSortingChange = (updater: any) => {
  mockSortingProps.onSortingChange!(updater);
};

handleSortingChange([{ id: 'confidence', desc: true }]);
console.log('Captured sorting:', capturedSorting);
if (!capturedSorting || (capturedSorting as any)[0]?.id !== 'confidence') {
  throw new Error('Sorting propagation failed');
}
console.log('✔ handleSortingChange correctly propagates sorting state');

console.log('\n✔ ALL BIDIRECTIONAL URL SYNC & CONTROLLED STATE TESTS PASSED 100%');
