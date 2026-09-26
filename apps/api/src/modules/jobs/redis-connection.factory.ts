import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

const logger = new Logger('RedisConnectionFactory');

/**
 * Single source of truth for Redis connection settings (BullMQ + ad-hoc clients).
 * REDIS_URL (redis:// or rediss://, incl. credentials and /<db>) wins over
 * REDIS_HOST/REDIS_PORT/REDIS_PASSWORD so the logical DB index is honoured.
 */
export function resolveRedisConnectionOptions(config: ConfigService): RedisOptions {
  const url = config.get<string>('REDIS_URL');
  if (url) {
    const parsed = new URL(url);
    const db = parsed.pathname && parsed.pathname !== '/' ? Number(parsed.pathname.slice(1)) : 0;
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 6379,
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password
        ? decodeURIComponent(parsed.password)
        : config.get<string>('REDIS_PASSWORD') || undefined,
      db: Number.isInteger(db) && db >= 0 ? db : 0,
      tls: parsed.protocol === 'rediss:' ? {} : undefined,
      maxRetriesPerRequest: null,
    };
  }
  return {
    host: config.get<string>('REDIS_HOST', 'localhost'),
    port: Number(config.get<number>('REDIS_PORT', 6379)),
    password: config.get<string>('REDIS_PASSWORD') || undefined,
    maxRetriesPerRequest: null,
  };
}

export function createRedisConnection(config: ConfigService): Redis {
  const redisOptions: RedisOptions = {
    ...resolveRedisConnectionOptions(config),
    enableReadyCheck: false,
    retryStrategy(times) {
      if (times > 3) {
        logger.warn(`Redis connection retry #${times} failed, backing off...`);
        return null; // Stop retrying if not available (e.g. during test)
      }
      return Math.min(times * 100, 1000);
    },
  };

  const client = new Redis(redisOptions);

  client.on('error', (err) => {
    logger.warn(`Redis client error: ${err.message}`);
  });

  return client;
}
