/**
 * Storage backends for RateLimiterService.
 *
 * - RedisRateLimitStore: shared by every API process that points at the same Redis
 *   (REDIS_URL incl. /<db>). Every operation is ONE Lua script, so check + increment
 *   + expiry are atomic across processes (no read-modify-write race).
 * - MemoryRateLimitStore: bounded per-process fallback with identical semantics
 *   (used when Redis is not configured or a Redis command fails).
 */

export interface WindowCheck {
  /** Fully namespaced key. */
  key: string;
  /** Maximum hits allowed within the window. */
  limit: number;
}

export interface WindowDecision {
  allowed: boolean;
  /** Index into the checks array of the first exhausted budget (-1 when allowed). */
  blockedIndex: number;
  /** Milliseconds until the exhausted budget resets (0 when allowed). */
  retryAfterMs: number;
}

export interface CounterState {
  count: number;
  /** Remaining window in ms (0 when the key does not exist). */
  ttlMs: number;
}

export interface TokenDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export interface RateLimitStore {
  readonly kind: 'redis' | 'memory';
  /**
   * Fixed window: if ANY check is already at its limit nothing is incremented and the
   * request is rejected; otherwise every key is incremented (window starts on first hit).
   */
  consume(checks: WindowCheck[], windowMs: number): Promise<WindowDecision>;
  /** Increments one counter without a limit (e.g. failed 2FA codes) and returns it. */
  increment(key: string, windowMs: number): Promise<CounterState>;
  /** Reads a counter without changing it. */
  peek(key: string): Promise<CounterState>;
  reset(key: string): Promise<void>;
  /** Token bucket (capacity, refill per second); state expires after `idleTtlMs`. */
  takeToken(key: string, capacity: number, refillPerSecond: number, idleTtlMs: number): Promise<TokenDecision>;
}

// ---------------------------------------------------------------------------
// Redis (atomic Lua scripts)
// ---------------------------------------------------------------------------

/** KEYS = counters; ARGV[1] = windowMs, ARGV[1+i] = limit of KEYS[i]. Returns {allowed, blockedIndex(1-based), retryAfterMs}. */
export const CONSUME_LUA = `
local window = tonumber(ARGV[1])
for i, key in ipairs(KEYS) do
  local limit = tonumber(ARGV[i + 1])
  local current = tonumber(redis.call('GET', key) or '0')
  if current >= limit then
    local ttl = redis.call('PTTL', key)
    if ttl < 0 then
      redis.call('PEXPIRE', key, window)
      ttl = window
    end
    return {0, i, ttl}
  end
end
for _, key in ipairs(KEYS) do
  local c = redis.call('INCR', key)
  if c == 1 or redis.call('PTTL', key) < 0 then
    redis.call('PEXPIRE', key, window)
  end
end
return {1, 0, 0}
`;

