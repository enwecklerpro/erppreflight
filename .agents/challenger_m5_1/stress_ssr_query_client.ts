import { getQueryClient, makeQueryClient } from '../../apps/web/src/lib/query/query-client';
import { evictTenantQueryCache } from '../../apps/web/src/lib/query/query-provider';
import { dehydrate, isServer } from '@tanstack/react-query';
import { randomUUID } from 'node:crypto';

console.log('=== SSR QueryClient Concurrency & Isolation Stress Test ===');
console.log(`Environment: Node ${process.version}`);
console.log(`isServer detected by @tanstack/react-query: ${isServer}`);

if (!isServer) {
  console.error('FAIL: Expected isServer to be true in Node SSR environment!');
  process.exit(1);
}

async function runConcurrencyStressTest() {
  const CONCURRENT_REQUESTS = 500;
  console.log(`\n[Test 1] Spawning ${CONCURRENT_REQUESTS} concurrent simulated SSR requests...`);

  const createdClients = new Set();
  const collisionKeys = ['common-query-key', 'identical-findings-cache-key'];

  const tasks = Array.from({ length: CONCURRENT_REQUESTS }, async (_, i) => {
    const tenantId = `tenant-${i}-${randomUUID().slice(0, 8)}`;
    const client = getQueryClient();

    // Check instance uniqueness
    if (createdClients.has(client)) {
      throw new Error(`Instance collision detected! Client for ${tenantId} was already instantiated.`);
    }
    createdClients.add(client);

    // Write tenant-specific payload to identical common key across all requests
    // If there is ANY shared state, request B will corrupt request A's value
    const uniquePayload = {
      tenantId,
      secretAuditId: randomUUID(),
      riskScore: 40 + (i % 60),
      findings: [`FINDING-${i}-A`, `FINDING-${i}-B`],
    };

    client.setQueryData(collisionKeys, uniquePayload);
    client.setQueryData(['tenant-profile', tenantId], { org: `Org-${i}`, tenantId });

    // Yield to event loop with random delay to simulate concurrent I/O (DB / network)
    const delayMs = Math.floor(Math.random() * 20) + 1;
    await new Promise((res) => setTimeout(res, delayMs));

    // After async yield, verify integrity of own data
    const readCommon = client.getQueryData(collisionKeys);
    if (!readCommon || (readCommon as any).tenantId !== tenantId) {
      throw new Error(
        `Cross-request contamination on common key! Expected ${tenantId}, got: ${JSON.stringify(readCommon)}`
      );
    }

    const readProfile = client.getQueryData(['tenant-profile', tenantId]);
    if (!readProfile || (readProfile as any).tenantId !== tenantId) {
      throw new Error(`Profile query corrupted for ${tenantId}`);
    }

    // Verify query cache size on this client (should only have its own 2 queries)
    const cacheSize = client.getQueryCache().getAll().length;
    if (cacheSize !== 2) {
      throw new Error(`QueryCache size leak! Expected 2 queries, got ${cacheSize} for ${tenantId}`);
    }

    // Test SSR dehydration isolation
    const dehydrated = dehydrate(client);
    if (dehydrated.queries.length !== 2) {
      throw new Error(`Dehydration leak! Expected 2 dehydrated queries, got ${dehydrated.queries.length}`);
    }

    return { client, tenantId, uniquePayload };
  });

  const results = await Promise.all(tasks);
  console.log(`✓ All ${CONCURRENT_REQUESTS} concurrent SSR requests finished successfully.`);
  console.log(`✓ Unique QueryClient instances verified: ${createdClients.size}/${CONCURRENT_REQUESTS}`);

  console.log('\n[Test 2] Cross-checking isolation across all pairs...');
  // Sample 50 random pairs to deeply verify cross-queries are completely undefined
  for (let i = 0; i < 50; i++) {
    const idxA = Math.floor(Math.random() * results.length);
    let idxB = Math.floor(Math.random() * results.length);
    while (idxB === idxA) idxB = Math.floor(Math.random() * results.length);

    const clientA = results[idxA].client;
    const tenantB = results[idxB].tenantId;

    const crossLeak = clientA.getQueryData(['tenant-profile', tenantB]);
    if (crossLeak !== undefined) {
      throw new Error(`Cross-tenant data leaked! Client ${results[idxA].tenantId} can read ${tenantB} data!`);
    }
  }
  console.log('✓ Zero cross-tenant data leaks found across all random pair checks.');

  console.log('\n[Test 3] Stress-testing evictTenantQueryCache under concurrency...');
  // Ensure clearing one client cache does not affect another client
  const client1 = getQueryClient();
  const client2 = getQueryClient();
  client1.setQueryData(['key'], 'client-1-data');
  client2.setQueryData(['key'], 'client-2-data');

  await evictTenantQueryCache(client1);
  if (client1.getQueryData(['key']) !== undefined) {
    throw new Error('client1 data was not cleared!');
  }
  if (client2.getQueryData(['key']) !== 'client-2-data') {
    throw new Error('client2 data was unexpectedly mutated by client1 cache eviction!');
  }
  console.log('✓ Cache eviction on one SSR client did not affect other clients.');

  console.log('\n======================================================');
  console.log('ALL SSR QUERYCLIENT ISOLATION STRESS TESTS PASSED!');
  console.log('======================================================');
  process.exit(0);
}

runConcurrencyStressTest().catch((err) => {
  console.error('STRESS TEST FAILED:', err);
  process.exit(1);
});
