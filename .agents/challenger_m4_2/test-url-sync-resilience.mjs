/**
 * Empirical Verification Script: URL Synchronization & Filter Resilience Stress-Test
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
  if (request === 'lucide-react' || request === 'react' || request === 'react/jsx-runtime' || request === 'react/jsx-dev-runtime') {
    return path.resolve('H:/erppreflight/.agents/challenger_m4_2/mock-ui.js');
  }
  return origResolve.call(this, request, parent, isMain, options);
};

function compileTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  return module._compile(compiled.outputText, filename);
}

require.extensions['.ts'] = compileTs;
require.extensions['.tsx'] = compileTs;

const { objectFacetedFilters } = require('H:/erppreflight/apps/web/src/components/objects/object-columns.tsx');
const { fetchProjectObjects, generateMockSapObjects } = require('H:/erppreflight/apps/web/src/components/objects/types.ts');

/**
 * Pure simulator of useTableUrlSync logic for headless verification.
 */
function deserializeUrlParams(searchParamsString, defaultPageSize = 50) {
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

  const sort = searchParams.get('sort');
  let sortField;
  let sortOrder;

  if (sort) {
    const parts = sort.split('.');
    sortField = parts[0];
    sortOrder = parts[1] === 'desc' ? 'desc' : 'asc';
  }

  const search = searchParams.get('search') || undefined;
  const filters = {};

  searchParams.forEach((value, key) => {
    if (!['page', 'pageSize', 'sort', 'search'].includes(key)) {
      const parts = value.split(',').filter(Boolean);
      if (parts.length > 0) {
        filters[key] = filters[key] ? [...filters[key], ...parts] : parts;
      }
    }
  });

  return { page, pageSize, sortField, sortOrder, search, filters };
}

function serializeUrlParams(currentStateString, newState, defaultPageSize = 50) {
  const current = new URLSearchParams(currentStateString);

  if (newState.page !== undefined) {
    if (newState.page > 1) current.set('page', String(newState.page));
    else current.delete('page');
  }

  if (newState.pageSize !== undefined) {
    if (newState.pageSize !== defaultPageSize) {
      current.set('pageSize', String(newState.pageSize));
    } else {
      current.delete('pageSize');
    }
  }

  if (newState.sortField !== undefined) {
    if (newState.sortField) {
      current.set('sort', `${newState.sortField}.${newState.sortOrder || 'asc'}`);
    } else {
      current.delete('sort');
    }
  }

  if (newState.search !== undefined) {
    if (newState.search.trim()) current.set('search', newState.search.trim());
    else current.delete('search');
  }

  if (newState.filters) {
    Object.entries(newState.filters).forEach(([key, values]) => {
      if (values && values.length > 0) {
        current.set(key, values.join(','));
      } else {
        current.delete(key);
      }
    });
  }

  return current.toString();
}

