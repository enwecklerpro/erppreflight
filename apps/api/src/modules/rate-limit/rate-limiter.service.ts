import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { resolveRedisConnectionOptions } from '../jobs/redis-connection.factory';
import {
  CounterState,
  MemoryRateLimitStore,
  RateLimitStore,
  RedisLike,
  RedisRateLimitStore,
  TokenDecision,
  WindowCheck,
} from './rate-limit.store';

/**
 * What happens when Redis is configured but a rate-limit command fails
 * (Redis down, network partition, timeout):
 *  - 'memory' (default): the SAME limits are enforced per API process with a bounded
 *    in-memory store until Redis answers again. Never fail-open: brute force stays
 *    limited (per instance), and sign-in keeps working during a Redis outage.
 *  - 'closed': the request is refused (HTTP 503) while the shared limiter is unavailable.
 */
export type RateLimitFailureMode = 'memory' | 'closed';

export interface RateLimitBudget {
  /** Short scope label, e.g. 'ip' or 'ipmail'. */
  scope: string;
  /** Raw identifier (IP, e-mail, user id). Hashed before it is used as a Redis key. */
  id: string;
  limit: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Scope of the exhausted budget (null when allowed). */
  blockedScope: string | null;
  retryAfterMs: number;
  /** Backend that took the decision. */
  backend: 'redis' | 'memory' | 'unavailable';
}

export interface RateLimiterStatus {
  configured: 'redis' | 'memory';
  active: 'redis' | 'memory';
  failureMode: RateLimitFailureMode;
  keyPrefix: string;
  lastError: string | null;
}

/** Raised in 'closed' failure mode when the shared limiter cannot be reached. */
export class RateLimiterUnavailableError extends Error {
  constructor(cause: string) {
    super(`Rate limiter unavailable: ${cause}`);
    this.name = 'RateLimiterUnavailableError';
  }
}

export function resolveFailureMode(value: string | undefined): RateLimitFailureMode {
  return String(value ?? '').trim().toLowerCase() === 'closed' ? 'closed' : 'memory';
}

/** Identifiers are hashed so Redis never holds e-mail addresses or IPs in clear text. */
export function hashIdentifier(id: string): string {
  return createHash('sha256').update(String(id)).digest('hex').slice(0, 32);
}

const NAMESPACE_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/**
 * Distributed rate limiter shared by every API instance (spec 10.x, AGENTS.md §4.4 S3).
 *
 * Keys: `<prefix>rl:<namespace>:<scope>:<sha256(id)[0..32]>` in the Redis DB selected by
 * REDIS_URL. All operations are single atomic Lua scripts (fixed window: check-all then
 * INCR+PEXPIRE; token bucket on the Redis server clock). See RateLimitFailureMode for
 * the documented behaviour when Redis is unavailable.
 */
