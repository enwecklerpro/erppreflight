import * as React from 'react';
import * as ReactDOMServer from 'react-dom/server';
import { SeverityBadge } from '../../apps/web/src/components/findings/severity-badge';
import { ConfidenceBadge } from '../../apps/web/src/components/findings/confidence-badge';
import { CleanCoreBadge } from '../../apps/web/src/components/findings/clean-core-badge';
import { FindingDetailRow } from '../../apps/web/src/components/findings/finding-detail-row';
import { findingColumns } from '../../apps/web/src/components/findings/finding-columns';
import { escapeCsvCell } from '../../apps/web/src/lib/export';
import { Finding, Severity, ConfidenceClass, CleanCoreTier } from '@erppreflight/schemas';

interface Check {
  name: string;
  ok: boolean;
  message?: string;
}

const checks: Check[] = [];

function check(ok: boolean, name: string, message?: string) {
  checks.push({ name, ok, message });
  if (!ok) {
    console.error(`[STRESS FAIL] ${name}: ${message}`);
  }
}

console.log('=== RUNNING ADVERSARIAL STRESS HARNESS ===\n');

// ----------------------------------------------------------------------------
// 1. BADGE RESILIENCE & FUZZING
// ----------------------------------------------------------------------------
console.log('--- 1. Testing Badges under malformed inputs ---');

// Fuzz SeverityBadge with non-standard values
const malformedSeverities = [undefined, null, '', 'blocker', 'CRITICAL_HIGH', 123, {}];
for (const val of malformedSeverities) {
  try {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(SeverityBadge, { severity: val as unknown as Severity })
    );
    // Should safely fallback to Info without crashing
    check(
      html.includes('role="status"') && html.includes('Info'),
      `SeverityBadge safely handles malformed: ${JSON.stringify(val)}`,
      `Rendered: ${html}`
    );
  } catch (err) {
    check(false, `SeverityBadge crashed on: ${JSON.stringify(val)}`, String(err));
  }
}

// Fuzz ConfidenceBadge with extreme numeric scores & types
const confidenceScoreTests = [
  { conf: 'VERIFIED', score: 0, expectedScoreStr: '0.00' },
  { conf: 'VERIFIED', score: 1.0, expectedScoreStr: '1.00' },
  { conf: 'INFERRED', score: -0.5, expectedScoreStr: '-0.50' },
  { conf: 'UNKNOWN', score: 99.999, expectedScoreStr: '100.00' },
  { conf: 'RULE_DERIVED', score: undefined, expectedScoreStr: '0.85' },
];

for (const { conf, score, expectedScoreStr } of confidenceScoreTests) {
  try {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(ConfidenceBadge, {
        confidence: conf as ConfidenceClass,
        score,
      })
    );
    check(
      html.includes(`(${expectedScoreStr})`),
      `ConfidenceBadge formats score ${score} as ${expectedScoreStr}`,
      `Rendered: ${html}`
    );
  } catch (err) {
    check(false, `ConfidenceBadge crashed on score ${score}`, String(err));
  }
}

// Fuzz CleanCoreBadge with malformed tiers
const malformedTiers = [undefined, null, '', 'TIER_4_UNKNOWN', 'custom'];
for (const val of malformedTiers) {
  try {
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(CleanCoreBadge, { tier: val as CleanCoreTier })
    );
    // Should either display em dash or fallback safely
    check(
      html.includes('—') || html.includes('Tier 3 Classic'),
      `CleanCoreBadge handles tier: ${JSON.stringify(val)} safely`,
      `Rendered: ${html}`
    );
  } catch (err) {
    check(false, `CleanCoreBadge crashed on tier ${JSON.stringify(val)}`, String(err));
  }
}


// ----------------------------------------------------------------------------
// 2. FINDING DETAIL ROW ADVERSARIAL CASES
// ----------------------------------------------------------------------------
console.log('\n--- 2. Testing FindingDetailRow with adversarial payloads ---');

// Case A: Minimal finding (all optionals omitted / null)
const minimalFinding: Finding = {
  id: 'min-1',
  projectId: 'p-1',
  ruleId: 'MINIMAL_RULE',
  engineType: 'OPD_GUARD',
  severity: 'INFO',
  confidence: 'UNKNOWN',
  title: 'Minimal Finding Test',
  description: 'Testing minimal shape',
  remediation: 'None needed',
  category: 'OUTPUT_MANAGEMENT',
};