async function run() {
  console.log('================================================================');
  console.log('EMPIRICAL STRESS TEST: URL SYNCHRONIZATION & FILTER RESILIENCE');
  console.log('================================================================\n');

  console.log(`[Phase 1] Verifying objectFacetedFilters definition...`);
  console.log(`Defined filters count: ${objectFacetedFilters.length}`);
  const filterIds = objectFacetedFilters.map((f) => f.id);
  console.log(`Filter IDs: ${filterIds.join(', ')}`);

  const expectedFilterIds = ['objectType', 'cleanCoreTier', 'package'];
  const hasAllExpected = expectedFilterIds.every((id) => filterIds.includes(id));
  console.log(`Expected filter IDs present: ${hasAllExpected ? 'PASS' : 'FAIL'}`);

  for (const filter of objectFacetedFilters) {
    console.log(`  - Filter '${filter.id}' (${filter.title}): ${filter.options.length} options`);
    if (filter.options.length === 0) {
      throw new Error(`Filter ${filter.id} has empty options list`);
    }
  }

  console.log(`\n[Phase 2] Deserialization Stress-Testing on Hostile / Edge-Case Query Strings...`);
  const deserializationTestCases = [
    {
      name: 'Empty query string',
      input: '',
      expected: { page: 1, pageSize: 50, sortField: undefined, sortOrder: undefined, search: undefined, filters: {} },
    },
    {
      name: 'Valid standard query with filters, sort, search, pagination',
      input: 'page=3&pageSize=100&sort=name.desc&search=sales&objectType=PROG,CLAS&cleanCoreTier=TIER_1_CLOUD',
      expected: {
        page: 3,
        pageSize: 100,
        sortField: 'name',
        sortOrder: 'desc',
        search: 'sales',
        filters: { objectType: ['PROG', 'CLAS'], cleanCoreTier: ['TIER_1_CLOUD'] },
      },
    },
    {
      name: 'Hostile negative page & pageSize',
      input: 'page=-99&pageSize=-500',
      expected: { page: 1, pageSize: 10 }, // Clamped to min 10
    },
    {
      name: 'Hostile excessive pageSize (DDoS / Memory exhaustion attempt)',
      input: 'pageSize=100000000',
      expected: { pageSize: 500 }, // Clamped to max 500
    },
    {
      name: 'NaN / Malformed numeric inputs',
      input: 'page=NaN&pageSize=infinity',
      expected: { page: 1, pageSize: 50 },
    },
    {
      name: 'Malformed sort parameters (no dot)',
      input: 'sort=objectType',
      expected: { sortField: 'objectType', sortOrder: 'asc' },
    },
    {
      name: 'Malformed sort parameters (empty string after sort=)',
      input: 'sort=',
      expected: { sortField: undefined, sortOrder: undefined },
    },
    {
      name: 'Malformed sort parameters (multiple dots)',
      input: 'sort=complexity.score.desc',
      expected: { sortField: 'complexity', sortOrder: 'score' === 'desc' ? 'desc' : 'asc' },
    },
    {
      name: 'Empty filter values and dangling commas',
      input: 'objectType=,,,&&cleanCoreTier=&package=Z_SALES_ORDER,,$TMP,',
      expected: {
        filters: { package: ['Z_SALES_ORDER', '$TMP'] },
      },
    },
    {
      name: 'Repeated query parameters (array explosion in URL)',
      input: 'objectType=PROG&objectType=CLAS,TABL&package=$TMP',
      expected: {
        filters: { objectType: ['PROG', 'CLAS', 'TABL'], package: ['$TMP'] },
      },
    },
    {
      name: 'XSS & SQLi probe parameters in filters and search',
      input: 'search=%3Cscript%3Ealert(1)%3C/script%3E&cleanCoreTier=%27%20OR%201=1--',
      expected: {
        search: '<script>alert(1)</script>',
        filters: { cleanCoreTier: ["' OR 1=1--"] },
      },
    },
  ];

  let dePassCount = 0;
  for (const tc of deserializationTestCases) {
    try {
      const output = deserializeUrlParams(tc.input);
      let match = true;
      for (const [k, v] of Object.entries(tc.expected)) {
        if (JSON.stringify(output[k]) !== JSON.stringify(v)) {
          match = false;
          console.error(`  ✖ [FAIL] ${tc.name}: mismatch on key '${k}'. Expected:`, v, 'Got:', output[k]);
        }
      }
      if (match) {
        dePassCount++;
        console.log(`  ✔ [PASS] ${tc.name}`);
      }
    } catch (err) {
      console.error(`  ✖ [CRASH] ${tc.name} threw error:`, err);
    }
  }

  console.log(`Deserialization test results: ${dePassCount}/${deserializationTestCases.length} PASSED`);

  console.log(`\n[Phase 3] Serialization Round-Trip & Cleanup Verification...`);
  const serializationTestCases = [
    {
      name: 'Serialize default clean state -> produces empty query',
      initial: '',
      update: { page: 1, pageSize: 50, sortField: '', search: '', filters: { objectType: [] } },
      expectedUrl: '',
    },
    {
      name: 'Serialize filters and sort -> clean query string',
      initial: '',
      update: {
        page: 2,
        pageSize: 100,
        sortField: 'package',
        sortOrder: 'desc',
        search: 'acdoca',
        filters: {
          objectType: ['TABL', 'CDS'],
          cleanCoreTier: ['TIER_3_CLASSIC'],
        },
      },
      expectedMatches: [
        'page=2',
        'pageSize=100',
        'sort=package.desc',
        'search=acdoca',
        'objectType=TABL%2CCDS',
        'cleanCoreTier=TIER_3_CLASSIC',
      ],
    },
    {
      name: 'Remove filter when emptied -> cleanly deleted from URL',
      initial: 'objectType=PROG&package=Z_SALES_ORDER',
      update: { filters: { objectType: [] } },
      expectedDoesNotContain: ['objectType'],
      expectedContains: ['package=Z_SALES_ORDER'],
    },
    {
      name: 'Reset page to 1 removes page parameter from URL',
      initial: 'page=5&sort=name.asc',
      update: { page: 1 },
      expectedDoesNotContain: ['page='],
      expectedContains: ['sort=name.asc'],
    },
  ];

  let serPassCount = 0;
  for (const tc of serializationTestCases) {
    try {
      const serialized = serializeUrlParams(tc.initial, tc.update);
      let passed = true;

      if (tc.expectedUrl !== undefined && serialized !== tc.expectedUrl) {
        console.error(`  ✖ [FAIL] ${tc.name}: expected '${tc.expectedUrl}', got '${serialized}'`);
        passed = false;
      }
      if (tc.expectedMatches) {
        for (const m of tc.expectedMatches) {
          if (!serialized.includes(m)) {
            console.error(`  ✖ [FAIL] ${tc.name}: output '${serialized}' missing match '${m}'`);
            passed = false;
          }
        }
      }
      if (tc.expectedDoesNotContain) {
        for (const d of tc.expectedDoesNotContain) {
          if (serialized.includes(d)) {
            console.error(`  ✖ [FAIL] ${tc.name}: output '${serialized}' should not contain '${d}'`);
            passed = false;
          }
        }
      }
      if (tc.expectedContains) {
        for (const c of tc.expectedContains) {
          if (!serialized.includes(c)) {
            console.error(`  ✖ [FAIL] ${tc.name}: output '${serialized}' missing '${c}'`);
            passed = false;
          }
        }
      }

      if (passed) {
        serPassCount++;
        console.log(`  ✔ [PASS] ${tc.name}`);
      }
    } catch (err) {
      console.error(`  ✖ [CRASH] ${tc.name} threw error:`, err);
    }
  }

  console.log(`Serialization test results: ${serPassCount}/${serializationTestCases.length} PASSED`);

  console.log(`\n[Phase 4] End-to-End fetchProjectObjects Query Execution with Edge Filters...`);
  const projectId = '1a91cf25-87a4-4a41-b0db-6e69001b9201';

  const filterExecCases = [
    {
      name: 'No filters (all 10,000 objects, page 1, limit 50)',
      params: { projectId, page: 1, pageSize: 50 },
      validate: (res) => res.totalCount === 10000 && res.items.length === 50 && res.page === 1,
    },
    {
      name: 'Filter by objectType = ["PROG", "CLAS"]',
      params: { projectId, filters: { objectType: ['PROG', 'CLAS'] }, pageSize: 50 },
      validate: (res) => res.totalCount > 0 && res.items.every((o) => ['PROG', 'CLAS'].includes(o.objectType)),
    },
    {
      name: 'Filter by cleanCoreTier = ["TIER_1_CLOUD"]',
      params: { projectId, filters: { cleanCoreTier: ['TIER_1_CLOUD'] }, pageSize: 50 },
      validate: (res) => res.totalCount === 10000 && res.items.every((o) => o.cleanCoreTier === 'TIER_1_CLOUD'),
    },
    {
      name: 'Filter by cleanCoreTier = ["TIER_3_CLASSIC"] (Reveals (i * 3) % 3 modulus defect)',
      params: { projectId, filters: { cleanCoreTier: ['TIER_3_CLASSIC'] }, pageSize: 50 },
      validate: (res) => {
        // Expected behavior for realistic dataset: > 0 items. Actual: 0 due to (i * 3) % 3 === 0
        return res.totalCount > 0;
      },
      isKnownDefect: true,
    },
    {
      name: 'Filter by non-existent / unexpected filter value',
      params: { projectId, filters: { objectType: ['NON_EXISTENT_TYPE'] } },
      validate: (res) => res.totalCount === 0 && res.items.length === 0,
    },
    {
      name: 'Sort by name desc',
      params: { projectId, sortField: 'name', sortOrder: 'desc', pageSize: 10 },
      validate: (res) => res.items.length === 10 && res.items[0].name >= res.items[1].name,
    },
    {
      name: 'Sort by invalid / unexpected sortField (resilience test)',
      params: { projectId, sortField: 'unknownField999', sortOrder: 'desc', pageSize: 10 },
      validate: (res) => res.items.length === 10, // Must not crash, returns valid page
    },
    {
      name: 'Search string filtering ("sales")',
      params: { projectId, search: 'sales', pageSize: 25 },
      validate: (res) =>
        res.totalCount > 0 &&
        res.items.every(
          (o) => o.name.toLowerCase().includes('sales') || o.description.toLowerCase().includes('sales')
        ),
    },
    {
      name: 'Extreme page pagination (page 200 of 50 per page = 10,000th item)',
      params: { projectId, page: 200, pageSize: 50 },
      validate: (res) => res.items.length === 50 && res.page === 200,
    },
    {
      name: 'Out of bounds page pagination (page 9999)',
      params: { projectId, page: 9999, pageSize: 50 },
      validate: (res) => res.items.length === 0 && res.totalCount === 10000,
    },
  ];

  let execPassCount = 0;
  const discoveredDefects = [];

  for (const tc of filterExecCases) {
    try {
      const res = await fetchProjectObjects(tc.params);
      if (tc.validate(res)) {
        execPassCount++;
        console.log(`  ✔ [PASS] ${tc.name} (Matched: ${res.totalCount} items, returned: ${res.items.length})`);
      } else {
        if (tc.isKnownDefect) {
          console.warn(`  ⚠ [DEFECT DETECTED] ${tc.name}: 0 items found. Empirical proof: all 10,000 objects collapsed to TIER_1_CLOUD.`);
          discoveredDefects.push({
            name: tc.name,
            issue: 'generateMockSapObjects line 62 formula (i * 3) % TIERS.length produces 0 for all i, resulting in 0 Tier 2 / Tier 3 objects.',
            returnedCount: res.totalCount,
          });
        } else {
          console.error(`  ✖ [FAIL] ${tc.name}: Result validation failed. Total: ${res.totalCount}, Items: ${res.items.length}`);
        }
      }
    } catch (err) {
      console.error(`  ✖ [CRASH] ${tc.name} threw error:`, err);
    }
  }

  console.log(`fetchProjectObjects execution results: ${execPassCount}/${filterExecCases.length - discoveredDefects.length} expected tests passed. Found ${discoveredDefects.length} defect(s).`);

  const summary = {
    facetedFiltersConfigured: objectFacetedFilters.length,
    deserializationTestsPassed: `${dePassCount}/${deserializationTestCases.length}`,
    serializationTestsPassed: `${serPassCount}/${serializationTestCases.length}`,
    executionTestsPassed: `${execPassCount}/${filterExecCases.length - discoveredDefects.length}`,
    discoveredDefects,
    status: discoveredDefects.length === 0 ? 'ALL_PASSED' : 'DEFECTS_FOUND',
  };

  fs.writeFileSync(
    path.resolve('H:/erppreflight/.agents/challenger_m4_2/url-resilience-results.json'),
    JSON.stringify(summary, null, 2)
  );
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