/** KEYS[1] = counter; ARGV[1] = windowMs. Returns {count, ttlMs}. */
export const INCREMENT_LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 or redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return {c, redis.call('PTTL', KEYS[1])}
`;

/**
 * KEYS[1] = bucket hash; ARGV = capacity, refillPerSecond, idleTtlMs.
 * Uses the Redis server clock (TIME) so API processes with skewed clocks agree.
 * Returns {allowed, retryAfterMs}.
 */
export const TOKEN_BUCKET_LUA = `
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local state = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])
if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end
local elapsed = math.max(0, now - ts) / 1000
tokens = math.min(capacity, tokens + elapsed * rate)
local allowed = 0
local wait = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  wait = math.ceil(((1 - tokens) / rate) * 1000)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('PEXPIRE', KEYS[1], ttl)
return {allowed, wait}
`;

/** Minimal subset of the ioredis client used here (lets tests inject a fake). */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  get(key: string): Promise<string | null>;
  pttl(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
}

export class RedisRateLimitStore implements RateLimitStore {
  readonly kind = 'redis' as const;

  constructor(private readonly redis: RedisLike) {}

  async consume(checks: WindowCheck[], windowMs: number): Promise<WindowDecision> {
    if (checks.length === 0) return { allowed: true, blockedIndex: -1, retryAfterMs: 0 };
    const res = (await this.redis.eval(
      CONSUME_LUA,
      checks.length,
      ...checks.map((c) => c.key),
      Math.max(1, Math.ceil(windowMs)),
      ...checks.map((c) => Math.max(0, Math.floor(c.limit)))
    )) as [number, number, number];
    const allowed = Number(res[0]) === 1;
    return {
      allowed,
      blockedIndex: allowed ? -1 : Number(res[1]) - 1,
      retryAfterMs: allowed ? 0 : Math.max(1, Number(res[2])),
    };
  }

  async increment(key: string, windowMs: number): Promise<CounterState> {
    const res = (await this.redis.eval(INCREMENT_LUA, 1, key, Math.max(1, Math.ceil(windowMs)))) as [number, number];
    return { count: Number(res[0]), ttlMs: Math.max(0, Number(res[1])) };
  }

  async peek(key: string): Promise<CounterState> {
    const [raw, ttl] = await Promise.all([this.redis.get(key), this.redis.pttl(key)]);
    return { count: raw === null ? 0 : Number(raw) || 0, ttlMs: Math.max(0, Number(ttl)) };
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async takeToken(key: string, capacity: number, refillPerSecond: number, idleTtlMs: number): Promise<TokenDecision> {
    const res = (await this.redis.eval(
      TOKEN_BUCKET_LUA,
      1,
      key,
      capacity,
      refillPerSecond,
      Math.max(1000, Math.ceil(idleTtlMs))
    )) as [number, number];
    return { allowed: Number(res[0]) === 1, retryAfterMs: Math.max(0, Number(res[1])) };
  }
}

// ---------------------------------------------------------------------------
// In-memory (bounded, per process)
// ---------------------------------------------------------------------------

export const MEMORY_STORE_MAX_KEYS = 50_000;

interface MemoryCounter {
  count: number;
  resetAt: number;
}

interface MemoryBucket {
  tokens: number;
  updatedAt: number;
  expiresAt: number;
}

export class MemoryRateLimitStore implements RateLimitStore {
  readonly kind = 'memory' as const;
  private readonly counters = new Map<string, MemoryCounter>();
  private readonly buckets = new Map<string, MemoryBucket>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys: number = MEMORY_STORE_MAX_KEYS
  ) {}

  get size(): number {
    return this.counters.size + this.buckets.size;
  }

  private live(key: string, now: number): MemoryCounter | undefined {
    const c = this.counters.get(key);
    if (c && c.resetAt <= now) {
      this.counters.delete(key);
      return undefined;
    }
    return c;
  }

  async consume(checks: WindowCheck[], windowMs: number): Promise<WindowDecision> {
    const now = this.now();
    this.sweep(now);
    for (let i = 0; i < checks.length; i++) {
      const c = this.live(checks[i].key, now);
      if (c && c.count >= checks[i].limit) {
        return { allowed: false, blockedIndex: i, retryAfterMs: Math.max(1, c.resetAt - now) };
      }
    }
    for (const check of checks) {
      const c = this.live(check.key, now);
      if (c) c.count += 1;
      else this.counters.set(check.key, { count: 1, resetAt: now + windowMs });
    }
    return { allowed: true, blockedIndex: -1, retryAfterMs: 0 };
  }

  async increment(key: string, windowMs: number): Promise<CounterState> {
    const now = this.now();
    this.sweep(now);
    const c = this.live(key, now);
    if (c) {
      c.count += 1;
      return { count: c.count, ttlMs: c.resetAt - now };
    }
    this.counters.set(key, { count: 1, resetAt: now + windowMs });
    return { count: 1, ttlMs: windowMs };
  }

  async peek(key: string): Promise<CounterState> {
    const now = this.now();
    const c = this.live(key, now);
    return c ? { count: c.count, ttlMs: c.resetAt - now } : { count: 0, ttlMs: 0 };
  }

  async reset(key: string): Promise<void> {
    this.counters.delete(key);
    this.buckets.delete(key);
  }

  async takeToken(key: string, capacity: number, refillPerSecond: number, idleTtlMs: number): Promise<TokenDecision> {
    const now = this.now();
    this.sweep(now);
    const existing = this.buckets.get(key);
    const b: MemoryBucket =
      existing && existing.expiresAt > now ? existing : { tokens: capacity, updatedAt: now, expiresAt: now + idleTtlMs };
    const elapsed = Math.max(0, now - b.updatedAt) / 1000;
    b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSecond);
    b.updatedAt = now;
    b.expiresAt = now + idleTtlMs;
    this.buckets.set(key, b);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { allowed: true, retryAfterMs: 0 };
    }
    return { allowed: false, retryAfterMs: Math.ceil(((1 - b.tokens) / refillPerSecond) * 1000) };
  }

  /** Keeps memory bounded under a sustained attack from many sources. */
  private sweep(now: number): void {
    if (this.size < this.maxKeys) return;
    for (const [key, c] of this.counters) if (c.resetAt <= now) this.counters.delete(key);
    for (const [key, b] of this.buckets) if (b.expiresAt <= now) this.buckets.delete(key);
    if (this.size >= this.maxKeys) {
      // Still full: drop the oldest entries (Map preserves insertion order).
      let excess = this.size - Math.floor(this.maxKeys * 0.9);
      for (const key of this.counters.keys()) {
        if (excess-- <= 0) break;
        this.counters.delete(key);
      }
      for (const key of this.buckets.keys()) {
        if (excess-- <= 0) break;
        this.buckets.delete(key);
      }
    }
  }
}
