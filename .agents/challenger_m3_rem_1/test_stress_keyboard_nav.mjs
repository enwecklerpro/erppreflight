console.log('=== STRESS TEST: Keyboard Navigation across Compound <tbody> Siblings ===\n');

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

// Lightweight Mock DOM node implementation
class MockElement {
  constructor(tagName, attrs = {}) {
    this.tagName = tagName.toUpperCase();
    this.attrs = attrs;
    this.children = [];
    this.parentElement = null;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  getAttribute(name) {
    return this.attrs[name] ?? null;
  }

  setAttribute(name, value) {
    this.attrs[name] = value;
  }

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const siblings = this.parentElement.children;
    const idx = siblings.indexOf(this);
    for (let i = idx + 1; i < siblings.length; i++) {
      if (siblings[i] instanceof MockElement) return siblings[i];
    }
    return null;
  }

  get previousElementSibling() {
    if (!this.parentElement) return null;
    const siblings = this.parentElement.children;
    const idx = siblings.indexOf(this);
    for (let i = idx - 1; i >= 0; i--) {
      if (siblings[i] instanceof MockElement) return siblings[i];
    }
    return null;
  }

  closest(selector) {
    if (selector.toUpperCase() === this.tagName) return this;
    let curr = this.parentElement;
    while (curr) {
      if (curr.tagName === selector.toUpperCase()) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    // Supports 'tr[tabindex="0"]'
    if (selector === 'tr[tabindex="0"]') {
      for (const child of this.children) {
        if (child.tagName === 'TR' && child.getAttribute('tabindex') === '0') {
          return child;
        }
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }
}

// Global document simulation
let activeElement = null;
const mockDocument = {
  get activeElement() {
    return activeElement;
  },
};

// Exact handleKeyDown implementation from data-table.tsx
function createKeyHandler(enableVirtualization, doc = mockDocument) {
  return function handleKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const act = doc.activeElement;
      if (act && act.tagName === 'TR') {
        e.preventDefault();
        let targetTr = null;

        if (enableVirtualization) {
          const currentTbody = act.closest('tbody');
          if (e.key === 'ArrowDown') {
            let nextTbody = currentTbody?.nextElementSibling;
            while (nextTbody) {
              const tr = nextTbody.querySelector('tr[tabindex="0"]');
              if (tr) {
                targetTr = tr;
                break;
              }
              nextTbody = nextTbody.nextElementSibling;
            }
          } else {
            let prevTbody = currentTbody?.previousElementSibling;
            while (prevTbody) {
              const tr = prevTbody.querySelector('tr[tabindex="0"]');
              if (tr) {
                targetTr = tr;
                break;
              }
              prevTbody = prevTbody.previousElementSibling;
            }
          }
        } else {
          let sibling =
            e.key === 'ArrowDown'
              ? act.nextElementSibling
              : act.previousElementSibling;
          while (sibling) {
            if (sibling.tagName === 'TR' && sibling.getAttribute('tabindex') === '0') {
              targetTr = sibling;
              break;
            }
            sibling =
              e.key === 'ArrowDown'
                ? sibling.nextElementSibling
                : sibling.previousElementSibling;
          }
        }

        if (targetTr) {
          targetTr.focus();
        }
      }
    }
  };
}

// -------------------------------------------------------------
// SCENARIO 1: Virtualized Table with Compound <tbody> Siblings
// -------------------------------------------------------------
console.log('--- SCENARIO 1: Virtualized Table (Compound <tbody> elements) ---');

const tableV = new MockElement('table');

// Padding top tbody
const padTopTbody = new MockElement('tbody');
const padTopTr = new MockElement('tr');
padTopTr.appendChild(new MockElement('td'));
padTopTbody.appendChild(padTopTr);
tableV.appendChild(padTopTbody);

// Row 0
const tbody0 = new MockElement('tbody', { 'data-index': '0' });
const tr0 = new MockElement('tr', { tabindex: '0', id: 'row-0' });
tr0.focus = () => { activeElement = tr0; };
tbody0.appendChild(tr0);
tableV.appendChild(tbody0);

// Row 1 (Expanded with details tr)
const tbody1 = new MockElement('tbody', { 'data-index': '1' });
const tr1 = new MockElement('tr', { tabindex: '0', id: 'row-1' });
tr1.focus = () => { activeElement = tr1; };
const tr1Expanded = new MockElement('tr', { id: 'row-1-details' }); // no tabindex!
tr1Expanded.appendChild(new MockElement('td'));
tbody1.appendChild(tr1);
tbody1.appendChild(tr1Expanded);
tableV.appendChild(tbody1);

// Row 2
const tbody2 = new MockElement('tbody', { 'data-index': '2' });
const tr2 = new MockElement('tr', { tabindex: '0', id: 'row-2' });
tr2.focus = () => { activeElement = tr2; };
tbody2.appendChild(tr2);
tableV.appendChild(tbody2);

// Padding bottom tbody
const padBottomTbody = new MockElement('tbody');
const padBottomTr = new MockElement('tr');
padBottomTr.appendChild(new MockElement('td'));
padBottomTbody.appendChild(padBottomTr);
tableV.appendChild(padBottomTbody);

const handleKeyDownV = createKeyHandler(true);

function simulateKey(key, handler) {
  let prevented = false;
  handler({
    key,
    preventDefault: () => { prevented = true; },
  });
  return prevented;
}

// Test 1: Start at row-0, ArrowDown -> row-1
activeElement = tr0;
simulateKey('ArrowDown', handleKeyDownV);
assert(
  activeElement === tr1,
  'ArrowDown navigates from tbody 0 (row-0) to tbody 1 (row-1)',
  `activeElement=${activeElement?.getAttribute('id')}`
);

// Test 2: ArrowDown from row-1 -> row-2 (skipping expanded row tr1Expanded!)
simulateKey('ArrowDown', handleKeyDownV);
assert(
  activeElement === tr2,
  'ArrowDown navigates from tbody 1 to tbody 2 (skips tr1Expanded details row)',
  `activeElement=${activeElement?.getAttribute('id')}`
);

// Test 3: ArrowDown from row-2 -> hits padding bottom, stays at row-2
simulateKey('ArrowDown', handleKeyDownV);
assert(
  activeElement === tr2,
  'ArrowDown at bottom edge cleanly handles padding bottom tbody without moving focus',
  `activeElement=${activeElement?.getAttribute('id')}`
);

// Test 4: ArrowUp from row-2 -> row-1
simulateKey('ArrowUp', handleKeyDownV);
assert(
  activeElement === tr1,
  'ArrowUp navigates from tbody 2 to tbody 1',
  `activeElement=${activeElement?.getAttribute('id')}`
);

// Test 5: ArrowUp from row-1 -> row-0
simulateKey('ArrowUp', handleKeyDownV);
assert(
  activeElement === tr0,
  'ArrowUp navigates from tbody 1 to tbody 0',
  `activeElement=${activeElement?.getAttribute('id')}`
);

// Test 6: ArrowUp at top edge -> hits padding top, stays at row-0
simulateKey('ArrowUp', handleKeyDownV);
assert(
  activeElement === tr0,
  'ArrowUp at top edge cleanly handles padding top tbody without moving focus',
  `activeElement=${activeElement?.getAttribute('id')}`
);

// -------------------------------------------------------------
// SCENARIO 2: Non-Virtualized Standard Table
// -------------------------------------------------------------
console.log('\n--- SCENARIO 2: Non-Virtualized Standard Table ---');

const tableNV = new MockElement('table');
const tbodyNV = new MockElement('tbody');
tableNV.appendChild(tbodyNV);

const nvTr0 = new MockElement('tr', { tabindex: '0', id: 'nv-row-0' });
nvTr0.focus = () => { activeElement = nvTr0; };
const nvTr1 = new MockElement('tr', { tabindex: '0', id: 'nv-row-1' });
nvTr1.focus = () => { activeElement = nvTr1; };
const nvTr1Exp = new MockElement('tr', { id: 'nv-row-1-details' }); // no tabindex
const nvTr2 = new MockElement('tr', { tabindex: '0', id: 'nv-row-2' });
nvTr2.focus = () => { activeElement = nvTr2; };

tbodyNV.appendChild(nvTr0);
tbodyNV.appendChild(nvTr1);
tbodyNV.appendChild(nvTr1Exp);
tbodyNV.appendChild(nvTr2);

const handleKeyDownNV = createKeyHandler(false);

activeElement = nvTr0;
simulateKey('ArrowDown', handleKeyDownNV);
assert(
  activeElement === nvTr1,
  'Non-virtualized: ArrowDown navigates from row-0 to row-1',
  `activeElement=${activeElement?.getAttribute('id')}`
);

simulateKey('ArrowDown', handleKeyDownNV);
assert(
  activeElement === nvTr2,
  'Non-virtualized: ArrowDown skips unindexed expanded row and focuses row-2',
  `activeElement=${activeElement?.getAttribute('id')}`
);

simulateKey('ArrowUp', handleKeyDownNV);
assert(
  activeElement === nvTr1,
  'Non-virtualized: ArrowUp skips unindexed expanded row and focuses row-1',
  `activeElement=${activeElement?.getAttribute('id')}`
);

simulateKey('ArrowUp', handleKeyDownNV);
assert(
  activeElement === nvTr0,
  'Non-virtualized: ArrowUp focuses row-0',
  `activeElement=${activeElement?.getAttribute('id')}`
);

console.log(`\n=== KEYBOARD NAVIGATION RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
