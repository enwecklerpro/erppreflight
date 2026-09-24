import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

const require = createRequire(path.resolve('apps/web/package.json'));
const { Virtualizer } = require('@tanstack/react-virtual');

console.log('=== STRESS TEST: Virtualizer getItemKey & Cache Coherence ===\n');

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

// 1. Static code verification: check data-table.tsx source code
const dataTableSrc = fs.readFileSync(path.resolve('apps/web/src/components/data-table/data-table.tsx'), 'utf-8');
const hasGetItemKey = dataTableSrc.includes('getItemKey: React.useCallback(') &&
  dataTableSrc.includes('rows[index]?.id ?? index');

assert(
  hasGetItemKey,
  'data-table.tsx supplies getItemKey mapped to rows[index]?.id ?? index to useVirtualizer',
  'Source check failed'
);

// 2. Mock DOM element
const el = {
  scrollTop: 0,
  clientHeight: 500,
  scrollHeight: 1000,
  getBoundingClientRect: () => ({ top: 0, bottom: 500, height: 500, width: 500, left: 0, right: 500 }),
  addEventListener: () => {},
  removeEventListener: () => {},
};

// 3. Negative test: verify that without getItemKey, reverse sort causes cache desynchronization
{
  let unkeyedRows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const vUnkeyed = new Virtualizer({
    count: 3,
    getScrollElement: () => el,
    estimateSize: () => 50,
    observeElementRect: (inst, cb) => { cb({ width: 500, height: 500 }); return () => {}; },
    observeElementOffset: (inst, cb) => { cb(0, false); return () => {}; },
  });
  vUnkeyed._didMount();
  vUnkeyed.scrollRect = { width: 500, height: 500 };
  vUnkeyed.scrollOffset = 0;
  vUnkeyed.getVirtualItems();
  vUnkeyed.resizeItem(2, 250); // row 'c' expanded

  // Reverse sort
  unkeyedRows = [{ id: 'c' }, { id: 'b' }, { id: 'a' }];
  vUnkeyed.setOptions({ ...vUnkeyed.options, count: 3 });
  const items = vUnkeyed.getVirtualItems();
  const cSize = items.find((i) => i.index === 0)?.size;
  const aSize = items.find((i) => i.index === 2)?.size;

  assert(
    cSize === 50 && aSize === 250,
    'Without getItemKey: sizes are swapped onto wrong items (row c gets 50px, row a gets 250px)',
    `cSize=${cSize}, aSize=${aSize}`
  );
}

// 4. Positive test: verify that with getItemKey, reverse sort preserves height on correct row
{
  let keyedRows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const vKeyed = new Virtualizer({
    count: 3,
    getScrollElement: () => el,
    estimateSize: () => 50,
    getItemKey: (i) => keyedRows[i]?.id ?? i,
    observeElementRect: (inst, cb) => { cb({ width: 500, height: 500 }); return () => {}; },
    observeElementOffset: (inst, cb) => { cb(0, false); return () => {}; },
  });
  vKeyed._didMount();
  vKeyed.scrollRect = { width: 500, height: 500 };
  vKeyed.scrollOffset = 0;
  vKeyed.getVirtualItems();
  vKeyed.resizeItem(2, 250); // row 'c' expanded

  const beforeItems = vKeyed.getVirtualItems();
  const beforeC = beforeItems.find((i) => i.key === 'c');
  assert(
    beforeC?.size === 250,
    'With getItemKey: row c has measured size 250px before sort',
    `size=${beforeC?.size}`
  );

  // Reverse sort: [c, b, a]
  keyedRows = [{ id: 'c' }, { id: 'b' }, { id: 'a' }];
  vKeyed.setOptions({
    ...vKeyed.options,
    count: 3,
    getItemKey: (i) => keyedRows[i]?.id ?? i,
  });
  const afterItems = vKeyed.getVirtualItems();
  const afterC = afterItems.find((i) => i.key === 'c');
  const afterB = afterItems.find((i) => i.key === 'b');
  const afterA = afterItems.find((i) => i.key === 'a');

  assert(
    afterC?.index === 0 && afterC?.size === 250,
    'With getItemKey: row c at index 0 preserves 250px size after sort',
    `c index=${afterC?.index}, size=${afterC?.size}`
  );

  assert(
    afterB?.index === 1 && afterB?.size === 50,
    'With getItemKey: row b at index 1 preserves 50px estimate after sort',
    `b index=${afterB?.index}, size=${afterB?.size}`
  );

  assert(
    afterA?.index === 2 && afterA?.size === 50,
    'With getItemKey: row a at index 2 preserves 50px estimate after sort',
    `a index=${afterA?.index}, size=${afterA?.size}`
  );
}

// 5. Positive test: Filter rows with getItemKey
{
  let rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const v = new Virtualizer({
    count: 4,
    getScrollElement: () => el,
    estimateSize: () => 50,
    getItemKey: (i) => rows[i]?.id ?? i,
    observeElementRect: (inst, cb) => { cb({ width: 500, height: 500 }); return () => {}; },
    observeElementOffset: (inst, cb) => { cb(0, false); return () => {}; },
  });
  v._didMount();
  v.scrollRect = { width: 500, height: 500 };
  v.scrollOffset = 0;
  v.getVirtualItems();
  v.resizeItem(2, 300); // row 'c' expanded to 300px

  // Filter to keep only 'c' and 'd'
  rows = [{ id: 'c' }, { id: 'd' }];
  v.setOptions({
    ...v.options,
    count: 2,
    getItemKey: (i) => rows[i]?.id ?? i,
  });

  const filteredItems = v.getVirtualItems();
  const cItem = filteredItems.find((i) => i.key === 'c');
  const dItem = filteredItems.find((i) => i.key === 'd');

  assert(
    cItem?.index === 0 && cItem?.size === 300,
    'With getItemKey: filtered list preserves row c at index 0 with 300px',
    `c index=${cItem?.index}, size=${cItem?.size}`
  );
  assert(
    dItem?.index === 1 && dItem?.size === 50,
    'With getItemKey: filtered list preserves row d at index 1 with 50px',
    `d index=${dItem?.index}, size=${dItem?.size}`
  );
}

console.log(`\n=== VIRTUALIZER RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