try {
  const htmlMin = ReactDOMServer.renderToStaticMarkup(
    React.createElement(FindingDetailRow, { finding: minimalFinding })
  );
  check(
    htmlMin.includes('MINIMAL_RULE') &&
      htmlMin.includes('No raw snippet evidence attached to this rule assertion.'),
    'FindingDetailRow renders minimal finding without crashing'
  );
} catch (err) {
  check(false, 'FindingDetailRow crashed on minimal finding', String(err));
}

// Case B: XSS Injection attempt in snippet, sha256, artifactPath
const xssFinding: Finding = {
  ...minimalFinding,
  ruleId: 'XSS_TEST',
  evidence: [{
    artifactPath: '<script>alert("xss_path")</script>',
    lineNumber: 10,
    columnNumber: 5,
    snippet: '<img src=x onerror=alert("xss_snippet")>',
    sha256: '"><script>alert("xss_hash")</script>',
  }],
};

try {
  const htmlXss = ReactDOMServer.renderToStaticMarkup(
    React.createElement(FindingDetailRow, { finding: xssFinding })
  );
  // React must escape HTML entities
  check(!htmlXss.includes('<script>'), 'XSS in artifactPath and sha256 properly HTML-escaped');
  check(!htmlXss.includes('<img src=x onerror='), 'XSS in snippet properly HTML-escaped');
  check(htmlXss.includes('&lt;script&gt;'), 'Script tag converted to &lt;script&gt;');
  check(htmlXss.includes('Unverified Hash'), 'Malicious sha256 marked as Unverified Hash');
} catch (err) {
  check(false, 'FindingDetailRow crashed on XSS payloads', String(err));
}

// Case C: Heavy load with 50 evidence items
const heavyEvidence = Array.from({ length: 50 }, (_, i) => ({
  artifactPath: `src/packages/module_${i}/code.abap`,
  lineNumber: i * 10 + 1,
  columnNumber: (i % 80) + 1,
  snippet: `SELECT SINGLE * FROM mara WHERE matnr = @lv_matnr_${i}.`,
  sha256: 'a'.repeat(64),
}));

const heavyFinding: Finding = {
  ...minimalFinding,
  ruleId: 'HEAVY_RULE',
  evidence: heavyEvidence,
};

const startTime = Date.now();
const htmlHeavy = ReactDOMServer.renderToStaticMarkup(
  React.createElement(FindingDetailRow, { finding: heavyFinding })
);
const elapsedMs = Date.now() - startTime;
check(elapsedMs < 100, `Heavy finding (50 evidence items) rendered in ${elapsedMs}ms (< 100ms)`);
check(
  (htmlHeavy.match(/Verified Hash/g) || []).length === 50,
  'All 50 evidence items rendered and verified'
);


// ----------------------------------------------------------------------------
// 3. PROPERTY-BASED CSV INJECTION STRESS TESTING
// ----------------------------------------------------------------------------
console.log('\n--- 3. Property-Based Fuzzing for CSV Formula Injection (CWE-1236) ---');

const formulaTriggers = ['=', '+', '-', '@', '\t', '\r'];
const benignChars = ['a', 'Z', '0', '9', ' ', '_', '/', '.', ':'];

// Generator for random payloads
function generateRandomString(len: number, prefixTrigger = false): string {
  let res = '';
  if (prefixTrigger) {
    res += formulaTriggers[Math.floor(Math.random() * formulaTriggers.length)];
  }
  for (let i = 0; i < len; i++) {
    const pool = Math.random() > 0.3 ? benignChars : [',', '"', '\n', '\r', '\t', '=', '+', '-', '@'];
    res += pool[Math.floor(Math.random() * pool.length)];
  }
  return res;
}

let fuzzCount = 0;
let formulaAttacksNeutralized = 0;
let quotesProperlyBalanced = 0;

