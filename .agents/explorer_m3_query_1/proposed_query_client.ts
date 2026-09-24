/**
 * ERP Preflight — Centralized SSR-Safe TanStack Query v5 Factory
 * Path: apps/web/src/lib/query/query-client.ts
 *
 * Implements:
 * - Strict SSR Isolation: Per-request QueryClient instance on server (prevents cross-tenant leaks)
 * - Browser Singleton: Reuses single instance on client across component re-renders
 * - Enterprise Stale & Cache Lifecycles: 1 minute staleTime, 10 minutes gcTime
 * - Deterministic Retry Policies: Never retries 4xx client errors (400, 401, 403, 404, 422)
 * - Exponential backoff for transient server/network errors (max 3 attempts)
 * - Hydration & Dehydration: Automatic inclusion of pending queries for SSR streaming
 */

import {
  QueryClient,
  defaultShouldDehydrateQuery,
  isServer,
  type QueryClientConfig,
  type Query,
} from '@tanstack/react-query';
import { ApiError } from '../../apps/web/src/lib/api/custom-instance';

/**
 * Enterprise query client configuration defaults for ERP Preflight.
 */
export const DEFAULT_QUERY_STALE_TIME_MS = 60 * 1000; // 1 minute
export const DEFAULT_QUERY_GC_TIME_MS = 10 * 60 * 1000; // 10 minutes (formerly cacheTime)
export const MAX_RETRY_COUNT = 3;

/**
 * Pure predicate checking whether a query failure should be retried.
 * Never retries HTTP 4xx client errors (security denial, unauthenticated, not found, validation).
 * Retries network errors or 5xx server errors up to MAX_RETRY_COUNT.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRY_COUNT) {
    return false;
  }

  // Handle typed ApiError from customInstance mutator
  if (error instanceof ApiError) {
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return false; // Do not retry client errors
    }
    return true; // Retry 5xx server errors
  }

  // Handle generic error objects with statusCode or status
  if (error && typeof error === 'object') {
    const status =
      'statusCode' in error && typeof (error as { statusCode: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 'status' in error && typeof (error as { status: unknown }).status === 'number'
        ? (error as { status: number }).status
        : null;

    if (status !== null && status >= 400 && status < 500) {
      return false;
    }
  }

  return true;
}

/**
 * Exponential backoff delay with jitter cap.
 */
export function calculateRetryDelay(attemptIndex: number): number {
  return Math.min(1000 * 2 ** attemptIndex, 30000);
}

/**
 * Creates a brand new QueryClient instance configured for ERP Preflight.
 */
export function makeQueryClient(overrides?: QueryClientConfig): QueryClient {
  return new QueryClient({
    ...overrides,
    defaultOptions: {
      ...overrides?.defaultOptions,
      queries: {
        staleTime: DEFAULT_QUERY_STALE_TIME_MS,
        gcTime: DEFAULT_QUERY_GC_TIME_MS,
        retry: shouldRetryQuery,
        retryDelay: calculateRetryDelay,
        refetchOnWindowFocus: process.env.NODE_ENV === 'production',
        refetchOnReconnect: true,
        refetchOnMount: true,
        ...overrides?.defaultOptions?.queries,
      },
      mutations: {
        retry: false, // Never auto-retry mutations (non-idempotent)
        ...overrides?.defaultOptions?.mutations,
      },
      dehydrate: {
        shouldDehydrateQuery: (query: Query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === 'pending',
        ...overrides?.defaultOptions?.dehydrate,
      },
    },
  });
}

/**
 * Client-side browser singleton reference.
 * Kept module-scoped so it persists across client re-renders and client route transitions.
 */
let browserQueryClient: QueryClient | undefined = undefined;

/**
 * Universal QueryClient getter complying with Next.js 15 App Router SSR rules:
 * - Server: Always returns a NEW QueryClient instance per invocation/request.
 * - Browser: Lazily instantiates and returns the singleton QueryClient.
 */
export function getQueryClient(overrides?: QueryClientConfig): QueryClient {
  if (isServer) {
    // Server execution: Fresh isolated instance per request
    return makeQueryClient(overrides);
  } else {
    // Browser execution: Return client-side singleton
    if (!browserQueryClient) {
      browserQueryClient = makeQueryClient(overrides);
    }
    return browserQueryClient;
  }
}

/**
 * Helper to explicitly teardown and wipe the browser QueryClient singleton.
 * Used during user logout or testing environments.
 */
export function resetBrowserQueryClient(): void {
  if (browserQueryClient) {
    browserQueryClient.cancelQueries();
    browserQueryClient.clear();
    browserQueryClient = undefined;
  }
}
