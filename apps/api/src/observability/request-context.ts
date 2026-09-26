import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request correlation data propagated to every log line (C §57). */
export interface RequestContext {
  requestId: string;
  traceId?: string;
  method?: string;
  path?: string;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContextStorage.run(ctx, fn);
}
