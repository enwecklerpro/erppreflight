import { escapeCsvCell } from '../../apps/web/src/lib/export.ts';

console.log('=== EMPIRICAL TEST: export.ts RFC 4180 & CSV Injection ===\n');

let passed = 0;
let failed = 0;

function assert(description, actual, expected, condition) {
  const isOk = condition !== undefined ? condition : actual === expected;
  if (isOk) {
    console.log(`[PASS] ${description}`);
    passed++;
  } else {
    console.error(`[FAIL] ${description}`);
    console.error(`       Expected: ${JSON.stringify(expected)}`);
    console.error(`       Actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// 1. null / undefined handling
assert('null returns empty string', escapeCsvCell(null), '');
assert('undefined returns empty string', escapeCsvCell(undefined), '');

// 2. Simple string without special chars
assert('plain string remains unchanged', escapeCsvCell('SAP_ERP'), 'SAP_ERP');
assert('numbers converted to string', escapeCsvCell(42), '42');
assert('booleans converted to string', escapeCsvCell(true), 'true');

// 3. Double quotes handling
assert('double quotes escaped according to RFC 4180', escapeCsvCell('Hello "World"'), '"Hello ""World"""');
assert('multiple double quotes escaped', escapeCsvCell('"quoted"'), '"""quoted"""');

// 4. Commas and CRLF handling
assert('comma triggers quoting', escapeCsvCell('field1,field2'), '"field1,field2"');
assert('LF newline triggers quoting', escapeCsvCell('line1\nline2'), '"line1\nline2"');
assert('CRLF newline triggers quoting', escapeCsvCell('line1\r\nline2'), '"line1\r\nline2"');
assert('CR alone triggers quoting', escapeCsvCell('line1\rline2'), '"line1\rline2"');

// 5. German SAP characters (ä, ö, ü, ß)
assert('German umlaut ä handled', escapeCsvCell('Prüfung'), 'Prüfung');
assert('German characters in quotes handled', escapeCsvCell('Größe, "Maßstab"'), '"Größe, ""Maßstab"""');
assert('German ß handled', escapeCsvCell('Schließen'), 'Schließen');

// 6. CSV FORMULA INJECTION (CWE-1236)
console.log('\n--- CSV FORMULA INJECTION TESTS ---');
const formulaInjections = [
  '=1+1',
  '=cmd|\'/C calc\'!A0',
  '-5+2',
  '+12345',
  '@SUM(A1:A10)',
  '\t=cmd',
  '\r=cmd',
  '|calc'
];

for (const formula of formulaInjections) {
  const result = escapeCsvCell(formula);
  // Formula injection defense: Should prefix with ' or sanitize so spreadsheet doesn't treat as formula
  // If result begins with = or + or - or @, or "= or "+ or "- or "@, spreadsheet evaluates it!
  const evaluatesAsFormula = /^[=+\-@\t\r]|^"[=+\-@\t\r]/.test(result);
  
  assert(
    `Formula injection prevented for: ${JSON.stringify(formula)}`,
    evaluatesAsFormula ? 'VULNERABLE: Evaluates as formula' : 'SAFE',
    'SAFE'
  );
}

// 7. Object serialization
assert('object serialized to JSON and escaped', escapeCsvCell({ key: "val,ue" }), '"{\\"key\\":\\"val,ue\\"}"');

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
