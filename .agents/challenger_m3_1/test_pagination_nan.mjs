import { createRequire } from 'module';
import path from 'path';

const require = createRequire(path.resolve('apps/web/package.json'));
const {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
} = require('@tanstack/react-table');

console.log('=== EMPIRICAL TEST: TanStack Table Pagination Row Model with NaN ===\n');

// Mock table implementation
const testData = Array.from({ length: 30 }, (_, i) => ({ id: `row-${i}`, name: `Item ${i}` }));

function simulatePagination(pageIndex, pageSize, data) {
  // TanStack getPaginationRowModel logic:
  const pageStart = pageSize * pageIndex;
  const pageEnd = pageStart + pageSize;
  return data.slice(pageStart, pageEnd);
}

console.log('Normal slice (pageIndex: 0, pageSize: 10):');
console.log('Rows count:', simulatePagination(0, 10, testData).length); // 10

console.log('\nMalformed URL parameter ?page=NaN:');
const pageIndexNaN = NaN; // Math.max(1, parseInt('NaN', 10)) - 1 = NaN - 1 = NaN
const slicedNaN = simulatePagination(pageIndexNaN, 10, testData);
console.log('Rows count with pageIndex=NaN:', slicedNaN.length);
if (slicedNaN.length === 0) {
  console.log('[FAIL - CRITICAL BUG] Table displays 0 rows! When URL has ?page=NaN, data.slice(NaN, NaN) returns []!');
}

console.log('\nMalformed URL parameter ?pageSize=NaN:');
const pageSizeNaN = NaN; // Math.max(10, parseInt('NaN', 10)) = NaN
const slicedPageSizeNaN = simulatePagination(0, pageSizeNaN, testData);
console.log('Rows count with pageSize=NaN:', slicedPageSizeNaN.length);
if (slicedPageSizeNaN.length === 0) {
  console.log('[FAIL - CRITICAL BUG] Table displays 0 rows! When URL has ?pageSize=NaN, data.slice(0, NaN) returns []!');
}

console.log('\nMalformed URL parameter ?page=-5:');
const pageNegative = Math.max(1, parseInt('-5', 10)) - 1; // 1 - 1 = 0
console.log('pageIndex for -5:', pageNegative);
console.log('Rows count with page=-5:', simulatePagination(pageNegative, 10, testData).length); // 10 (safe!)

console.log('\nMalformed URL parameter ?pageSize=0:');
const pageSizeZero = Math.max(10, parseInt('0', 10)); // Math.max(10, 0) = 10
console.log('pageSize for 0:', pageSizeZero);
console.log('Rows count with pageSize=0:', simulatePagination(0, pageSizeZero, testData).length); // 10 (safe!)
