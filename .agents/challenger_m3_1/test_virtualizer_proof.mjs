import { createRequire } from 'module';
import path from 'path';

const require = createRequire(path.resolve('apps/web/package.json'));
const { Virtualizer, defaultKeyExtractor } = require('@tanstack/react-virtual');

console.log('=== EMPIRICAL PROOF: Virtualizer Missing getItemKey Bug ===\n');

// 1. Without getItemKey (as in DataTable.tsx currently)
const v = new Virtualizer({
  count: 5,
  getScrollElement: () => ({ clientHeight: 500, scrollTop: 0, scrollHeight: 1000, addEventListener: () => {}, removeEventListener: () => {} }),
  estimateSize: () => 52,
});

// Row at index 1 is expanded in the UI.
// ResizeObserver measures index 1 as 250px:
v.resizeItem(1, 250);

console.log('Key extractor in use:', v.options.getItemKey ? v.options.getItemKey.toString() : defaultKeyExtractor.toString());
console.log('itemSizeCache entry for index 1:', v.itemSizeCache.get(1));
console.log('Virtual item 1 size:', v.getVirtualItemForOffset(v.options.estimateSize(0) + 10).size);

// Now user clicks "Sort Descending"
// The row that was at index 1 is now at index 3.
// And index 1 now holds a collapsed row.
// What does itemSizeCache have for index 1?
console.log('After table sort, virtualizer looks up cache for index 1 (which is now a collapsed row):');
console.log('itemSizeCache.get(1) returns:', v.itemSizeCache.get(1));
if (v.itemSizeCache.get(1) === 250) {
  console.log('[CONFIRMED BUG] Index 1 (now a collapsed row) inherits the 250px height from the previous row at index 1!');
}

// And what does itemSizeCache have for index 3 (where the expanded row moved)?
console.log('itemSizeCache.get(3) for the expanded row at index 3 returns:', v.itemSizeCache.get(3));
if (v.itemSizeCache.get(3) === undefined) {
  console.log('[CONFIRMED BUG] Index 3 (the expanded row) has NO cached measurement and reverts to estimateSize (52px), causing truncation/jump!');
}
