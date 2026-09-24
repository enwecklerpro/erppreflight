import { escapeCsvCell } from '../../apps/web/src/lib/export.ts';
import { parseBatchDelimitedInput } from '../../apps/web/src/hooks/pacer/useBatchQueue.ts';

let passed = 0;
let failed = 0;

function assert(description, actual, expected) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr === expectedStr) {
    console.log(`[PASS] ${description}`);
    passed++;
  } else {
    console.error(`[FAIL] ${description}\n  Expected: ${expectedStr}\n  Actual:   ${actualStr}`);
    failed++;
  }
}

console.log('=== TEST 1: export.ts CSV Escaping and Security ===');
assert('escapeCsvCell null', escapeCsvCell(null), '');
assert('escapeCsvCell undefined', escapeCsvCell(undefined), '');
assert('escapeCsvCell normal string', escapeCsvCell('Normal text'), 'Normal text');
assert('escapeCsvCell with commas', escapeCsvCell('Hello, World'), '"Hello, World"');
assert('escapeCsvCell with quotes', escapeCsvCell('Say "Hello"'), '"Say ""Hello"""');
assert('escapeCsvCell with newlines', escapeCsvCell("Line 1\nLine 2"), "\"Line 1\nLine 2\"");
assert('escapeCsvCell German umlauts', escapeCsvCell('Prüfung & Größe'), 'Prüfung & Größe');
assert('escapeCsvCell German with comma', escapeCsvCell('Größe, Prüfung'), '"Größe, Prüfung"');

// Formula injection checks (CWE-1236)
assert('Formula injection =', escapeCsvCell('=1+1'), "'=1+1");
assert('Formula injection =cmd', escapeCsvCell("=cmd|'/C calc'!A0"), "'=cmd|'/C calc'!A0");
assert('Formula injection +', escapeCsvCell('+12345'), "'+12345");
assert('Formula injection -', escapeCsvCell('-5+2'), "'-5+2");
assert('Formula injection @', escapeCsvCell('@SUM(A1:A10)'), "'@SUM(A1:A10)");
assert('Formula injection tab', escapeCsvCell("\t=cmd"), "'\t=cmd");
assert('Formula injection CR', escapeCsvCell("\r=cmd"), "\"'\\r=cmd\"".replace('\\r', '\r'));

// Double quotes inside formula
assert('Formula injection with quotes', escapeCsvCell('=HYPERLINK("http://evil.com")'), '"\'=HYPERLINK(""http://evil.com"")"');

console.log('\n=== TEST 2: parseBatchDelimitedInput hardening ===');
assert('parseBatchDelimitedInput empty string', parseBatchDelimitedInput(''), []);
assert('parseBatchDelimitedInput whitespace', parseBatchDelimitedInput('   \n\t  '), []);
assert('parseBatchDelimitedInput null input', parseBatchDelimitedInput(null), []);
assert('parseBatchDelimitedInput undefined input', parseBatchDelimitedInput(undefined), []);
assert('parseBatchDelimitedInput number input', parseBatchDelimitedInput(12345), []);
assert('parseBatchDelimitedInput standard SAP', parseBatchDelimitedInput('MARA, MARC; MARD \t VBAK\nVBAP'), ['MARA', 'MARC', 'MARD', 'VBAK', 'VBAP']);
assert('parseBatchDelimitedInput deduplication', parseBatchDelimitedInput('MARA, mara, MARC; mara'), ['MARA', 'MARC']);
assert('parseBatchDelimitedInput maxItems cap', parseBatchDelimitedInput('A, B, C, D, E', { maxItems: 3 }), ['A', 'B', 'C']);

console.log('\n=== TEST 3: useTableUrlSync Parsing Logic Extraction ===');

function simulateUrlSyncParse(searchParamsStr, defaultPageSize = 50) {
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
    pageSize,
  };

  const sorting = !sortField ? [] : [{ id: sortField, desc: sortOrder === 'desc' }];
  const columnFilters = Object.entries(filters).map(([id, values]) => ({
    id,
    value: values,
  }));

  return { state: { page, pageSize, sortField, sortOrder, search, filters }, pagination, sorting, columnFilters };
}

// Check NaN and invalid page parameters
assert('UrlSync page=NaN handled', simulateUrlSyncParse('page=NaN').state.page, 1);
assert('UrlSync page=NaN pagination.pageIndex', simulateUrlSyncParse('page=NaN').pagination.pageIndex, 0);
assert('UrlSync page=abc handled', simulateUrlSyncParse('page=abc').state.page, 1);
assert('UrlSync page=-10 handled', simulateUrlSyncParse('page=-10').state.page, 1);
assert('UrlSync page=0 handled', simulateUrlSyncParse('page=0').state.page, 1);
assert('UrlSync page=5 handled', simulateUrlSyncParse('page=5').state.page, 5);

// Check pageSize clamping and NaN
assert('UrlSync pageSize=NaN handled', simulateUrlSyncParse('pageSize=NaN').state.pageSize, 50);
assert('UrlSync pageSize=abc handled', simulateUrlSyncParse('pageSize=abc').state.pageSize, 50);
assert('UrlSync pageSize=0 clamped to 10', simulateUrlSyncParse('pageSize=0').state.pageSize, 10);
assert('UrlSync pageSize=10000000 clamped to 500', simulateUrlSyncParse('pageSize=10000000').state.pageSize, 500);

// Check empty comma filters
assert('UrlSync status=,,,, produces no filter', simulateUrlSyncParse('status=,,,,').columnFilters, []);
assert('UrlSync status= produces no filter', simulateUrlSyncParse('status=').columnFilters, []);
assert('UrlSync status=OPEN,CLOSED produces valid filter', simulateUrlSyncParse('status=OPEN,CLOSED').columnFilters, [{ id: 'status', value: ['OPEN', 'CLOSED'] }]);
assert('UrlSync status=OPEN&status=CLOSED merges cleanly', simulateUrlSyncParse('status=OPEN&status=CLOSED').columnFilters, [{ id: 'status', value: ['OPEN', 'CLOSED'] }]);

console.log(`\n========================================`);
console.log(`TOTAL: ${passed} passed, ${failed} failed`);
console.log(`========================================`);

if (failed > 0) process.exit(1);
