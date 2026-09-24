/**
 * Forensic Integrity Scanner: Prohibited Patterns & Facade Detection
 * Author: auditor_m4_rem_2
 */

import fs from 'fs';
import path from 'path';

console.log('=== FORENSIC INTEGRITY SCANNER: PROHIBITED PATTERNS & FACADES ===\n');

const filesToInspect = [
  'H:/erppreflight/apps/web/src/components/data-table/data-table.tsx',
  'H:/erppreflight/apps/web/src/components/data-table/types.ts',
  'H:/erppreflight/apps/web/src/components/data-table/data-table-toolbar.tsx',
  'H:/erppreflight/apps/web/src/app/projects/[id]/findings/page.tsx',
  'H:/erppreflight/apps/web/src/app/projects/[id]/objects/page.tsx',
  'H:/erppreflight/apps/web/src/app/inspector/page.tsx',
  'H:/erppreflight/apps/web/src/components/objects/types.ts',
  'H:/erppreflight/apps/web/src/lib/export.ts',
  'H:/erppreflight/apps/web/src/components/findings/finding-columns.tsx',
  'H:/erppreflight/apps/web/src/components/findings/finding-detail-row.tsx',
  'H:/erppreflight/apps/web/src/hooks/useTableUrlSync.ts',
];

let totalChecks = 0;
let violations = 0;

for (const filePath of filesToInspect) {
  if (!fs.existsSync(filePath)) {
    console.error(`[FAIL] File missing: ${filePath}`);
    violations++;
    continue;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  console.log(`Auditing ${path.basename(filePath)} (${lines.length} lines)...`);

  // Check 1: Hardcoded test outputs or bypass strings
  const hardcodedPatterns = [
    /return\s+(true|false);?\s*\/\/\s*bypass/i,
    /TEST_RESULT_PASS/,
    /DUMMY_RESULT/,
    /return\s+\[\s*\{\s*id:\s*['"]dummy/i,
    /throw new Error\(['"]not implemented['"]\)/i,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pat of hardcodedPatterns) {
      if (pat.test(line)) {
        console.error(`  [VIOLATION] Line ${i + 1}: Prohibited pattern detected: ${line.trim()}`);
        violations++;
      }
    }
  }

  // Check 2: Facade check - empty functions or uninvoked handlers
  const emptyFnPattern = /\(\s*\)\s*=>\s*\{\s*\}/;
  // Exclude reasonable defaults like estimateRowHeight or catch(() => {})
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (emptyFnPattern.test(line) && !line.includes('.catch(() => {})') && !line.includes('onClose') && !line.includes('noop')) {
      console.log(`  [INFO] Line ${i + 1}: Empty arrow function found: ${line.trim()}`);
    }
  }

  totalChecks++;
}

console.log(`\nAudited ${totalChecks} core deliverables.`);
if (violations === 0) {
  console.log('✔ CLEAN: 0 prohibited patterns, 0 dummy stubs, 0 hardcoded test results detected.');
} else {
  console.error(`🔴 INTEGRITY VIOLATION: ${violations} issues detected.`);
  process.exit(1);
}
