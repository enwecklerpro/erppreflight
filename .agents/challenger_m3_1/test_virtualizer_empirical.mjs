import { createRequire } from 'module';
import path from 'path';

const require = createRequire(path.resolve('apps/web/package.json'));
const { Virtualizer, defaultKeyExtractor } = require('@tanstack/react-virtual');

const element = {
  scrollTop: 0,
  scrollHeight: 2600,
  clientHeight: 500,
  getBoundingClientRect: () => ({ top: 0, bottom: 500, height: 500, width: 800, left: 0, right: 800 }),
  addEventListener: () => {},
  removeEventListener: () => {},
};

const v = new Virtualizer({
  count: 20,
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

v._didMount();
// Also trigger calculateRange / range update:
v.scrollRect = { width: 800, height: 500 };
v.scrollOffset = 0;

console.log('ScrollRect:', v.scrollRect);
console.log('Virtual items length:', v.getVirtualItems().length);
console.log('Total size initially:', v.getTotalSize());

function createMockTbody(index, height) {
  return {
    nodeType: 1,
    tagName: 'TBODY',
    getAttribute: (attr) => (attr === 'data-index' ? String(index) : null),
    getBoundingClientRect: () => ({
      width: 800,
      height: height,
      top: 0,
      bottom: height,
      left: 0,
      right: 800,
    }),
  };
}

console.log('\n--- 1. Baseline measure row 2 at 52px ---');
v.measureElement(createMockTbody(2, 52));
console.log('Total size after 52px:', v.getTotalSize());
console.log('Item 2:', v.getVirtualItems().find(i => i.index === 2));
console.log('Item 3:', v.getVirtualItems().find(i => i.index === 3));

console.log('\n--- 2. Expand row 2 to 252px ---');
v.measureElement(createMockTbody(2, 252));
console.log('Total size after 252px:', v.getTotalSize());
const it2 = v.getVirtualItems().find(i => i.index === 2);
const it3 = v.getVirtualItems().find(i => i.index === 3);
console.log('Item 2 size:', it2?.size, 'start:', it2?.start, 'end:', it2?.end);
console.log('Item 3 size:', it3?.size, 'start:', it3?.start, 'end:', it3?.end);

console.log('\n--- 3. Collapse row 2 back to 52px ---');
v.measureElement(createMockTbody(2, 52));
console.log('Total size after collapse:', v.getTotalSize());
const it2Col = v.getVirtualItems().find(i => i.index === 2);
const it3Col = v.getVirtualItems().find(i => i.index === 3);
console.log('Item 2 size:', it2Col?.size, 'start:', it2Col?.start, 'end:', it2Col?.end);
console.log('Item 3 size:', it3Col?.size, 'start:', it3Col?.start, 'end:', it3Col?.end);
