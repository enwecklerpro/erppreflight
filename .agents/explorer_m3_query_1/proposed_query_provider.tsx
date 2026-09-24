'use client';

/**
 * ERP Preflight — Root TanStack Query Provider & Tenant Eviction Controller
 * Path: apps/web/src/lib/query/query-provider.tsx
 *
 * Implements:
 * - Next.js 15 App Router client provider pattern
 * - Automatic tenant cache eviction on organization switch or logout
 * - Cross-tab cache synchronization via storage event listener
 * - AbortController integration: cancels in-flight queries before wiping cache
 * - Reusable useTenantSwitch() and useLogout() coordination hooks
 * - Development environment ReactQueryDevtools integration
 */

import React, { useEffect, useRef, useCallback } from 'react';
import {
  QueryClientProvider,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useRouter } from 'next/navigation';
import { getQueryClient } from './proposed_query_client';
import {
  TENANT_ID_KEY,
  AUTH_TOKEN_KEY,
  setStoredTenantId,
  setStoredAuthToken,
} from '../../apps/web/src/lib/api/custom-instance';

/**
 * Custom window events dispatched across the client application.
 */
export const TENANT_CHANGE_EVENT = 'erppreflight:tenant-change';
export const AUTH_LOGOUT_EVENT = 'erppreflight:auth-logout';

export interface TenantChangeEventDetail {
  previousTenantId?: string | null;
  newTenantId: string | null;
}

export interface QueryProviderProps {
  children: React.ReactNode;
  /**
   * Optional active tenant/organization ID to monitor for reactive eviction.
   */
  tenantId?: string | null;
}

/**
 * Executes a clean, deterministic cache wipe sequence:
 * 1. Cancels all in-flight active queries (aborts network fetches via AbortController)
 * 2. Purges the entire TanStack Query cache (removes all queries, mutations, and cached data)
 */
export async function evictTenantQueryCache(client: QueryClient): Promise<void> {
  // 1. Abort in-flight network queries
  await client.cancelQueries();

  // 2. Clear all query and mutation cache entries
  client.clear();
}

/**
 * Root TanStack Query Provider component for ERP Preflight.
 */
export function QueryProvider({ children, tenantId }: QueryProviderProps) {
  // Use universal SSR-safe query client getter.
  // In the browser, this returns the stable singleton instance.
  // In SSR, it creates a fresh per-request instance.
  const queryClient = getQueryClient();

  const prevTenantRef = useRef<string | null | undefined>(tenantId);

  // Monitor tenantId prop transitions (e.g. when route or server context changes)
  useEffect(() => {
    if (
      prevTenantRef.current !== undefined &&
      prevTenantRef.current !== null &&
      tenantId !== prevTenantRef.current
    ) {
      evictTenantQueryCache(queryClient);
    }
    prevTenantRef.current = tenantId;
  }, [tenantId, queryClient]);

  // Register browser listeners for cross-tab and in-app tenant/auth events
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. In-app custom event: Tenant switched
    const handleTenantSwitch = (event: Event) => {
      const customEvent = event as CustomEvent<TenantChangeEventDetail>;
      evictTenantQueryCache(queryClient);
    };

    // 2. In-app custom event: User logged out
    const handleLogout = () => {
      evictTenantQueryCache(queryClient);
    };

    // 3. Cross-tab synchronization: Storage event
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === TENANT_ID_KEY || event.key === AUTH_TOKEN_KEY) {
        evictTenantQueryCache(queryClient);
      }
    };

    window.addEventListener(TENANT_CHANGE_EVENT, handleTenantSwitch);
    window.addEventListener(AUTH_LOGOUT_EVENT, handleLogout);
    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener(TENANT_CHANGE_EVENT, handleTenantSwitch);
      window.removeEventListener(AUTH_LOGOUT_EVENT, handleLogout);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
      )}
    </QueryClientProvider>
  );
}

/**
 * Reusable hook to programmatically switch tenants with complete cache eviction.
 */
export function useTenantSwitch() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useCallback(
    async (newTenantId: string, redirectUrl?: string) => {
      // 1. Cancel and clear cache
      await evictTenantQueryCache(queryClient);

      // 2. Update browser storage
      setStoredTenantId(newTenantId);

      // 3. Dispatch broadcast event for listeners
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent<TenantChangeEventDetail>(TENANT_CHANGE_EVENT, {
            detail: { newTenantId },
          })
        );
      }

      // 4. Navigate to new organization view if requested
      if (redirectUrl) {
        router.push(redirectUrl);
      }
    },
    [queryClient, router]
  );
}

/**
 * Reusable hook to programmatically log out with complete cache and credential eviction.
 */
export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useCallback(
    async (redirectTo = '/login') => {
      // 1. Cancel in-flight queries and wipe cache
      await evictTenantQueryCache(queryClient);

      // 2. Wipe tokens and tenant identifiers
      setStoredAuthToken(null);
      setStoredTenantId(null);

      // 3. Dispatch logout broadcast event
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(AUTH_LOGOUT_EVENT));
      }

      // 4. Redirect to login
      router.push(redirectTo);
    },
    [queryClient, router]
  );
}

export default QueryProvider;
