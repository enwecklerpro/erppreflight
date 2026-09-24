console.log('=== EMPIRICAL TEST: useTableUrlSync URL Parsing & Edge Cases ===\n');

function parseUrlState(searchParamsStr, defaultPageSize = 50) {
  const searchParams = new URLSearchParams(searchParamsStr);

  const rawPage = parseInt(searchParams.get('page') || '1', 10);
  const page = Math.max(1, rawPage);
  
  const rawPageSize = parseInt(searchParams.get('pageSize') || String(defaultPageSize), 10);
  const pageSize = Math.max(10, rawPageSize);

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
      filters[key] = value.split(',').filter(Boolean);
    }
  });

  // Derived TanStack Table state
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

function check(testName, result, expectationDesc, isSafe) {
  if (isSafe) {
    console.log(`[PASS] ${testName}`);
    console.log(`       Result: ${JSON.stringify(result)}`);
    passed++;
  } else {
    console.error(`[FAIL - BUG FOUND] ${testName}`);
    console.error(`       Expectation: ${expectationDesc}`);
    console.error(`       Actual Result: ${JSON.stringify(result)}`);
    failed++;
  }
}

// Case 1: page = -5
{
  const res = parseUrlState('?page=-5');
  check('page = -5', res.state.page, 'Defaults safely to >= 1', res.state.page === 1 && res.pagination.pageIndex === 0);
}

// Case 2: page = NaN (e.g. ?page=NaN or ?page=abc)
{
  const res = parseUrlState('?page=NaN');
  const isSafe = !Number.isNaN(res.state.page) && !Number.isNaN(res.pagination.pageIndex);
  check('page = NaN (?page=NaN)', res.state.page, 'Should be sanitized to 1, not propagate NaN', isSafe);
}

{
  const res = parseUrlState('?page=abc');
  const isSafe = !Number.isNaN(res.state.page) && !Number.isNaN(res.pagination.pageIndex);
  check('page = string (?page=abc)', res.state.page, 'Should be sanitized to 1, not propagate NaN', isSafe);
}

// Case 3: pageSize = 0
{
  const res = parseUrlState('?pageSize=0');
  check('pageSize = 0', res.state.pageSize, 'Clamped safely to >= 10', res.state.pageSize === 10);
}

// Case 4: pageSize = -100
{
  const res = parseUrlState('?pageSize=-100');
  check('pageSize = -100', res.state.pageSize, 'Clamped safely to >= 10', res.state.pageSize === 10);
}

// Case 5: pageSize = NaN (e.g. ?pageSize=invalid)
{
  const res = parseUrlState('?pageSize=invalid');
  const isSafe = !Number.isNaN(res.state.pageSize) && !Number.isNaN(res.pagination.pageSize);
  check('pageSize = invalid string', res.state.pageSize, 'Should default safely to defaultPageSize (50) or 10, not propagate NaN', isSafe);
}

// Case 6: pageSize = huge number (DoS)
{
  const res = parseUrlState('?pageSize=1000000000');
  const isCapped = res.state.pageSize <= 1000;
  check('pageSize = 1,000,000,000', res.state.pageSize, 'Should be capped to reasonable max (e.g. 500 or 1000)', isCapped);
}

// Case 7: Invalid sort orders (e.g. ?sort=ruleId.bogus)
{
  const res = parseUrlState('?sort=ruleId.bogus');
  // parts[1] === 'desc' ? 'desc' : 'asc' -> defaults to 'asc'
  check('sort order invalid (?sort=ruleId.bogus)', res.state.sortOrder, 'Defaults to asc', res.state.sortOrder === 'asc');
}

// Case 8: Sort with empty column (?sort=.)
{
  const res = parseUrlState('?sort=.');
  // parts = ['', '']
  const isSafe = res.state.sortField !== '' && res.sorting.every(s => s.id !== '');
  check('sort empty column (?sort=.)', res.sorting, 'Should ignore empty sort field', isSafe);
}

// Case 9: Sort without dot (?sort=ruleId)
{
  const res = parseUrlState('?sort=ruleId');
  check('sort without dot (?sort=ruleId)', res.state, 'Defaults sortOrder to asc', res.state.sortField === 'ruleId' && res.state.sortOrder === 'asc');
}

// Case 10: Sort with multiple dots (?sort=ruleId.desc.extra)
{
  const res = parseUrlState('?sort=ruleId.desc.extra');
  check('sort multiple dots', res.state, 'Extracts field and desc', res.state.sortField === 'ruleId' && res.state.sortOrder === 'desc');
}

// Case 11: Unexpected filter strings (?status=,,,,)
{
  const res = parseUrlState('?status=,,,,');
  // value.split(',').filter(Boolean) -> []
  // In columnFilters: [{ id: 'status', value: [] }]
  const hasEmptyFilter = res.columnFilters.some(cf => Array.isArray(cf.value) && cf.value.length === 0);
  check('filter with only commas (?status=,,,,)', res.columnFilters, 'Should not add empty array filter entry', !hasEmptyFilter);
}

// Case 12: Duplicate query keys (?status=OPEN&status=CLOSED)
{
  const res = parseUrlState('?status=OPEN&status=CLOSED');
  // Does it capture both OPEN and CLOSED?
  const statusValues = res.state.filters.status || [];
  const capturedBoth = statusValues.includes('OPEN') && statusValues.includes('CLOSED');
  check('duplicate query keys (?status=OPEN&status=CLOSED)', statusValues, 'Should capture both OPEN and CLOSED', capturedBoth);
}

// Case 13: Prototype pollution attempt (?__proto__=polluted&constructor=bad)
{
  const res = parseUrlState('?__proto__=polluted&constructor=bad');
  const isPolluted = ({}).polluted !== undefined;
  check('prototype pollution check', ({}).polluted, 'Global Object prototype should not be polluted', !isPolluted);
}

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
