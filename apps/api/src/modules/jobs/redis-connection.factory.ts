import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

const logger = new Logger('RedisConnectionFactory');

export function createRedisConnection(config: ConfigService): Redis {
  const host = config.get<string>('REDIS_HOST', 'localhost');
  const port = config.get<number>('REDIS_PORT', 6380);
  const password = config.get<string>('REDIS_PASSWORD', '');

  const redisOptions: RedisOptions = {
    host,
    port,
    password: password || undefined,
    maxRetriesPerRequest: null,
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
