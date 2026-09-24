import { parseBatchDelimitedInput } from '../../apps/web/src/hooks/pacer/useBatchQueue.ts';

console.log('=== STRESS TEST: parseBatchDelimitedInput Defensive Execution ===\n');

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

// 1. Non-string defensive inputs (should return [] without throwing TypeError)
const nonStringInputs = [
  null,
  undefined,
  123,
  0,
  true,
  false,
  {},
  [],
  Symbol('test'),
  () => {},
];

for (const input of nonStringInputs) {
  try {
    const res = parseBatchDelimitedInput(input);
    assert(
      Array.isArray(res) && res.length === 0,
      `Non-string input ${typeof input} returns [] cleanly`,
      `res=${JSON.stringify(res)}`
    );
  } catch (err) {
    assert(false, `Non-string input ${typeof input} threw error: ${err.message}`);
  }
}

// 2. Whitespace and empty strings
assert(parseBatchDelimitedInput('').length === 0, 'Empty string returns []');
assert(parseBatchDelimitedInput('   \t\r\n   ').length === 0, 'Whitespace-only string returns []');

// 3. SAP enterprise formats
const sapInput = 'MARA, MARC; MARD \n VBAK\r\nVBAP\tLIKP';
const parsed = parseBatchDelimitedInput(sapInput);
assert(
  parsed.length === 6 &&
    parsed.includes('MARA') &&
    parsed.includes('MARC') &&
    parsed.includes('MARD') &&
    parsed.includes('VBAK') &&
    parsed.includes('VBAP') &&
    parsed.includes('LIKP'),
  'Parses mixed comma, semicolon, tab, and newline delimited SAP table names',
  JSON.stringify(parsed)
);

// 4. Deduplication
const dupInput = 'MARA, mara, Mara, MARC, marc';
const deduped = parseBatchDelimitedInput(dupInput);
assert(
  deduped.length === 2 && deduped[0] === 'MARA' && deduped[1] === 'MARC',
  'Case normalization and deduplication works',
  JSON.stringify(deduped)
);

// 5. maxItems cap
const manyItems = Array.from({ length: 50 }, (_, i) => `ITEM_${i}`).join(', ');
const capped = parseBatchDelimitedInput(manyItems, { maxItems: 10 });
assert(
  capped.length === 10,
  'maxItems caps output length',
  `length=${capped.length}`
);

console.log(`\n=== BATCH QUEUE PARSER RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