@Injectable()
export class RateLimiterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly memory: MemoryRateLimitStore;
  private redisStore: RateLimitStore | null = null;
  private ownedClient: Redis | null = null;
  private failureMode: RateLimitFailureMode;
  private readonly keyPrefix: string;
  private backendSetting: 'redis' | 'memory';
  private lastError: string | null = null;
  private lastErrorLoggedAt = 0;
  private degraded = false;

  constructor(@Optional() private readonly config?: ConfigService) {
    const get = (k: string) => this.config?.get<string>(k) ?? process.env[k];
    this.failureMode = resolveFailureMode(get('RATE_LIMIT_REDIS_FAILURE_MODE'));
    this.keyPrefix = (get('RATE_LIMIT_KEY_PREFIX') || 'erppreflight:').slice(0, 64);
    this.backendSetting = String(get('RATE_LIMIT_BACKEND') || 'redis').toLowerCase() === 'memory' ? 'memory' : 'redis';
    this.memory = new MemoryRateLimitStore();
  }

  /** Per-process limiter without Redis (unit tests, tooling). */
  static inMemory(): RateLimiterService {
    const svc = new RateLimiterService();
    svc.backendSetting = 'memory';
    return svc;
  }

  /** Limiter over an existing Redis-like client (tests, custom wiring). */
  static withRedis(client: RedisLike, failureMode: RateLimitFailureMode = 'memory'): RateLimiterService {
    const svc = new RateLimiterService();
    svc.failureMode = failureMode;
    svc.redisStore = new RedisRateLimitStore(client);
    return svc;
  }

  onModuleInit(): void {
    if (this.backendSetting === 'memory' || this.redisStore || !this.config) {
      if (this.backendSetting === 'memory') {
        this.logger.warn('RATE_LIMIT_BACKEND=memory: rate limits are enforced per API process only.');
      }
      return;
    }
    const client = new Redis({
      ...resolveRedisConnectionOptions(this.config),
      // Fail fast instead of queueing: a limiter decision must not wait for a reconnect.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: Number(this.config.get('RATE_LIMIT_REDIS_TIMEOUT_MS') ?? 500) || 500,
      connectionName: 'erppreflight-rate-limit',
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });
    client.on('error', (err) => this.noteFailure(err));
    client.on('ready', () => {
      if (this.degraded) this.logger.log('Redis rate limiter reachable again; shared limits active.');
      this.degraded = false;
    });
    this.ownedClient = client;
    this.redisStore = new RedisRateLimitStore(client as unknown as RedisLike);
    this.logger.log(`Rate limiter: Redis (shared across API instances), failure mode '${this.failureMode}'.`);
  }

  async onModuleDestroy(): Promise<void> {
    const client = this.ownedClient;
    this.ownedClient = null;
    if (client) await client.quit().catch(() => client.disconnect());
  }

  status(): RateLimiterStatus {
    const configured = this.redisStore ? 'redis' : 'memory';
    return {
      configured,
      active: configured === 'redis' && !this.degraded ? 'redis' : 'memory',
      failureMode: this.failureMode,
      keyPrefix: this.keyPrefix,
      lastError: this.lastError,
    };
  }

  key(namespace: string, scope: string, id: string): string {
    if (!NAMESPACE_RE.test(namespace) || !NAMESPACE_RE.test(scope)) {
      throw new Error(`Invalid rate-limit namespace/scope '${namespace}:${scope}'`);
    }
    return `${this.keyPrefix}rl:${namespace}:${scope}:${hashIdentifier(id)}`;
  }

  /**
   * Fixed-window check of several budgets at once (e.g. per IP and per IP+e-mail).
   * Nothing is counted when any budget is exhausted.
   */
  async consume(namespace: string, budgets: RateLimitBudget[], windowMs: number): Promise<RateLimitDecision> {
    const checks: WindowCheck[] = budgets.map((b) => ({ key: this.key(namespace, b.scope, b.id), limit: b.limit }));
    return this.run<RateLimitDecision>(
      async (store) => {
        const d = await store.consume(checks, windowMs);
        return {
          allowed: d.allowed,
          blockedScope: d.allowed ? null : budgets[d.blockedIndex]?.scope ?? null,
          retryAfterMs: d.retryAfterMs,
          backend: store.kind,
        };
      },
      () => ({ allowed: false, blockedScope: null, retryAfterMs: 5000, backend: 'unavailable' })
    );
  }

  /** Counts one event (e.g. a failed second factor) within the window. */
  async increment(namespace: string, scope: string, id: string, windowMs: number): Promise<CounterState> {
    const key = this.key(namespace, scope, id);
    return this.run(
      (store) => store.increment(key, windowMs),
      () => {
        throw new RateLimiterUnavailableError(this.lastError ?? 'redis');
      }
    );
  }

  async peek(namespace: string, scope: string, id: string): Promise<CounterState> {
    const key = this.key(namespace, scope, id);
    return this.run(
      (store) => store.peek(key),
      () => {
        throw new RateLimiterUnavailableError(this.lastError ?? 'redis');
      }
    );
  }

  async reset(namespace: string, scope: string, id: string): Promise<void> {
    const key = this.key(namespace, scope, id);
    // Reset both stores: a fallback counter must not outlive a successful login either.
    await this.memory.reset(key);
    if (this.redisStore) {
      try {
        await this.redisStore.reset(key);
      } catch (err) {
        this.noteFailure(err);
      }
    }
  }

  /** Token bucket (capacity, refill/s) shared across instances, e.g. outbound connector calls. */
  async takeToken(
    namespace: string,
    id: string,
    capacity: number,
    refillPerSecond: number,
    idleTtlMs = 10 * 60_000
  ): Promise<TokenDecision> {
    const key = this.key(namespace, 'bucket', id);
    return this.run(
      (store) => store.takeToken(key, capacity, refillPerSecond, idleTtlMs),
      () => ({ allowed: false, retryAfterMs: 5000 })
    );
  }

  private async run<T>(op: (store: RateLimitStore) => Promise<T>, closed: () => T): Promise<T> {
    if (this.redisStore) {
      try {
        const result = await op(this.redisStore);
        this.degraded = false;
        return result;
      } catch (err) {
        this.noteFailure(err);
        if (this.failureMode === 'closed') return closed();
      }
    }
    return op(this.memory);
  }

  private noteFailure(err: unknown): void {
    this.degraded = true;
    this.lastError = String((err as Error)?.message ?? err).slice(0, 200);
    const now = Date.now();
    if (now - this.lastErrorLoggedAt > 60_000) {
      this.lastErrorLoggedAt = now;
      this.logger.warn(
        `Redis rate limiter unavailable (${this.lastError}); ` +
          (this.failureMode === 'closed'
            ? 'refusing rate-limited requests (RATE_LIMIT_REDIS_FAILURE_MODE=closed).'
            : 'enforcing the same limits per API process (in-memory fallback).')
      );
    }
  }
}
