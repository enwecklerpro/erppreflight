import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getQueryClient,
  makeQueryClient,
  resetBrowserQueryClient,
  shouldRetryQuery,
  calculateRetryDelay,
  DEFAULT_QUERY_STALE_TIME_MS,
  DEFAULT_QUERY_GC_TIME_MS,
  MAX_RETRY_COUNT,
} from '../lib/query/query-client';
import { evictTenantQueryCache } from '../lib/query/query-provider';
import { ApiError } from '../lib/api/custom-instance';

describe('TanStack Query Client Architecture & SSR Isolation', () => {
  describe('SSR Isolation (Server Environment)', () => {
    afterEach(() => {
      vi.doUnmock('@tanstack/react-query');
      vi.resetModules();
    });

    it('produces a fresh QueryClient instance on every invocation in server environment', async () => {
      vi.resetModules();
      vi.doMock('@tanstack/react-query', async (importOriginal) => {
        const actual = await importOriginal<typeof import('@tanstack/react-query')>();
        return {
          ...actual,
          isServer: true,
        };
      });

      const { getQueryClient: getServerQueryClient } = await import('../lib/query/query-client');

      const clientA = getServerQueryClient();
      const clientB = getServerQueryClient();

      expect(clientA).not.toBe(clientB);
    });

    it('simulates 100 concurrent async requests with zero cross-request cache contamination', async () => {
      vi.resetModules();
      vi.doMock('@tanstack/react-query', async (importOriginal) => {
        const actual = await importOriginal<typeof import('@tanstack/react-query')>();
        return {
          ...actual,
          isServer: true,
        };
      });

      const { getQueryClient: getServerQueryClient } = await import('../lib/query/query-client');

      const requestCount = 100;
      const clientInstances = new Set();

      // Spawn 100 concurrent async requests
      const requestTasks = Array.from({ length: requestCount }, async (_, i) => {
        const client = getServerQueryClient();
        clientInstances.add(client);

        const tenantId = `tenant-${i}`;
        const secretPayload = {
          tenantId,
          confidentialHash: `sha256-hash-${i}`,
          tokens: [`token-A-${i}`, `token-B-${i}`],
        };

        // Store isolated tenant data in query client cache
        client.setQueryData(['tenant-profile', tenantId], secretPayload);

        // Simulate asynchronous I/O and processing delay
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));

        // Verify own data
        const retrieved = client.getQueryData(['tenant-profile', tenantId]);
        expect(retrieved).toEqual(secretPayload);

        return { client, tenantId, secretPayload };
      });

      const results = await Promise.all(requestTasks);

      // Ensure 100 distinct instances were instantiated
      expect(clientInstances.size).toBe(requestCount);

      // Verify zero cross-tenant contamination across all 100 instances
      for (let i = 0; i < results.length; i++) {
        const current = results[i];
        for (let j = 0; j < results.length; j++) {
          if (i !== j) {
            const crossData = current.client.getQueryData([
              'tenant-profile',
              results[j].tenantId,
            ]);
            expect(crossData).toBeUndefined();
          }
        }
      }
    });
  });

  describe('Browser Singleton (Client Environment)', () => {
    beforeEach(() => {
      resetBrowserQueryClient();
    });

    afterEach(() => {
      resetBrowserQueryClient();
    });

    it('returns the identical singleton instance across multiple invocations in browser', () => {
      const client1 = getQueryClient();
      const client2 = getQueryClient();
      const client3 = getQueryClient();

      expect(client1).toBe(client2);
      expect(client2).toBe(client3);

      // Writes to singleton cache are visible across all references
      client1.setQueryData(['session-state'], { activeUser: 'admin' });
      expect(client2.getQueryData(['session-state'])).toEqual({ activeUser: 'admin' });
      expect(client3.getQueryData(['session-state'])).toEqual({ activeUser: 'admin' });
    });

    it('resets browser QueryClient singleton on explicit resetBrowserQueryClient() teardown', () => {
      const client1 = getQueryClient();
      client1.setQueryData(['cached-key'], 'value-1');

      resetBrowserQueryClient();

      const client2 = getQueryClient();
      expect(client1).not.toBe(client2);
      expect(client2.getQueryData(['cached-key'])).toBeUndefined();
    });
  });

  describe('evictTenantQueryCache()', () => {
    it('calls cancelQueries() before clear() to prevent promise race conditions on tenant switch', async () => {
      const client = makeQueryClient();
      const executionTimeline: string[] = [];

      vi.spyOn(client, 'cancelQueries').mockImplementation(async () => {
        executionTimeline.push('cancelQueries');
      });

      vi.spyOn(client, 'clear').mockImplementation(() => {
        executionTimeline.push('clear');
      });

      await evictTenantQueryCache(client);

      expect(executionTimeline).toEqual(['cancelQueries', 'clear']);
    });

    it('successfully purges all cached query and mutation data from the QueryClient', async () => {
      const client = makeQueryClient();
      client.setQueryData(['tenant', 'workspace-1'], { name: 'SAP Production' });
      client.setQueryData(['tenant', 'findings'], [{ id: 'f-1', code: 'CLEAN_CORE' }]);

      expect(client.getQueryData(['tenant', 'workspace-1'])).toBeDefined();
      expect(client.getQueryCache().getAll().length).toBe(2);

      await evictTenantQueryCache(client);

      expect(client.getQueryData(['tenant', 'workspace-1'])).toBeUndefined();
      expect(client.getQueryData(['tenant', 'findings'])).toBeUndefined();
      expect(client.getQueryCache().getAll().length).toBe(0);
    });
  });

  describe('Deterministic Retry Policies & Error Classification', () => {
    it('never retries HTTP 4xx client errors (400, 401, 403, 404, 422)', () => {
      const clientErrorCodes = [400, 401, 403, 404, 422, 429];

      for (const code of clientErrorCodes) {
        const apiError = new ApiError(code, {
          statusCode: code,
          message: `Client error ${code}`,
        });
        expect(shouldRetryQuery(0, apiError)).toBe(false);
        expect(shouldRetryQuery(1, apiError)).toBe(false);

        // Also test generic error objects with status or statusCode
        expect(shouldRetryQuery(0, { statusCode: code })).toBe(false);
        expect(shouldRetryQuery(0, { status: code })).toBe(false);
      }
    });

    it('retries transient 5xx server errors and network errors up to MAX_RETRY_COUNT', () => {
      const server500 = new ApiError(500, { statusCode: 500, message: 'Internal Server Error' });
      const server502 = new ApiError(502, { statusCode: 502, message: 'Bad Gateway' });
      const server503 = new ApiError(503, { statusCode: 503, message: 'Service Unavailable' });
      const networkError = new Error('Network error: ECONNREFUSED');

      const errors = [server500, server502, server503, networkError];

      for (const err of errors) {
        expect(shouldRetryQuery(0, err)).toBe(true);
        expect(shouldRetryQuery(1, err)).toBe(true);
        expect(shouldRetryQuery(2, err)).toBe(true);
        // Exceeds MAX_RETRY_COUNT (3)
        expect(shouldRetryQuery(3, err)).toBe(false);
        expect(shouldRetryQuery(4, err)).toBe(false);
      }
    });

    it('calculates exponential backoff delay capped at 30,000ms', () => {
      expect(calculateRetryDelay(0)).toBe(1000);
      expect(calculateRetryDelay(1)).toBe(2000);
      expect(calculateRetryDelay(2)).toBe(4000);
      expect(calculateRetryDelay(3)).toBe(8000);
      expect(calculateRetryDelay(4)).toBe(16000);
      expect(calculateRetryDelay(5)).toBe(30000); // capped at 30s
      expect(calculateRetryDelay(10)).toBe(30000); // capped at 30s
    });

    it('configures default enterprise stale time and gc time', () => {
      const client = makeQueryClient();
      const defaultQueries = client.getDefaultOptions().queries;

      expect(defaultQueries?.staleTime).toBe(DEFAULT_QUERY_STALE_TIME_MS);
      expect(defaultQueries?.staleTime).toBe(60 * 1000);
      expect(defaultQueries?.gcTime).toBe(DEFAULT_QUERY_GC_TIME_MS);
      expect(defaultQueries?.gcTime).toBe(10 * 60 * 1000);
      expect(MAX_RETRY_COUNT).toBe(3);
    });
  });
});
