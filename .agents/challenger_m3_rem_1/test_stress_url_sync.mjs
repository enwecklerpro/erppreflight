import { createRequire } from 'module';
import path from 'path';

const require = createRequire(path.resolve('apps/web/package.json'));

console.log('=== STRESS TEST: useTableUrlSync URL Parsing & Clamping ===\n');

// Exact implementation of the parsing function from apps/web/src/hooks/useTableUrlSync.ts
function parseTableUrlSyncState(searchParamsStr, defaultPageSize = 50) {
  const searchParams = new URLSearchParams(searchParamsStr);

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
  let sortField;
  let sortOrder;

  if (sort) {
    const parts = sort.split('.');
    sortField = parts[0];
    sortOrder = parts[1] === 'desc' ? 'desc' : 'asc';
  }

  const search = searchParams.get('search') || undefined;
  const filters = {};

  searchParams.forEach((value, key) => {
    if (!['page', 'pageSize', 'sort', 'search'].includes(key)) {
      const parts = value.split(',').filter(Boolean);
      if (parts.length > 0) {
        filters[key] = filters[key] ? [...filters[key], ...parts] : parts;
      }
    }
  });

  const pagination = {
    pageIndex: page - 1,
    pageSize: pageSize,
  };

  const sorting = !sortField ? [] : [{ id: sortField, desc: sortOrder === 'desc' }];

  const columnFilters = Object.entries(filters).map(([id, values]) => ({
    id,
    value: values,
  }));

  return {
    state: { page, pageSize, sortField, sortOrder, search, filters },
    pagination,
    sorting,
    columnFilters,
  };
}

let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`[PASS] ${testName}`);
    passed++;
  } else {
    console.error(`[FAIL] ${testName}: ${details}`);
    failed++;
  }
}

// 1. Test ?page=NaN
{
  const res = parseTableUrlSyncState('?page=NaN');
  assert(
    res.state.page === 1 && res.pagination.pageIndex === 0,
    '?page=NaN defaults to page 1 and pageIndex 0',
    `page=${res.state.page}, pageIndex=${res.pagination.pageIndex}`
  );
}

// 2. Test ?page=invalid
{
  const res = parseTableUrlSyncState('?page=invalid');
  assert(
    res.state.page === 1 && res.pagination.pageIndex === 0,
    '?page=invalid defaults to page 1 and pageIndex 0',
    `page=${res.state.page}, pageIndex=${res.pagination.pageIndex}`
  );
}

// 3. Test ?page=-5
{
  const res = parseTableUrlSyncState('?page=-5');
  assert(
    res.state.page === 1 && res.pagination.pageIndex === 0,
    '?page=-5 defaults to page 1 and pageIndex 0',
    `page=${res.state.page}, pageIndex=${res.pagination.pageIndex}`
  );
}

// 4. Test ?page=0
{
  const res = parseTableUrlSyncState('?page=0');
  assert(
    res.state.page === 1 && res.pagination.pageIndex === 0,
    '?page=0 defaults to page 1 and pageIndex 0',
    `page=${res.state.page}, pageIndex=${res.pagination.pageIndex}`
  );
}

// 5. Test ?pageSize=NaN
{
  const res = parseTableUrlSyncState('?pageSize=NaN');
  assert(
    res.state.pageSize === 50 && res.pagination.pageSize === 50,
    '?pageSize=NaN defaults to defaultPageSize (50)',
    `pageSize=${res.state.pageSize}`
  );
}

// 6. Test ?pageSize=invalid
{
  const res = parseTableUrlSyncState('?pageSize=invalid');
  assert(
    res.state.pageSize === 50 && res.pagination.pageSize === 50,
    '?pageSize=invalid defaults to defaultPageSize (50)',
    `pageSize=${res.state.pageSize}`
  );
}

// 7. Test ?pageSize=-100
{
  const res = parseTableUrlSyncState('?pageSize=-100');
  assert(
    res.state.pageSize === 10 && res.pagination.pageSize === 10,
    '?pageSize=-100 clamped to min 10',
    `pageSize=${res.state.pageSize}`
  );
}

// 8. Test ?pageSize=0
{
  const res = parseTableUrlSyncState('?pageSize=0');
  assert(
    res.state.pageSize === 10 && res.pagination.pageSize === 10,
    '?pageSize=0 clamped to min 10',
    `pageSize=${res.state.pageSize}`
  );
}

// 9. Test ?pageSize=999999
{
  const res = parseTableUrlSyncState('?pageSize=999999');
  assert(
    res.state.pageSize === 500 && res.pagination.pageSize === 500,
    '?pageSize=999999 clamped to max 500',
    `pageSize=${res.state.pageSize}`
  );
}

// 10. Test ?pageSize=250 (within range)
{
  const res = parseTableUrlSyncState('?pageSize=250');
  assert(
    res.state.pageSize === 250 && res.pagination.pageSize === 250,
    '?pageSize=250 preserved within range [10, 500]',
    `pageSize=${res.state.pageSize}`
  );
}

// 11. Test ?status=,,,,
{
  const res = parseTableUrlSyncState('?status=,,,,');
  assert(
    res.state.filters.status === undefined,
    '?status=,,,, does NOT create an entry in filters',
    `filters=${JSON.stringify(res.state.filters)}`
  );
  assert(
    res.columnFilters.length === 0,
    '?status=,,,, leaves columnFilters empty []',
    `columnFilters=${JSON.stringify(res.columnFilters)}`
  );
}

// 12. Test ?status=
{
  const res = parseTableUrlSyncState('?status=');
  assert(
    res.state.filters.status === undefined && res.columnFilters.length === 0,
    '?status= leaves filters empty',
    `columnFilters=${JSON.stringify(res.columnFilters)}`
  );
}

// 13. Test valid filter with extra commas: ?status=,,OPEN,,CLOSED,,
{
  const res = parseTableUrlSyncState('?status=,,OPEN,,CLOSED,,');
  assert(
    res.state.filters.status?.length === 2 &&
      res.state.filters.status.includes('OPEN') &&
      res.state.filters.status.includes('CLOSED'),
    '?status=,,OPEN,,CLOSED,, filters out empty tokens and keeps OPEN, CLOSED',
    `status=${JSON.stringify(res.state.filters.status)}`
  );
  assert(
    res.columnFilters.length === 1 &&
      res.columnFilters[0].id === 'status' &&
      res.columnFilters[0].value.length === 2,
    'columnFilters contains status with 2 values',
    `columnFilters=${JSON.stringify(res.columnFilters)}`
  );
}

// 14. Test pagination row slicing with test dataset
const mockData = Array.from({ length: 100 }, (_, i) => ({ id: `row-${i}` }));

function sliceData(data, pagination) {
  const pageStart = pagination.pageSize * pagination.pageIndex;
  const pageEnd = pageStart + pagination.pageSize;
  return data.slice(pageStart, pageEnd);
}

// Slicing with ?page=NaN:
{
  const res = parseTableUrlSyncState('?page=NaN');
  const sliced = sliceData(mockData, res.pagination);
  assert(
    sliced.length === 50 && sliced[0].id === 'row-0',
    'Table slicing with ?page=NaN correctly displays first 50 rows',
    `sliced.length=${sliced.length}`
  );
}

// Slicing with ?pageSize=999999:
{
  const res = parseTableUrlSyncState('?pageSize=999999');
  const sliced = sliceData(mockData, res.pagination);
  assert(
    sliced.length === 100,
    'Table slicing with ?pageSize=999999 safely returns all 100 rows without memory blowup',
    `sliced.length=${sliced.length}`
  );
}

console.log(`\n=== URL SYNC RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
