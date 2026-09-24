import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  tenantId: string; // Organization UUID
  userId?: string;
  roles?: string[];
  organizationSlug?: string;
}

export const tenantLocalStorage = new AsyncLocalStorage<TenantContext>();

export function runWithTenantContext<R>(context: TenantContext, fn: () => R): R {
  return tenantLocalStorage.run(context, fn);
}

export function getTenantContext(): TenantContext | undefined {
  return tenantLocalStorage.getStore();
}

export function requireTenantId(): string {
  const ctx = getTenantContext();
  if (!ctx || !ctx.tenantId) {
    throw new Error('TenantContextMissingException: No active tenant context in async store');
  }
  return ctx.tenantId;
}

export class TenancyContext {
  static run<T>(store: TenantContext, callback: () => T): T {
    return runWithTenantContext(store, callback);
  }

  static get(): TenantContext | undefined {
    return getTenantContext();
  }

  static getTenantId(): string {
    return requireTenantId();
  }
}
