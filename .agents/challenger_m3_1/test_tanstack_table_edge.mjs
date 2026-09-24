import {
  createTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
} from '@tanstack/react-table';

console.log('=== EMPIRICAL TEST: TanStack Table with Malformed State ===\n');

const testData = [
  { id: '1', title: 'Finding 1', status: 'OPEN' },
  { id: '2', title: 'Finding 2', status: 'CLOSED' },
  { id: '3', title: 'Finding 3', status: 'IN_REVIEW' },
];

const columns = [
  { accessorKey: 'id', header: 'ID' },
  { accessorKey: 'title', header: 'Title' },
  { accessorKey: 'status', header: 'Status' },
];

// Test 1: What happens with pageIndex = NaN?
console.log('--- Test 1: pageIndex = NaN ---');
try {
  let tableState = {
    pagination: { pageIndex: NaN, pageSize: 10 },
    columnFilters: [],
    sorting: [],
    expanded: {},
  };

  const table = {
    _state: tableState,
  };

  // Let's test getPaginationRowModel with NaN pageIndex
  // In @tanstack/react-table:
  // const { pageIndex, pageSize } = table.getState().pagination
  // const pageStart = pageSize * pageIndex
  // const pageEnd = pageStart + pageSize
  // rows.slice(pageStart, pageEnd)
  const pageStart = 10 * NaN;
  const pageEnd = pageStart + 10;
  const sliced = testData.slice(pageStart, pageEnd);
  console.log(`pageStart: ${pageStart}, pageEnd: ${pageEnd}`);
  console.log(`testData.slice(NaN, NaN) result length: ${sliced.length}`);
  if (sliced.length === 0) {
    console.log('[FAIL - BUG CONFIRMED] pageIndex = NaN results in ZERO rows being rendered! The table is completely blank!');
  }
} catch (e) {
  console.error('[ERROR]', e);
}

// Test 2: What happens with columnFilters = [{ id: 'status', value: [] }]?
console.log('\n--- Test 2: columnFilters with empty array [{ id: "status", value: [] }] ---');
try {
  // Let's test standard faceted filter behavior
  // TanStack faceted filter usually checks:
  // const filterValue = column.getFilterValue() as string[] | undefined
  // if (filterValue?.length) { row passes if filterValue.includes(row.status) }
  // BUT if filter function is default 'includesString' or 'auto':
  const filterVal = [];
  const rowVal = 'OPEN';
  // If a filter function checks Array.isArray(filterValue)
  // Does an empty array filter match anything?
  console.log(`Filter value is empty array []. Array.isArray([]): ${Array.isArray(filterVal)}, length: ${filterVal.length}`);
} catch (e) {
  console.error('[ERROR]', e);
}
