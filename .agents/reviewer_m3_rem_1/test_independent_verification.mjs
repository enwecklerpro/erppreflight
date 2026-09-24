import { escapeCsvCell } from '../../apps/web/src/lib/export.ts';
import { parseBatchDelimitedInput } from '../../apps/web/src/hooks/pacer/useBatchQueue.ts';

console.log('====================================================');
console.log('=== REVIEWER INDEPENDENT VERIFICATION TEST SUITE ===');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function assert(name, condition, details = '') {
  if (condition) {
    console.log(`[PASS] ${name}`);
    passed++;
  } else {
    console.error(`[FAIL] ${name} ${details}`);
    failed++;
  }
}

// ------------------------------------------------------------------
// 1. CSV FORMULA INJECTION & RFC 4180 ESCAPING (apps/web/src/lib/export.ts)
// ------------------------------------------------------------------
console.log('--- 1. Testing escapeCsvCell (CWE-1236 & RFC 4180) ---');

const formulaTests = [
  { input: '=1+1', expectedStart: "'=1+1" },
  { input: '=cmd|\'/C calc\'!A0', expectedStart: "'=cmd" },
  { input: '+12345', expectedStart: "'+12345" },
  { input: '-5+2', expectedStart: "'-5+2" },
  { input: '@SUM(A1:A10)', expectedStart: "'@SUM" },
  { input: '\t=cmd', expectedStart: "'\t=cmd" },
  { input: '\r=cmd', expectedStart: '"\'\r=cmd"' },
  { input: '=HYPERLINK("http://evil.com","click")', expected: '"\'=HYPERLINK(""http://evil.com"",""click"")"' },
];

for (const t of formulaTests) {
  const res = escapeCsvCell(t.input);
  if (t.expected) {
    assert(`Formula injection exact: ${t.input}`, res === t.expected, `got: ${res}, expected: ${t.expected}`);
  } else if (t.expectedStart) {
    assert(`Formula injection prefix: ${t.input}`, res.startsWith(t.expectedStart), `got: ${res}`);
  }
  // Formula trigger check: must not start with =, +, -, @, \t, \r (or "=, "+, etc.)
  const dangerous = /^[=+\-@\t\r]|^"[=+\-@\t\r]/.test(res);
  assert(`Formula neutral for ${t.input}`, !dangerous, `Emitted dangerous prefix: ${res}`);
}

// RFC 4180 compliance
assert('Null returns empty string', escapeCsvCell(null) === '');
assert('Undefined returns empty string', escapeCsvCell(undefined) === '');
assert('Plain alphanumeric untouched', escapeCsvCell('SAP_ERP_2026') === 'SAP_ERP_2026');
assert('Comma triggers quotes', escapeCsvCell('a,b') === '"a,b"');
assert('Double quotes escaped as pair', escapeCsvCell('a"b') === '"a""b"');
assert('Newline triggers quotes', escapeCsvCell('line1\nline2') === '"line1\nline2"');
assert('Object serialized and escaped', escapeCsvCell({ id: 1 }) === '"{\"\"id\"\":1}"');

// ------------------------------------------------------------------
// 2. CSV COLUMN HEADERS ESCAPING
// ------------------------------------------------------------------
console.log('\n--- 2. Testing CSV Column Headers Escaping ---');

const testHeaders = ['Rule, Category', 'Normal', 'Object "Name"', '=FormulaHeader'];
const escapedHeaders = testHeaders.map(escapeCsvCell).join(',');
assert('Header with comma quoted', escapedHeaders.includes('"Rule, Category"'));
assert('Header with quotes double-quoted', escapedHeaders.includes('"Object ""Name"""'));
assert('Header with formula neutral', escapedHeaders.includes("'=FormulaHeader"));

// Parse back using simple CSV tokenizer to verify column count
const tokens = [];
let current = '';
let inQuotes = false;
for (let i = 0; i < escapedHeaders.length; i++) {
  const c = escapedHeaders[i];
  if (c === '"') {
    if (inQuotes && escapedHeaders[i + 1] === '"') {
      current += '"';
      i++;
    } else {
      inQuotes = !inQuotes;
    }
  } else if (c === ',' && !inQuotes) {
    tokens.push(current);
    current = '';
  } else {
    current += c;
  }
}
tokens.push(current);

assert('Escaped header yields exactly 4 columns', tokens.length === 4, `got ${tokens.length}: ${JSON.stringify(tokens)}`);
assert('Token 0 matches unescaped content', tokens[0] === 'Rule, Category');
assert('Token 1 matches unescaped content', tokens[1] === 'Normal');
assert('Token 2 matches unescaped content', tokens[2] === 'Object "Name"');
assert('Token 3 is neutralized formula', tokens[3] === "'=FormulaHeader");

// ------------------------------------------------------------------
// 3. URL PARAMETER SANITIZATION (apps/web/src/hooks/useTableUrlSync.ts)
// ------------------------------------------------------------------
console.log('\n--- 3. Testing useTableUrlSync URL Parsing Logic ---');

