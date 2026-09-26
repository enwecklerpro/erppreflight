import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import {
  MemoryRateLimitStore,
  RedisLike,
  RedisRateLimitStore,
} from '../src/modules/rate-limit/rate-limit.store';
import {
  RateLimiterService,
  hashIdentifier,
  resolveFailureMode,
} from '../src/modules/rate-limit/rate-limiter.service';
import {
  AUTH_RATE_LIMIT_KEY,
  AuthRateLimitGuard,
  RateLimitRule,
} from '../src/modules/auth/guards/auth-rate-limit.guard';
import { MFA_MAX_FAILURES, TwoFactorService } from '../src/modules/auth/two-factor.service';
import {
  createConnectorHttp,
  distributedConnectorLimiter,
  ConnectorAttemptInfo,
  ConnectorRateLimitedError,
} from '../src/modules/connectors/connector-http';
import { UnsafeOutboundUrlError } from '../src/common/security/outbound-request';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const RULE: RateLimitRule = { name: 'unit-login', windowMs: 60_000, maxPerIp: 5, maxPerIpAndEmail: 2 };

function guardContext(ip: string, email: string, headers: Record<string, string> = {}) {
  const handler = () => undefined;
  Reflect.defineMetadata(AUTH_RATE_LIMIT_KEY, RULE, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ ip, body: { email } }),
      getResponse: () => ({ setHeader: (k: string, v: string) => (headers[k] = v) }),
    }),
  } as any;
}

/** A Redis client whose every command fails (Redis down / partitioned). */
const brokenRedis: RedisLike = {
  eval: async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
  },
  get: async () => {
    throw new Error('connect ECONNREFUSED');
  },
  pttl: async () => {
    throw new Error('connect ECONNREFUSED');
  },
  del: async () => {
    throw new Error('connect ECONNREFUSED');
  },
};

const scaleBackup = process.env.AUTH_RATE_LIMIT_SCALE;
afterEach(() => {
  if (scaleBackup === undefined) delete process.env.AUTH_RATE_LIMIT_SCALE;
  else process.env.AUTH_RATE_LIMIT_SCALE = scaleBackup;
});

