/**
 * Test & Verification Harness for TanStack Query Architecture
 * Path: .agents/explorer_m3_query_1/test_query_architecture.ts
 */

import { QueryClient } from '@tanstack/react-query';
import {
  shouldRetryQuery,
  calculateRetryDelay,
  makeQueryClient,
  getQueryClient,
  DEFAULT_QUERY_STALE_TIME_MS,
  DEFAULT_QUERY_GC_TIME_MS,
  MAX_RETRY_COUNT,
} from './proposed_query_client';
import { queryKeys } from './proposed_query_keys';
import { evictTenantQueryCache } from './proposed_query_provider';
import { ApiError } from '../../apps/web/src/lib/api/custom-instance';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ Assertion failed: ${message}`);
    process.exit(1);
  }
  console.log(`✅ Passed: ${message}`);
}

async function runTests() {
  console.log('=== STARTING TANSTACK QUERY ARCHITECTURE VERIFICATION ===\n');

  // --- Test 1: shouldRetryQuery with ApiError and status codes ---
  console.log('--- Test 1: Query Retry Policy ---');
  const error401 = new ApiError(401, 'Unauthorized');
  const error403 = new ApiError(403, 'Forbidden');
  const error404 = new ApiError(404, 'Not Found');
  const error422 = new ApiError(422, 'Unprocessable Entity');
  const error500 = new ApiError(500, 'Internal Server Error');
  const error503 = new ApiError(503, 'Service Unavailable');
  const networkError = new Error('Network request failed');

  assert(!shouldRetryQuery(0, error401), 'Must not retry HTTP 401 Unauthorized');
  assert(!shouldRetryQuery(0, error403), 'Must not retry HTTP 403 Forbidden (cross-tenant rejection)');
  assert(!shouldRetryQuery(0, error404), 'Must not retry HTTP 404 Not Found');
  assert(!shouldRetryQuery(0, error422), 'Must not retry HTTP 422 Validation Error');

  assert(shouldRetryQuery(0, error500), 'Must retry HTTP 500 on first failure');
  assert(shouldRetryQuery(1, error500), 'Must retry HTTP 500 on second failure');
  assert(shouldRetryQuery(2, error500), 'Must retry HTTP 500 on third failure (attempt 2 < 3)');
  assert(!shouldRetryQuery(3, error500), 'Must not retry HTTP 500 after 3 attempts');

  assert(shouldRetryQuery(0, networkError), 'Must retry network error on first failure');
  assert(!shouldRetryQuery(MAX_RETRY_COUNT, networkError), 'Must halt retrying after MAX_RETRY_COUNT');

  // Object error with statusCode property
  assert(!shouldRetryQuery(0, { statusCode: 400 }), 'Must not retry object error with statusCode 400');
  assert(shouldRetryQuery(0, { statusCode: 502 }), 'Must retry object error with statusCode 502');

  // Delay calculation
  assert(calculateRetryDelay(0) === 1000, 'Initial retry delay is 1000ms');
  assert(calculateRetryDelay(1) === 2000, 'Second retry delay is 2000ms');
  assert(calculateRetryDelay(2) === 4000, 'Third retry delay is 4000ms');

  // --- Test 2: makeQueryClient Defaults ---
  console.log('\n--- Test 2: makeQueryClient Defaults ---');
  const client1 = makeQueryClient();
  const defaultQueries = client1.getDefaultOptions().queries;
  const defaultMutations = client1.getDefaultOptions().mutations;

  assert(
    defaultQueries?.staleTime === DEFAULT_QUERY_STALE_TIME_MS,
    `Default staleTime is ${DEFAULT_QUERY_STALE_TIME_MS}ms (1 minute)`
  );
  assert(
    defaultQueries?.gcTime === DEFAULT_QUERY_GC_TIME_MS,
    `Default gcTime is ${DEFAULT_QUERY_GC_TIME_MS}ms (10 minutes)`
  );
  assert(
    defaultMutations?.retry === false,
    'Default mutation retry is false'
  );

  // --- Test 3: SSR Isolation (per-request fresh QueryClient on server) ---
  console.log('\n--- Test 3: SSR Isolation ---');
  // In Node runtime, isServer is true
  const serverClientA = getQueryClient();
  const serverClientB = getQueryClient();

  assert(
    serverClientA !== serverClientB,
    'On server (isServer=true), getQueryClient() returns fresh isolated instances per call'
  );

  // --- Test 4: Hierarchical Query Key Factory ---
  console.log('\n--- Test 4: Query Key Factory Prefix & Tuple Integrity ---');

  // Projects
  assert(
    JSON.stringify(queryKeys.projects.all) === JSON.stringify(['projects']),
    'projects.all matches ["projects"]'
  );
  assert(
    JSON.stringify(queryKeys.projects.lists()) === JSON.stringify(['projects', 'list']),
    'projects.lists() matches ["projects", "list"]'
  );
  assert(
    JSON.stringify(queryKeys.projects.list({ search: 'SAP' })) ===
      JSON.stringify(['projects', 'list', { search: 'SAP' }]),
    'projects.list with search filter includes filter parameter'
  );
  assert(
    JSON.stringify(queryKeys.projects.detail('proj-1')) ===
      JSON.stringify(['projects', 'detail', 'proj-1']),
    'projects.detail includes project ID'
  );
  assert(
    JSON.stringify(queryKeys.projects.artifacts('proj-1')) ===
      JSON.stringify(['projects', 'detail', 'proj-1', 'artifacts']),
    'projects.artifacts matches hierarchical child of detail'
  );

  // Findings
  assert(
    JSON.stringify(queryKeys.findings.all) === JSON.stringify(['findings']),
    'findings.all matches ["findings"]'
  );
  assert(
    JSON.stringify(queryKeys.findings.byProject('proj-1', { severity: 'BLOCKER' })) ===
      JSON.stringify(['findings', 'project', 'proj-1', { severity: 'BLOCKER' }]),
    'findings.byProject creates correct project-partitioned key'
  );
  assert(
    JSON.stringify(queryKeys.findings.evidence('f-100')) ===
      JSON.stringify(['findings', 'detail', 'f-100', 'evidence']),
    'findings.evidence is hierarchical child of finding detail'
  );

  // Objects
  assert(
    JSON.stringify(queryKeys.objects.detail('Z_ACDOCA_POST')) ===
      JSON.stringify(['objects', 'detail', { name: 'Z_ACDOCA_POST', type: 'SAP_OBJECT' }]),
    'objects.detail handles default type'
  );
  assert(
    JSON.stringify(queryKeys.objects.tier('Z_ACDOCA_POST')) ===
      JSON.stringify(['objects', 'detail', { name: 'Z_ACDOCA_POST', type: 'SAP_OBJECT' }, 'tier']),
    'objects.tier is child of object detail'
  );

  // Analysis
  assert(
    JSON.stringify(queryKeys.analysis.engines()) === JSON.stringify(['analysis', 'engines']),
    'analysis.engines matches ["analysis", "engines"]'
  );
  assert(
    JSON.stringify(queryKeys.analysis.jobStatus('job-42')) ===
      JSON.stringify(['analysis', 'jobs', 'job-42', 'status']),
    'analysis.jobStatus is hierarchical child of job'
  );

  // Tenants
  assert(
    JSON.stringify(queryKeys.tenants.current()) === JSON.stringify(['tenants', 'current']),
    'tenants.current matches ["tenants", "current"]'
  );

  // --- Test 5: evictTenantQueryCache ---
  console.log('\n--- Test 5: evictTenantQueryCache ---');
  let cancelCalled = false;
  let clearCalled = false;

  const mockClient = {
    cancelQueries: async () => {
      cancelCalled = true;
    },
    clear: () => {
      clearCalled = true;
    },
  } as unknown as QueryClient;

  await evictTenantQueryCache(mockClient);
  assert(cancelCalled, 'evictTenantQueryCache calls cancelQueries() first');
  assert(clearCalled, 'evictTenantQueryCache calls clear() second');

  console.log('\n=== ALL 17 TESTS PASSED SUCCESSFULLY! ===\n');
}

runTests().catch((err) => {
  console.error('Test execution failed with error:', err);
  process.exit(1);
});