for (let i = 0; i < 500; i++) {
  const isAttack = Math.random() > 0.4;
  const raw = generateRandomString(Math.floor(Math.random() * 50) + 1, isAttack);
  fuzzCount++;

  const escaped = escapeCsvCell(raw);

  // Check 1: If raw starts with a formula trigger, escaped must have leading "'"
  if (/^[=+\-@\t\r]/.test(raw)) {
    formulaAttacksNeutralized++;
    const isProtected = escaped.startsWith("'") || escaped.startsWith('"\'');
    if (!isProtected) {
      check(false, `Formula injection not neutralized: ${JSON.stringify(raw)} -> ${JSON.stringify(escaped)}`);
      break;
    }
  }

  // Check 2: If escaped contains double quotes, quotes count must be even (balanced pairs)
  const quoteCount = (escaped.match(/"/g) || []).length;
  if (quoteCount % 2 === 0) {
    quotesProperlyBalanced++;
  } else {
    check(false, `Unbalanced quotes in escaped CSV cell: ${JSON.stringify(escaped)}`);
  }
}

check(fuzzCount === 500, `Executed ${fuzzCount} fuzz tests for CSV escaping`);
check(
  formulaAttacksNeutralized > 100,
  `Neutralized ${formulaAttacksNeutralized} formula injection attacks`
);
check(
  quotesProperlyBalanced === 500,
  `All 500 escaped outputs have balanced RFC 4180 quotes`
);

// Test Unicode & International Characters
const internationalInputs = [
  'München Äpfel Übergrößen',
  'SAP ECC 6.0 ➔ S/4HANA Cloud 2408',
  '日本語テスト (Japanese)',
  'עברית (Hebrew RTL)',
  'مرحبا (Arabic RTL)',
  '🔥🚀✨ (Emojis)',
];

for (const input of internationalInputs) {
  const escaped = escapeCsvCell(input);
  check(
    escaped.includes(input),
    `International characters preserved: ${input.slice(0, 10)}...`
  );
}


// ----------------------------------------------------------------------------
// 4. FINDING COLUMNS FILTER FUNCTIONS STRESS TESTING
// ----------------------------------------------------------------------------
console.log('\n--- 4. Testing Finding Columns Filter Functions ---');

const severityCol = findingColumns.find((c) => c.id === 'severity');
const confidenceCol = findingColumns.find((c) => c.id === 'confidence');
const cleanCoreCol = findingColumns.find((c) => c.id === 'cleanCoreTier');

check(!!severityCol?.filterFn, 'Severity column has filterFn');
check(!!confidenceCol?.filterFn, 'Confidence column has filterFn');
check(!!cleanCoreCol?.filterFn, 'Clean Core column has filterFn');

if (severityCol?.filterFn) {
  const filterFn = severityCol.filterFn as any;
  const mockRow = (val: string) => ({
    getValue: () => val,
  });

  // Empty filter returns true
  check(filterFn(mockRow('BLOCKER'), 'severity', []) === true, 'Empty severity filter passes all');
  // Matching filter returns true
  check(filterFn(mockRow('BLOCKER'), 'severity', ['BLOCKER', 'CRITICAL']) === true, 'Matching severity filter passes');
  // Non-matching filter returns false
  check(filterFn(mockRow('INFO'), 'severity', ['BLOCKER', 'CRITICAL']) === false, 'Non-matching severity filter rejects');
}

if (confidenceCol?.filterFn) {
  const filterFn = confidenceCol.filterFn as any;
  const mockRow = (val: string) => ({
    getValue: () => val,
  });

  check(filterFn(mockRow('VERIFIED'), 'confidence', []) === true, 'Empty confidence filter passes all');
  check(filterFn(mockRow('VERIFIED'), 'confidence', ['VERIFIED']) === true, 'Matching confidence filter passes');
  check(filterFn(mockRow('INFERRED'), 'confidence', ['VERIFIED']) === false, 'Non-matching confidence filter rejects');
}

if (cleanCoreCol?.filterFn) {
  const filterFn = cleanCoreCol.filterFn as any;
  const mockRow = (val: string | null) => ({
    getValue: () => val,
  });

  check(filterFn(mockRow('TIER_1_CLOUD'), 'cleanCoreTier', []) === true, 'Empty Clean Core filter passes all');
  check(filterFn(mockRow('TIER_1_CLOUD'), 'cleanCoreTier', ['TIER_1_CLOUD']) === true, 'Matching Clean Core passes');
  check(filterFn(mockRow(null), 'cleanCoreTier', ['TIER_1_CLOUD']) === false, 'Null Clean Core rejected by active filter');
}


// ----------------------------------------------------------------------------
// HARNESS SUMMARY
// ----------------------------------------------------------------------------
console.log('\n======================================================');
console.log('            ADVERSARIAL STRESS RESULTS                ');
console.log('======================================================');

const totalChecks = checks.length;
const passedChecks = checks.filter((c) => c.ok).length;
const failedChecks = checks.filter((c) => !c.ok).length;

console.log(`Total assertions evaluated: ${totalChecks}`);
console.log(`Passed: ${passedChecks}`);
console.log(`Failed: ${failedChecks}`);

if (failedChecks > 0) {
  console.error('\nFAILURES ENCOUNTERED:');
  for (const c of checks.filter((c) => !c.ok)) {
    console.error(`- ${c.name}: ${c.message}`);
  }
  process.exit(1);
} else {
  console.log('\nALL ADVERSARIAL STRESS TESTS PASSED WITH 100% SUCCESS RATE.');
  process.exit(0);
}
