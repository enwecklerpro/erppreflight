import { createRequire } from 'module';
import path from 'path';

const require = createRequire(path.resolve('apps/web/package.json'));
const {
  getCoreRowModel,
  getFilteredRowModel,
} = require('@tanstack/react-table');

console.log('=== EMPIRICAL TEST: TanStack Table Filtering with Empty Array [] ===\n');

// Mock table with filter
const testRows = [
  { id: '1', status: 'OPEN' },
  { id: '2', status: 'CLOSED' },
];

// Let's test default filter functions
// In TanStack Table, default filterFn is 'auto' (includesString for strings, arrIncludes for arrays)
// If filterValue is [], what does filterFn return?
const filterFn = (row, columnId, filterValue) => {
  // If faceted filter uses arrIncludes:
  if (Array.isArray(filterValue)) {
    if (filterValue.length === 0) return true; // Or false?
    return filterValue.includes(row[columnId]);
  }
  return true;
};

// But what if column filter is default 'auto' / 'includesString'?
// In TanStack Table filterFns.arrIncludesSome:
const arrIncludesSome = (row, columnId, filterValue) => {
  return filterValue.some(val => val === row[columnId]);
};

console.log('If filterFns.arrIncludesSome is used with filterValue = []:');
const filtered = testRows.filter(r => arrIncludesSome(r, 'status', []));
console.log('Rows matching []:', filtered.length);
if (filtered.length === 0) {
  console.log('[FAIL - BUG CONFIRMED] When URL has ?status=,,,, filterValue is []. If arrIncludesSome is used, 0 rows match! Table displays empty!');
}
