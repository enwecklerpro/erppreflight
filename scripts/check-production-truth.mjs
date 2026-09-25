#!/usr/bin/env node

/**
 * ERP Preflight — Production Truth & Anti-Facade Static Linter (Part 20 & Section 114)
 *
 * Verifies that no production integration pretends to know, connect, synchronize,
 * verify, or execute something that it has not actually done.
 *
 * Specifically inspects:
 * - apps/api/src/modules/landscapes/ (Zero fake latencies, real HTTP probing, SSRF checks)
 * - apps/api/src/modules/traceability/ (Zero fake task IDs like CALM-TSK-xxxxx without REST, no fake SYNCHRONIZED)
 * - apps/api/src/modules/changesets/ (Zero unhandled outbox errors, real DB query for sap_objects)
 * - apps/api/src/modules/outbox/ (Real background worker presence, transactional execution)
 * - tests/e2e/ (Zero page.route interception in live E2E specs)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const TRUTH_CHECKS = [
  {
    name: 'Zero Math.random() latency generation in LandscapesService',
    file: path.join(ROOT_DIR, 'apps', 'api', 'src', 'modules', 'landscapes', 'landscapes.service.ts'),
    pattern: /Math\.random\s*\(\s*\)/,
    forbidden: true,
  },
  {
    name: 'Real HTTP/TLS fetch probe present in LandscapesService',
    file: path.join(ROOT_DIR, 'apps', 'api', 'src', 'modules', 'landscapes', 'landscapes.service.ts'),
    pattern: /fetch\s*\(\s*probeUrl/,
    forbidden: false, // Must be present!
  },
  {
    name: 'Real performance.now() latency measurement in LandscapesService',
    file: path.join(ROOT_DIR, 'apps', 'api', 'src', 'modules', 'landscapes', 'landscapes.service.ts'),
    pattern: /performance\.now\s*\(\s*\)/,
    forbidden: false, // Must be present!
  },
  {
    name: 'SSRF and cloud metadata protection active in LandscapesService',
    file: path.join(ROOT_DIR, 'apps', 'api', 'src', 'modules', 'landscapes', 'landscapes.service.ts'),
    pattern: /169\.254\.169\.254/,
    forbidden: false, // Must be present!
  },
  {
    name: 'Zero fake CALM-TSK Date.now() ID generation without remote REST call in TraceabilityService',
    file: path.join(ROOT_DIR, 'apps', 'api', 'src', 'modules', 'traceability', 'traceability.service.ts'),
    pattern: /CALM-TSK-[\$a-zA-Z0-9_{}]+Date\.now/,
    forbidden: true,
  },
  {
    name: 'CloudAlmConnectorService performs real OAuth token request',
    file: path.join(ROOT_DIR, 'apps', 'api', 'src', 'modules', 'traceability', 'connectors', 'cloud-alm.connector.ts'),
    pattern: /fetch\s*\(\s*(?:params\.)?tokenUrl/,
    forbidden: false, // Must be present!
  },
  {
    name: 'TraceabilityService explicitly handles CREDENTIALS_REQUIRED status',
    file: path.join(ROOT_DIR, 'apps', 'api', 'src', 'modules', 'traceability', 'traceability.service.ts'),
    pattern: /CREDENTIALS_REQUIRED/,
    forbidden: false, // Must be present!
  },
  {
    name: 'What-If Simulation queries real sap_objects from PostgreSQL catalog',
    file: path.join(ROOT_DIR, 'apps', 'api', 'src', 'modules', 'changesets', 'changesets.service.ts'),
    pattern: /SELECT\s+\*\s+FROM\s+sap_objects/,
    forbidden: false, // Must be present!
  },
  {
    name: 'What-If ChangeSetsService executes transactional withTenantTransaction',
    file: path.join(ROOT_DIR, 'apps', 'api', 'src', 'modules', 'changesets', 'changesets.service.ts'),
    pattern: /withTenantTransaction/,
    forbidden: false, // Must be present!
  },
  {
    name: 'Persistent OutboxDispatcherService exists and runs background interval worker',
    file: path.join(ROOT_DIR, 'apps', 'api', 'src', 'modules', 'outbox', 'outbox-dispatcher.service.ts'),
    pattern: /setInterval[\s\S]*?dispatchPendingEvents/,
    forbidden: false, // Must be present!
  },
  {
    name: 'Zero page.route interception in live E2E test suite',
    file: path.join(ROOT_DIR, 'tests', 'e2e', 'preflight-pipeline.live.spec.ts'),
    pattern: /page\.route\s*\(/,
    forbidden: true,
  },
  {
    name: 'AI Gateway strictly clamps confidence score to 0.60 epistemic ceiling',
    file: path.join(ROOT_DIR, 'apps', 'api', 'src', 'modules', 'ai-gateway', 'ai-gateway.service.ts'),
    pattern: /confidenceScore:\s*0\.60/,
    forbidden: false, // Must be present!
  },
  {
    name: 'AI Gateway respects tenant deterministicOnly and allowAiAssistance flags',
    file: path.join(ROOT_DIR, 'apps', 'api', 'src', 'modules', 'ai-gateway', 'ai-gateway.service.ts'),
    pattern: /policy\.deterministicOnly\s*\|\|\s*policy\.allowAiAssistance\s*===\s*false/,
    forbidden: false, // Must be present!
  },
];

let failed = false;

console.log('Running ERP Preflight Production Truth & Anti-Facade Gate...');

for (const check of TRUTH_CHECKS) {
  if (!fs.existsSync(check.file)) {
    console.error(`[FAIL] Required file missing: ${path.relative(ROOT_DIR, check.file)} (${check.name})`);
    failed = true;
    continue;
  }

  const content = fs.readFileSync(check.file, 'utf-8');
  const matched = check.pattern.test(content);

  if (check.forbidden && matched) {
    console.error(`[FAIL] ${check.name}: Forbidden facade pattern found in ${path.relative(ROOT_DIR, check.file)}`);
    failed = true;
  } else if (!check.forbidden && !matched) {
    console.error(`[FAIL] ${check.name}: Required production implementation missing in ${path.relative(ROOT_DIR, check.file)}`);
    failed = true;
  } else {
    console.log(`  ✔ [PASS] ${check.name}`);
  }
}

if (failed) {
  console.error('\nProduction Truth Gate FAILED! Eliminate all remaining facades and simulated behaviors.');
  process.exit(1);
} else {
  console.log('\n[SUCCESS] 100% compliant with Production Truth standard. Zero simulated facades detected!');
  process.exit(0);
}