function simulateUrlSync(searchParamsString, defaultPageSize = 50) {
  const searchParams = new URLSearchParams(searchParamsString);

  const parsedPage = parseInt(searchParams.get('page') || '1', 10);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  const parsedPageSize = parseInt(
    searchParams.get('pageSize') || String(defaultPageSize),
    10
  );
  const pageSize = Number.isFinite(parsedPageSize)
    ? Math.min(500, Math.max(10, parsedPageSize))
    : defaultPageSize;

  const filters = {};
  searchParams.forEach((value, key) => {
    if (!['page', 'pageSize', 'sort', 'search'].includes(key)) {
      const parts = value.split(',').filter(Boolean);
      if (parts.length > 0) {
        filters[key] = filters[key] ? [...filters[key], ...parts] : parts;
      }
    }
  });

  const columnFilters = Object.entries(filters).map(([id, values]) => ({
    id,
    value: values,
  }));

  const pagination = {
    pageIndex: page - 1,
    pageSize,
  };

  return { page, pageSize, filters, columnFilters, pagination };
}

// NaN and string tests
assert('page=NaN sanitizes to 1', simulateUrlSync('?page=NaN').page === 1);
assert('page=invalid sanitizes to 1', simulateUrlSync('?page=invalid').page === 1);
assert('page=undefined sanitizes to 1', simulateUrlSync('?page=undefined').page === 1);
assert('page=0 sanitizes to 1', simulateUrlSync('?page=0').page === 1);
assert('page=-5 sanitizes to 1', simulateUrlSync('?page=-5').page === 1);
assert('page=1.9 parses to 1', simulateUrlSync('?page=1.9').page === 1);
assert('page=42 returns 42', simulateUrlSync('?page=42').page === 42);
assert('pagination.pageIndex is not NaN for ?page=NaN', !Number.isNaN(simulateUrlSync('?page=NaN').pagination.pageIndex));
assert('pagination.pageIndex is 0 for ?page=NaN', simulateUrlSync('?page=NaN').pagination.pageIndex === 0);

// pageSize clamping tests
assert('pageSize=NaN defaults to 50', simulateUrlSync('?pageSize=NaN').pageSize === 50);
assert('pageSize=invalid defaults to 50', simulateUrlSync('?pageSize=invalid').pageSize === 50);
assert('pageSize=0 clamped to min 10', simulateUrlSync('?pageSize=0').pageSize === 10);
assert('pageSize=-99 clamped to min 10', simulateUrlSync('?pageSize=-99').pageSize === 10);
assert('pageSize=10 returns 10', simulateUrlSync('?pageSize=10').pageSize === 10);
assert('pageSize=250 returns 250', simulateUrlSync('?pageSize=250').pageSize === 250);
assert('pageSize=500 returns 500', simulateUrlSync('?pageSize=500').pageSize === 500);
assert('pageSize=501 clamped to max 500', simulateUrlSync('?pageSize=501').pageSize === 500);
assert('pageSize=1000000 clamped to max 500', simulateUrlSync('?pageSize=1000000').pageSize === 500);

// Filter parts.length > 0 tests
assert('status=,,,, produces no filter entry', simulateUrlSync('?status=,,,,').columnFilters.length === 0);
assert('status= produces no filter entry', simulateUrlSync('?status=').columnFilters.length === 0);
assert('status=,,,OPEN,,, produces clean filter', simulateUrlSync('?status=,,,OPEN,,,').columnFilters.length === 1);
assert('status=OPEN,CLOSED produces 2 items', simulateUrlSync('?status=OPEN,CLOSED').filters.status.length === 2);
assert('duplicate status params merge cleanly', simulateUrlSync('?status=OPEN&status=CLOSED').filters.status.length === 2);

// ------------------------------------------------------------------
// 4. DEFENSIVE RUNTIME VALIDATION (useBatchQueue.ts)
// ------------------------------------------------------------------
console.log('\n--- 4. Testing parseBatchDelimitedInput ---');

// Non-string arguments should return [] without throwing
assert('null returns []', Array.isArray(parseBatchDelimitedInput(null)) && parseBatchDelimitedInput(null).length === 0);
assert('undefined returns []', Array.isArray(parseBatchDelimitedInput(undefined)) && parseBatchDelimitedInput(undefined).length === 0);
assert('number returns [] without error', Array.isArray(parseBatchDelimitedInput(12345)) && parseBatchDelimitedInput(12345).length === 0);
assert('object returns [] without error', Array.isArray(parseBatchDelimitedInput({ a: 1 })) && parseBatchDelimitedInput({ a: 1 }).length === 0);
assert('boolean returns [] without error', Array.isArray(parseBatchDelimitedInput(true)) && parseBatchDelimitedInput(true).length === 0);
assert('empty string returns []', parseBatchDelimitedInput('').length === 0);
assert('whitespace string returns []', parseBatchDelimitedInput('   \n\t  ').length === 0);

// Delimited parsing functionality
const parsed = parseBatchDelimitedInput('MARA, MARC; MARD \n VBAK\tVBAP');
assert('Parsed 5 items from mixed delimiters', parsed.length === 5, `got: ${JSON.stringify(parsed)}`);
assert('Item 0 is MARA', parsed[0] === 'MARA');
assert('Item 3 is VBAK', parsed[3] === 'VBAK');

// Uppercase & Deduplicate
const dupes = parseBatchDelimitedInput('mara, Mara, MARA, MARC');
assert('Deduplicates and uppercases', dupes.length === 2 && dupes[0] === 'MARA' && dupes[1] === 'MARC', `got: ${JSON.stringify(dupes)}`);

// Max items clamp
const many = parseBatchDelimitedInput('A, B, C, D, E', { maxItems: 3 });
assert('MaxItems respected', many.length === 3 && many[2] === 'C', `got: ${JSON.stringify(many)}`);

console.log(`\n====================================================`);
console.log(`=== SUMMARY: ${passed} PASSED, ${failed} FAILED ===`);
console.log(`====================================================`);

if (failed > 0) {
  process.exit(1);
}
