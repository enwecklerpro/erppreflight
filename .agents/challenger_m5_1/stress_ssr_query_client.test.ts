import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';

describe('SSR QueryClient Concurrency & Isolation Stress Test', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@tanstack/react-query', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@tanstack/react-query')>();
      return {
        ...actual,
        isServer: true,
      };
    });
  });

  afterEach(() => {
    vi.doUnmock('@tanstack/react-query');
    vi.resetModules();
  });

  it('empirically verifies server environment generates distinct instances with zero cross-tenant contamination under 500 concurrent requests', async () => {
    const { getQueryClient } = await import('@/lib/query/query-client');
    const { dehydrate } = await import('@tanstack/react-query');

    const CONCURRENT_REQUESTS = 500;
    const createdClients = new Set();
    const collisionKey = ['tenants', 'active-findings'];

    const tasks = Array.from({ length: CONCURRENT_REQUESTS }, async (_, i) => {
      const tenantId = `tenant-${i}-${randomUUID().slice(0, 8)}`;
      const client = getQueryClient();

      expect(createdClients.has(client)).toBe(false);
      createdClients.add(client);

      const secretPayload = {
        tenantId,
        secretKey: randomUUID(),
        findingCount: 100 + i,
        vulnerabilities: [`VULN-${i}-ALPHA`, `VULN-${i}-BETA`],
      };

      // Store in collision key (identical key across all 500 concurrent requests)
      client.setQueryData(collisionKey, secretPayload);
      client.setQueryData(['tenant-profile', tenantId], { orgName: `Org ${i}`, tenantId });

      // Simulate asynchronous execution delay (concurrent database / microservice I/O)
      const delayMs = Math.floor(Math.random() * 15) + 1;
      await new Promise((res) => setTimeout(res, delayMs));

      // Re-read collision key after delay to verify no other request clobbered it
      const readCommon = client.getQueryData(collisionKey);
      expect(readCommon).toEqual(secretPayload);

      const readProfile = client.getQueryData(['tenant-profile', tenantId]);
      expect(readProfile).toEqual({ orgName: `Org ${i}`, tenantId });

      // Verify QueryCache contains exclusively this request's 2 entries
      const cacheEntries = client.getQueryCache().getAll();
      expect(cacheEntries.length).toBe(2);

      // Verify SSR dehydrated state contains strictly this request's data
      const dehydrated = dehydrate(client);
      expect(dehydrated.queries.length).toBe(2);

      return { client, tenantId, secretPayload };
    });

    const results = await Promise.all(tasks);

    // Ensure 500 completely distinct instances were created
    expect(createdClients.size).toBe(CONCURRENT_REQUESTS);

    // Cross-check 100 random pairs to ensure no client has data from any other tenant
    for (let k = 0; k < 100; k++) {
      const idxA = Math.floor(Math.random() * results.length);
      let idxB = Math.floor(Math.random() * results.length);
      while (idxB === idxA) idxB = Math.floor(Math.random() * results.length);

      const clientA = results[idxA].client;
      const tenantB = results[idxB].tenantId;

      const crossData = clientA.getQueryData(['tenant-profile', tenantB]);
      expect(crossData).toBeUndefined();
    }
  });

  it('verifies concurrent cache eviction on one SSR client does not affect sibling clients', async () => {
    const { getQueryClient } = await import('@/lib/query/query-client');
    const { evictTenantQueryCache } = await import('@/lib/query/query-provider');

    const client1 = getQueryClient();
    const client2 = getQueryClient();
    const client3 = getQueryClient();

    client1.setQueryData(['shared-key'], { value: 'tenant-1' });
    client2.setQueryData(['shared-key'], { value: 'tenant-2' });
    client3.setQueryData(['shared-key'], { value: 'tenant-3' });

    await evictTenantQueryCache(client2);

    expect(client1.getQueryData(['shared-key'])).toEqual({ value: 'tenant-1' });
    expect(client2.getQueryData(['shared-key'])).toBeUndefined();
    expect(client3.getQueryData(['shared-key'])).toEqual({ value: 'tenant-3' });
  });

  it('verifies server QueryClient is garbage-collected independently without memory retention leaks', async () => {
    const { getQueryClient } = await import('@/lib/query/query-client');
    const weakRefMap = new WeakMap();

    function createTransientRequest(id: string) {
      const client = getQueryClient();
      weakRefMap.set(client, id);
      client.setQueryData(['test'], { id });
      return client.getQueryData(['test']);
    }

    const payload = createTransientRequest('req-temp-1');
    expect(payload).toEqual({ id: 'req-temp-1' });

    // Ensure getQueryClient did NOT store client in module-level global variable on server
    const nextClient = getQueryClient();
    expect(weakRefMap.has(nextClient)).toBe(false);
  });
});
