// Test the virtualizer key extractor behavior
const rowsBeforeSort = [
  { id: 'row-1', title: 'Row 1', expanded: true },
  { id: 'row-2', title: 'Row 2', expanded: false },
];

const getItemKey = (rows) => (index) => rows[index]?.id ?? index;

const keyFnBefore = getItemKey(rowsBeforeSort);
console.log('Key for index 0 before sort:', keyFnBefore(0)); // 'row-1'
console.log('Key for index 1 before sort:', keyFnBefore(1)); // 'row-2'

// Simulate sort (descending order)
const rowsAfterSort = [
  { id: 'row-2', title: 'Row 2', expanded: false },
  { id: 'row-1', title: 'Row 1', expanded: true },
];

const keyFnAfter = getItemKey(rowsAfterSort);
console.log('Key for index 0 after sort:', keyFnAfter(0)); // 'row-2'
console.log('Key for index 1 after sort:', keyFnAfter(1)); // 'row-1'

// Mock size cache keyed by getItemKey
const sizeCache = new Map();
sizeCache.set(keyFnBefore(0), 300); // row-1 measured at 300px
sizeCache.set(keyFnBefore(1), 52);  // row-2 measured at 52px

// Lookup after sort:
const sizeRow2After = sizeCache.get(keyFnAfter(0)); // row-2 at index 0
const sizeRow1After = sizeCache.get(keyFnAfter(1)); // row-1 at index 1

console.log('Size for index 0 (row-2) after sort:', sizeRow2After);
console.log('Size for index 1 (row-1) after sort:', sizeRow1After);

if (sizeRow2After === 52 && sizeRow1After === 300) {
  console.log('[PASS] Virtualizer cache correctly tracks row identity across sort!');
} else {
  console.error('[FAIL] Virtualizer cache swapped or lost!');
  process.exit(1);
}
