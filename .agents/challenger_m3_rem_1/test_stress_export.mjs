import { escapeCsvCell, exportRawData } from '../../apps/web/src/lib/export.ts';

const results = [];

function assert(condition, testName, details = '') {
  if (condition) {
    results.push({ testName, status: 'PASS', details });
    console.log(`[PASS] ${testName}`);
  } else {
    results.push({ testName, status: 'FAIL', details });
    console.error(`[FAIL] ${testName}: ${details}`);
  }
}

console.log('--- STRESS TESTING escapeCsvCell & CSV Export ---');

// Test 1: Standard formula payloads requested in mission
const formulaPayloads = [
  '=1+1',
  "=cmd|'/C calc'!A0",
  '@SUM(A1:A10)',
  '+12345',
  '-5+2',
  '\t=cmd',
  '\r=cmd',
];

for (const payload of formulaPayloads) {
  const escaped = escapeCsvCell(payload);
  // It must start with single quote ' (either directly or inside double quotes if quoted)
  // If quoted: e.g. "'\r=cmd" -> starts with '"\''
  const isNeutralized = escaped.startsWith("'") || escaped.startsWith('"\'');
  assert(
    isNeutralized,
    `Formula injection neutralized: ${JSON.stringify(payload)}`,
    `Got: ${JSON.stringify(escaped)}`
  );
}

// Additional adversarial formula injection payloads
const adversarialPayloads = [
  '=HYPERLINK("http://evil.com","Click")',
  '+A1+B1',
  '-A1*B1',
  '@AVERAGE(A1:A10)',
  '\tcalc',
  '\rcalc',
  '=2+5*cmd|\' /C calc\'!A0',
  '-2+3*[1]!A1',
  '+4+5*[1]!A1',
];

for (const payload of adversarialPayloads) {
  const escaped = escapeCsvCell(payload);
  const isNeutralized = escaped.startsWith("'") || escaped.startsWith('"\'');
  assert(
    isNeutralized,
    `Adversarial formula payload neutralized: ${JSON.stringify(payload)}`,
    `Got: ${JSON.stringify(escaped)}`
  );
}

// Test normal inputs are not corrupted
assert(escapeCsvCell('Hello World') === 'Hello World', 'Plain string untouched', escapeCsvCell('Hello World'));
assert(escapeCsvCell(12345) === '12345', 'Plain number untouched', escapeCsvCell(12345));
assert(escapeCsvCell(null) === '', 'Null returns empty', escapeCsvCell(null));
assert(escapeCsvCell(undefined) === '', 'Undefined returns empty', escapeCsvCell(undefined));
assert(escapeCsvCell('Simple, with comma') === '"Simple, with comma"', 'Comma quotes cell', escapeCsvCell('Simple, with comma'));
assert(escapeCsvCell('With "quotes"') === '"With ""quotes"""', 'Quotes escaped with double quotes', escapeCsvCell('With "quotes"'));
assert(escapeCsvCell('Multi\r\nLine') === '"Multi\r\nLine"', 'Multiline preserved and quoted', escapeCsvCell('Multi\r\nLine'));

// Test RFC 4180 escaping on formula with comma/quotes
const formulaWithQuotes = '=HYPERLINK("http://attacker.com","Link")';
const escapedFormulaQuotes = escapeCsvCell(formulaWithQuotes);
assert(
  escapedFormulaQuotes === '"\'=HYPERLINK(""http://attacker.com"",""Link"")"',
  'Formula with quotes properly neutralized AND RFC4180 escaped',
  escapedFormulaQuotes
);

// Test 2: CSV headers with commas and quotes
console.log('\n--- TESTING CSV Headers Escaping ---');

const testHeaders = [
  'Rule, Category',
  'SAP Object "Type"',
  'Standard, Clean, Core',
  'NormalHeader',
  '=FormulaHeader',
];

const escapedHeaders = testHeaders.map(escapeCsvCell);

assert(
  escapedHeaders[0] === '"Rule, Category"',
  'Header with comma quoted',
  escapedHeaders[0]
);
assert(
  escapedHeaders[1] === '"SAP Object ""Type"""',
  'Header with quotes escaped',
  escapedHeaders[1]
);
assert(
  escapedHeaders[2] === '"Standard, Clean, Core"',
  'Header with multiple commas quoted',
  escapedHeaders[2]
);
assert(
  escapedHeaders[3] === 'NormalHeader',
  'Normal header untouched',
  escapedHeaders[3]
);
assert(
  escapedHeaders[4] === "'=FormulaHeader",
  'Formula header neutralized',
  escapedHeaders[4]
);

const joinedHeaders = escapedHeaders.join(',');
// Splitting by comma respecting quotes should yield exactly 5 items
// Let's verify no column misalignment
assert(
  joinedHeaders === '"Rule, Category","SAP Object ""Type""","Standard, Clean, Core",NormalHeader,\'=FormulaHeader',
  'Headers joined correctly without column shift',
  joinedHeaders
);

console.log('\nSummary:');
const fails = results.filter((r) => r.status === 'FAIL');
console.log(`Passed: ${results.length - fails.length}/${results.length}`);
if (fails.length > 0) {
  process.exit(1);
} else {
  console.log('ALL EXPORT & FORMULA INJECTION TESTS PASSED!');
}
