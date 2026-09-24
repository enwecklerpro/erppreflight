/**
 * Empirical Verification Script: Large Dataset Schema Parse & Memory Stress-Test
 * Agent: challenger_m4_2
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

// Setup module resolver and ts loader
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === '@erppreflight/schemas') {
    return path.resolve('H:/erppreflight/packages/schemas/dist/index.js');
  }
  return origResolve.call(this, request, parent, isMain, options);
};

require.extensions['.ts'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  return module._compile(compiled.outputText, filename);
};

const schemas = require('H:/erppreflight/packages/schemas/dist/index.js');
const { SapObjectSchema } = schemas;
const { generateMockSapObjects } = require('H:/erppreflight/apps/web/src/components/objects/types.ts');

async function run() {
  console.log('================================================================');
  console.log('EMPIRICAL STRESS TEST: 10,000 SAP OBJECT SCHEMA & MEMORY');
  console.log('================================================================\n');

  if (global.gc) {
    global.gc();
  }

  const memStart = process.memoryUsage();
  const startTime = performance.now();

  console.log(`[Phase 1] Generating 10,000 SapObject records...`);
  const genStart = performance.now();
  const objects = generateMockSapObjects(10000);
  const genEnd = performance.now();
  const genDuration = genEnd - genStart;

  console.log(`Generated ${objects.length} objects in ${genDuration.toFixed(2)} ms.`);
  console.log(`Initial record count check: ${objects.length === 10000 ? 'PASS (10,000)' : 'FAIL (' + objects.length + ')'}`);

  const memAfterGen = process.memoryUsage();
  console.log(`Heap after generation: ${(memAfterGen.heapUsed / 1024 / 1024).toFixed(2)} MB (+${((memAfterGen.heapUsed - memStart.heapUsed) / 1024 / 1024).toFixed(2)} MB)`);

  console.log(`\n[Phase 2] Validating all 10,000 objects against SapObjectSchema...`);
  const parseStart = performance.now();
  let validCount = 0;
  let invalidCount = 0;
  const failureSamples = [];

  for (let i = 0; i < objects.length; i++) {
    const res = SapObjectSchema.safeParse(objects[i]);
    if (res.success) {
      validCount++;
    } else {
      invalidCount++;
      if (failureSamples.length < 5) {
        failureSamples.push({ index: i, errors: res.error.errors, record: objects[i] });
      }
    }
  }

  const parseEnd = performance.now();
  const parseDuration = parseEnd - parseStart;
  const memAfterParse = process.memoryUsage();

  console.log(`Validated: ${validCount} / ${objects.length}`);
  console.log(`Validation failures: ${invalidCount}`);
  if (invalidCount > 0) {
    console.error(`Sample failures:`, JSON.stringify(failureSamples, null, 2));
  }

  const throughput = (objects.length / (parseDuration / 1000)).toFixed(0);
  const avgPerItem = (parseDuration / objects.length).toFixed(4);

  console.log(`\n--- Performance & Memory Metrics ---`);
  console.log(`Total Parse Time: ${parseDuration.toFixed(2)} ms`);
  console.log(`Average Parse Time per Object: ${avgPerItem} ms`);
  console.log(`Validation Throughput: ${throughput} objects/sec`);
  console.log(`Heap Used Delta: ${((memAfterParse.heapUsed - memStart.heapUsed) / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Heap Total: ${(memAfterParse.heapTotal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`RSS: ${(memAfterParse.rss / 1024 / 1024).toFixed(2)} MB`);

  console.log(`\n[Phase 3] Adversarial Corruption & Rejection Verification...`);
  const corruptTests = [
    {
      name: 'Corrupt UUID',
      mutator: (o) => ({ ...o, id: 'not-a-uuid' }),
      expectedErrorField: 'id',
    },
    {
      name: 'Invalid SapObjectType',
      mutator: (o) => ({ ...o, objectType: 'INVALID_TYPE' }),
      expectedErrorField: 'objectType',
    },
    {
      name: 'Invalid CleanCoreTier',
      mutator: (o) => ({ ...o, cleanCoreTier: 'TIER_UNKNOWN' }),
      expectedErrorField: 'cleanCoreTier',
    },
    {
      name: 'Invalid Complexity LOC (Negative)',
      mutator: (o) => ({ ...o, complexity: { ...o.complexity, linesOfCode: -10 } }),
      expectedErrorField: 'complexity.linesOfCode',
    },
    {
      name: 'Invalid Finding Severity',
      mutator: (o) => ({
        ...o,
        findingSummary: {
          ...o.findingSummary,
          findings: [
            {
              id: '00000000-0000-0000-0000-000000000001',
              ruleId: 'TEST_RULE',
              severity: 'CATASTROPHIC', // Not in SeverityEnum
              title: 'test',
              remediation: 'fix',
            },
          ],
        },
      }),
      expectedErrorField: 'findingSummary.findings',
    },
  ];

  let corruptPass = 0;
  for (const ct of corruptTests) {
    const corrupted = ct.mutator(objects[0]);
    const res = SapObjectSchema.safeParse(corrupted);
    if (!res.success) {
      corruptPass++;
      console.log(`  ✔ [PASS] ${ct.name} properly rejected by SapObjectSchema`);
    } else {
      console.error(`  ✖ [FAIL] ${ct.name} unexpectedly accepted by SapObjectSchema!`);
    }
  }

  console.log(`\nAdversarial rejection tests: ${corruptPass}/${corruptTests.length} PASSED`);

  const summary = {
    totalRecords: objects.length,
    validRecords: validCount,
    invalidRecords: invalidCount,
    successRate: (validCount / objects.length) * 100,
    genDurationMs: genDuration,
    parseDurationMs: parseDuration,
    throughputOpsPerSec: Number(throughput),
    avgPerItemMs: Number(avgPerItem),
    heapUsedMB: memAfterParse.heapUsed / 1024 / 1024,
    heapDeltaMB: (memAfterParse.heapUsed - memStart.heapUsed) / 1024 / 1024,
    rssMB: memAfterParse.rss / 1024 / 1024,
    corruptRejectionScore: `${corruptPass}/${corruptTests.length}`,
  };

  fs.writeFileSync(
    path.resolve('H:/erppreflight/.agents/challenger_m4_2/schema-test-results.json'),
    JSON.stringify(summary, null, 2)
  );
  console.log(`\nResults written to H:/erppreflight/.agents/challenger_m4_2/schema-test-results.json`);

  if (invalidCount > 0 || corruptPass !== corruptTests.length) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
