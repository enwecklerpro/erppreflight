import { createRequire } from 'module';
import path from 'path';

const require = createRequire(path.resolve('apps/web/package.json'));
const { Virtualizer } = require('@tanstack/react-virtual');

console.log('=== EMPIRICAL TEST: Virtualizer Cache Desynchronization during Sort/Filter ===\n');

// Mock data
let rows = [
  { id: 'row-A', name: 'Item A', height: 52 },
  { id: 'row-B', name: 'Item B', height: 52 },
  { id: 'row-C', name: 'Item C', height: 252 }, // Row C is expanded!
  { id: 'row-D', name: 'Item D', height: 52 },
  { id: 'row-E', name: 'Item E', height: 52 },
];

const element = {
  scrollTop: 0,
  scrollHeight: 2000,
  clientHeight: 500,
  getBoundingClientRect: () => ({ top: 0, bottom: 500, height: 500, width: 800, left: 0, right: 800 }),
  addEventListener: () => {},
  removeEventListener: () => {},
};

// 1. Without getItemKey (current data-table.tsx implementation)
console.log('--- TEST 1: Default Virtualizer (WITHOUT getItemKey) ---');
const vDefault = new Virtualizer({
  count: rows.length,
  getScrollElement: () => element,
  estimateSize: () => 52,
  overscan: 2,
  observeElementRect: (instance, cb) => {
    cb({ width: 800, height: 500 });
    return () => {};
  },
  observeElementOffset: (instance, cb) => {
    cb(0, false);
    return () => {};
  },
});
vDefault._didMount();
vDefault.scrollRect = { width: 800, height: 500 };
vDefault.scrollOffset = 0;

// Simulate ResizeObserver measurement of row-C at index 2
// In virtual-core, resizeItem updates the item size
vDefault.resizeItem(2, 252);

console.log('Before sort:');
console.log('  Item at index 2 (row-C): size =', vDefault.getVirtualItems().find(i => i.index === 2)?.size);
console.log('  Item at index 0 (row-A): size =', vDefault.getVirtualItems().find(i => i.index === 0)?.size);

// Now simulate user sorting descending: rows array is reversed!
// row-C is now at index 2? No, row-E is at 0, row-D at 1, row-C at 2, row-B at 3, row-A at 4.
// Let's sort alphabetically descending:
// row-E (idx 0), row-D (idx 1), row-C (idx 2), row-B (idx 3), row-A (idx 4)
// Let's filter out row-A and row-B:
// rows are now [row-C (idx 0), row-D (idx 1), row-E (idx 2)]
console.log('\nUser filters table: rows becomes [row-C, row-D, row-E]');
rows = [
  { id: 'row-C', name: 'Item C', height: 252 },
  { id: 'row-D', name: 'Item D', height: 52 },
  { id: 'row-E', name: 'Item E', height: 52 },
];
vDefault.setOptions({
  ...vDefault.options,
  count: rows.length,
});

const itemAtIdx0 = vDefault.getVirtualItems().find(i => i.index === 0);
const itemAtIdx2 = vDefault.getVirtualItems().find(i => i.index === 2);
console.log('After filter:');
console.log('  Index 0 (row-C, expanded 252px) allocated virtual size:', itemAtIdx0?.size);
console.log('  Index 2 (row-E, collapsed 52px) allocated virtual size:', itemAtIdx2?.size);

if (itemAtIdx0?.size === 52 && itemAtIdx2?.size === 252) {
  console.log('[FAIL - BUG CONFIRMED] Cache Mismatch! Virtualizer assigned 52px to expanded row-C and 252px to collapsed row-E because keys are integer indices!');
} else {
  console.log('Virtual sizes:', itemAtIdx0?.size, itemAtIdx2?.size);
}

// 2. With getItemKey: (index) => rows[index].id
console.log('\n--- TEST 2: Virtualizer WITH getItemKey = (index) => rows[index].id ---');
let testRows = [
  { id: 'row-A', name: 'Item A', height: 52 },
  { id: 'row-B', name: 'Item B', height: 52 },
  { id: 'row-C', name: 'Item C', height: 252 },
  { id: 'row-D', name: 'Item D', height: 52 },
  { id: 'row-E', name: 'Item E', height: 52 },
];

const vWithKey = new Virtualizer({
  count: testRows.length,
  getScrollElement: () => element,
  estimateSize: () => 52,
  getItemKey: (index) => testRows[index]?.id ?? index,
  overscan: 2,
  observeElementRect: (instance, cb) => {
    cb({ width: 800, height: 500 });
    return () => {};
  },
  observeElementOffset: (instance, cb) => {
    cb(0, false);
    return () => {};
  },
});
vWithKey._didMount();
vWithKey.scrollRect = { width: 800, height: 500 };
vWithKey.scrollOffset = 0;

// Measure row-C (index 2)
vWithKey.resizeItem(2, 252);
console.log('Before filter (item row-C key):', vWithKey.getVirtualItems().find(i => i.key === 'row-C')?.size);

// Filter table:
testRows = [
  { id: 'row-C', name: 'Item C', height: 252 },
  { id: 'row-D', name: 'Item D', height: 52 },
  { id: 'row-E', name: 'Item E', height: 52 },
];
vWithKey.setOptions({
  ...vWithKey.options,
  count: testRows.length,
  getItemKey: (index) => testRows[index]?.id ?? index,
});

const itemC = vWithKey.getVirtualItems().find(i => i.key === 'row-C');
const itemE = vWithKey.getVirtualItems().find(i => i.key === 'row-E');
console.log('After filter with getItemKey:');
console.log('  row-C (index 0) virtual size:', itemC?.size);
console.log('  row-E (index 2) virtual size:', itemE?.size);

if (itemC?.size === 252 && itemE?.size === 52) {
  console.log('[PASS] With getItemKey, measurement cache is preserved and correctly mapped across filter/sort reordering!');
} else {
  console.log('[FAIL] Still mismatched.');
}