// ---------------------------------------------------------------------------
// Memory store semantics (also the Redis-outage fallback)
// ---------------------------------------------------------------------------
describe('MemoryRateLimitStore (fixed window + token bucket)', () => {
  it('rejects without counting when any budget is exhausted, then resets after the window', async () => {
    let now = 0;
    const store = new MemoryRateLimitStore(() => now);
    const checks = [
      { key: 'ip', limit: 3 },
      { key: 'ipmail', limit: 1 },
    ];
    expect((await store.consume(checks, 1000)).allowed).toBe(true);
    const denied = await store.consume(checks, 1000);
    expect(denied).toEqual({ allowed: false, blockedIndex: 1, retryAfterMs: 1000 });
    // The rejected call did not consume the per-IP budget.
    expect((await store.peek('ip')).count).toBe(1);
    now = 1000;
    expect((await store.consume(checks, 1000)).allowed).toBe(true);
  });

  it('counts increments inside the window and forgets them afterwards', async () => {
    let now = 0;
    const store = new MemoryRateLimitStore(() => now);
    await store.increment('k', 500);
    expect((await store.increment('k', 500)).count).toBe(2);
    now = 499;
    expect((await store.peek('k')).count).toBe(2);
    now = 500;
    expect((await store.peek('k')).count).toBe(0);
  });

  it('refills tokens at the configured rate', async () => {
    let now = 0;
    const store = new MemoryRateLimitStore(() => now);
    expect((await store.takeToken('b', 2, 1, 60_000)).allowed).toBe(true);
    expect((await store.takeToken('b', 2, 1, 60_000)).allowed).toBe(true);
    const denied = await store.takeToken('b', 2, 1, 60_000);
    expect(denied).toEqual({ allowed: false, retryAfterMs: 1000 });
    now = 1000;
    expect((await store.takeToken('b', 2, 1, 60_000)).allowed).toBe(true);
  });

  it('stays bounded under many distinct sources', async () => {
    const store = new MemoryRateLimitStore(Date.now, 100);
    for (let i = 0; i < 1000; i++) await store.consume([{ key: `k${i}`, limit: 5 }], 60_000);
    expect(store.size).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Service: keys, failure modes
// ---------------------------------------------------------------------------
describe('RateLimiterService', () => {
  it('namespaces keys and never stores raw identifiers', () => {
    const svc = RateLimiterService.inMemory();
    const key = svc.key('login', 'ipmail', '203.0.113.9|victim@example.com');
    expect(key).toBe(`erppreflight:rl:login:ipmail:${hashIdentifier('203.0.113.9|victim@example.com')}`);
    expect(key).not.toContain('victim');
    expect(() => svc.key('bad namespace!', 'ip', 'x')).toThrow();
  });

  it("falls back to the bounded in-memory limiter when Redis fails (default 'memory' mode, never fail-open)", async () => {
    const svc = RateLimiterService.withRedis(brokenRedis, 'memory');
    const budgets = [{ scope: 'ip', id: '198.51.100.1', limit: 2 }];
    expect((await svc.consume('fallback', budgets, 60_000)).backend).toBe('memory');
    expect((await svc.consume('fallback', budgets, 60_000)).allowed).toBe(true);
    const third = await svc.consume('fallback', budgets, 60_000);
    expect(third.allowed).toBe(false);
    expect(third.blockedScope).toBe('ip');
    expect(svc.status()).toMatchObject({ configured: 'redis', active: 'memory', failureMode: 'memory' });
    expect(svc.status().lastError).toMatch(/ECONNREFUSED/);
  });

  it("refuses requests in 'closed' mode while Redis is unavailable", async () => {
    const svc = RateLimiterService.withRedis(brokenRedis, 'closed');
    const d = await svc.consume('closed', [{ scope: 'ip', id: '198.51.100.2', limit: 100 }], 60_000);
    expect(d).toMatchObject({ allowed: false, backend: 'unavailable' });
    await expect(svc.peek('closed', 'user', 'u1')).rejects.toThrow(/unavailable/);
    const guard = new AuthRateLimitGuard(new Reflector(), svc);
    await expect(guard.canActivate(guardContext('198.51.100.2', 'a@b.example'))).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
  });

  it('keys the budget by the same client address as the IP allowlist (IPv4-mapped IPv6 folded)', async () => {
    const previous = process.env.AUTH_RATE_LIMIT_SCALE;
    process.env.AUTH_RATE_LIMIT_SCALE = '1';
    try {
      const svc = RateLimiterService.inMemory();
      const guard = new AuthRateLimitGuard(new Reflector(), svc);
      // RULE: 5 per IP; alternating ::ffff:a.b.c.d / a.b.c.d must share one budget.
      for (let i = 0; i < 5; i++) {
        const ip = i % 2 ? '::ffff:203.0.113.77' : '203.0.113.77';
        await expect(guard.canActivate(guardContext(ip, `u${i}@b.example`))).resolves.toBe(true);
      }
      await expect(guard.canActivate(guardContext('::ffff:203.0.113.77', 'u9@b.example'))).rejects.toBeDefined();
    } finally {
      if (previous === undefined) delete process.env.AUTH_RATE_LIMIT_SCALE;
      else process.env.AUTH_RATE_LIMIT_SCALE = previous;
    }
  });

  it('parses the failure mode setting', () => {
    expect(resolveFailureMode(undefined)).toBe('memory');
    expect(resolveFailureMode('CLOSED')).toBe('closed');
    expect(resolveFailureMode('open')).toBe('memory');
  });
});

// ---------------------------------------------------------------------------
// Two-factor failures use the shared limiter
// ---------------------------------------------------------------------------
describe('TwoFactorService failure budget (shared limiter)', () => {
  function service(limiter: RateLimiterService) {
    const config = { getOrThrow: () => 'k'.repeat(64) } as any;
    return new TwoFactorService({} as any, {} as any, {} as any, {} as any, {} as any, config, limiter) as any;
  }

  it('blocks after MFA_MAX_FAILURES failures recorded by ANY instance, and a success clears it', async () => {
    const limiter = RateLimiterService.inMemory();
    const a = service(limiter);
    const b = service(limiter);
    for (let i = 0; i < MFA_MAX_FAILURES; i++) await (i % 2 ? a : b).recordFailure('user-1');
    const err = await b.checkFailureBudget('user-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    await a.clearFailures('user-1');
    await expect(b.checkFailureBudget('user-1')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Connector HTTP: shared token bucket + per-attempt metering hook
// ---------------------------------------------------------------------------
describe('Connector HTTP limiter and metering hook', () => {
  const ok = (async () => ({ status: 200, headers: {}, body: Buffer.from('{}'), text: () => '{}', json: () => ({}) })) as any;

  it('uses the shared token bucket and reports every attempt that reached the network', async () => {
    const limiter = RateLimiterService.inMemory();
    const attempts: ConnectorAttemptInfo[] = [];
    const http = createConnectorHttp(`c-${randomUUID()}`, {
      limiter: distributedConnectorLimiter(limiter, { burst: 1, perSecond: 0.001 }),
      fetchImpl: ok,
      onAttempt: (info) => {
        attempts.push(info);
      },
    });
    await http.request({ url: 'https://jira.example.com/rest/api/3/myself?token=secret' });
    await expect(http.request({ url: 'https://jira.example.com/x' })).rejects.toBeInstanceOf(ConnectorRateLimitedError);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ method: 'GET', host: 'jira.example.com', status: 200, attempt: 1, error: null });
    expect(JSON.stringify(attempts)).not.toContain('secret');
  });

  it('meters retries individually and does not meter SSRF-blocked calls', async () => {
    const attempts: ConnectorAttemptInfo[] = [];
    let calls = 0;
    const http = createConnectorHttp(`c-${randomUUID()}`, {
      limiter: distributedConnectorLimiter(RateLimiterService.inMemory()),
      sleepImpl: async () => undefined,
      onAttempt: (info) => {
        attempts.push(info);
      },
      fetchImpl: (async () => {
        calls++;
        return { status: calls < 2 ? 503 : 200, headers: {}, body: Buffer.alloc(0), text: () => '', json: () => ({}) };
      }) as any,
    });
    await http.request({ url: 'https://svc.example.com' });
    expect(attempts.map((a) => a.status)).toEqual([503, 200]);

    const blocked: ConnectorAttemptInfo[] = [];
    const ssrf = createConnectorHttp(`c-${randomUUID()}`, {
      limiter: distributedConnectorLimiter(RateLimiterService.inMemory()),
      onAttempt: (info) => {
        blocked.push(info);
      },
      fetchImpl: (async () => {
        throw new UnsafeOutboundUrlError('10.0.0.1 is private');
      }) as any,
    });
    await expect(ssrf.request({ url: 'https://10.0.0.1' })).rejects.toBeInstanceOf(UnsafeOutboundUrlError);
    expect(blocked).toHaveLength(0);
  });

  it('never fails a call because the metering hook throws', async () => {
    const http = createConnectorHttp(`c-${randomUUID()}`, {
      limiter: distributedConnectorLimiter(RateLimiterService.inMemory()),
      fetchImpl: ok,
      onAttempt: () => {
        throw new Error('db down');
      },
    });
    await expect(http.request({ url: 'https://svc.example.com' })).resolves.toMatchObject({ status: 200 });
  });
});

// ---------------------------------------------------------------------------
// Real Redis: two independent clients (= two API processes) share one budget.
// Uses logical DB 15 (override with RATE_LIMIT_TEST_REDIS_URL) and unique keys;
// skipped when no Redis is reachable.
// ---------------------------------------------------------------------------
const redisUrl = process.env.RATE_LIMIT_TEST_REDIS_URL || 'redis://localhost:6379/15';
async function connect(): Promise<Redis | null> {
  const client = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false, connectTimeout: 500, retryStrategy: () => null });
  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.ping();
    return client;
  } catch {
    client.disconnect();
    return null;
  }
}
let clientA: Redis | null = null;
let clientB: Redis | null = null;
const prefix = `rl-test-${randomUUID()}`;

beforeAll(async () => {
  clientA = await connect();
  clientB = clientA ? await connect() : null;
});

afterAll(async () => {
  if (clientA) {
    const keys = await clientA.keys(`*${prefix}*`).catch(() => [] as string[]);
    if (keys.length) await clientA.del(...keys);
    clientA.disconnect();
  }
  clientB?.disconnect();
});

describe('RedisRateLimitStore (live Redis, two clients; skipped without Redis)', () => {
  beforeEach((ctx) => {
    if (!clientA || !clientB) ctx.skip();
  });

  it('atomic fixed window is shared by two clients and sets an expiry', async () => {
    const a = new RedisRateLimitStore(clientA as unknown as RedisLike);
    const b = new RedisRateLimitStore(clientB as unknown as RedisLike);
    const checks = [{ key: `${prefix}:ip`, limit: 4 }];
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).consume(checks, 60_000)));
    expect(results.filter((r) => r.allowed)).toHaveLength(4);
    const denied = results.find((r) => !r.allowed)!;
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(60_000);
    expect(Number(await clientA!.get(`${prefix}:ip`))).toBe(4);
    expect(await clientA!.pttl(`${prefix}:ip`)).toBeGreaterThan(0);
  });

  it('guards built on two services (two API processes) share the login budget', async () => {
    process.env.AUTH_RATE_LIMIT_SCALE = '1';
    const svcA = RateLimiterService.withRedis(clientA as unknown as RedisLike);
    const svcB = RateLimiterService.withRedis(clientB as unknown as RedisLike);
    const guardA = new AuthRateLimitGuard(new Reflector(), svcA);
    const guardB = new AuthRateLimitGuard(new Reflector(), svcB);
    const email = `${prefix}@example.com`;
    // Unique per run: the per-IP key is hashed (it does not carry the test prefix), so a fixed
    // address would stay limited for the window when the suite is re-run within a minute.
    const ip = `2001:db8::${prefix.slice(-4)}`;
    expect(await guardA.canActivate(guardContext(ip, email))).toBe(true);
    expect(await guardB.canActivate(guardContext(ip, email))).toBe(true);
    const headers: Record<string, string> = {};
    const err = await guardA.canActivate(guardContext(ip, email, headers)).catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(429);
    expect(Number(headers['Retry-After'])).toBeGreaterThan(0);
    expect(svcA.status().active).toBe('redis');
  });

  it('token bucket is shared and uses the Redis clock', async () => {
    const a = new RedisRateLimitStore(clientA as unknown as RedisLike);
    const b = new RedisRateLimitStore(clientB as unknown as RedisLike);
    const key = `${prefix}:bucket`;
    expect((await a.takeToken(key, 2, 0.01, 60_000)).allowed).toBe(true);
    expect((await b.takeToken(key, 2, 0.01, 60_000)).allowed).toBe(true);
    const denied = await a.takeToken(key, 2, 0.01, 60_000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(1000);
  });

  it('increment / peek / reset', async () => {
    const a = new RedisRateLimitStore(clientA as unknown as RedisLike);
    const key = `${prefix}:mfa`;
    await a.increment(key, 60_000);
    expect((await a.increment(key, 60_000)).count).toBe(2);
    expect((await a.peek(key)).count).toBe(2);
    await a.reset(key);
    expect((await a.peek(key)).count).toBe(0);
  });
});
