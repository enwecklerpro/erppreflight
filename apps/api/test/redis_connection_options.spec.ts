import { describe, it, expect } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { resolveRedisConnectionOptions } from '../src/modules/jobs/redis-connection.factory';

// Regression: BullMQ used only REDIS_HOST/PORT, so REDIS_URL's logical DB index was ignored
// and separate deployments sharing one Redis consumed each other's analysis jobs.
describe('resolveRedisConnectionOptions', () => {
  it('honours host, port, credentials and db index from REDIS_URL', () => {
    const opts = resolveRedisConnectionOptions(
      new ConfigService({ REDIS_URL: 'redis://user:p%40ss@cache.internal:6390/5', REDIS_HOST: 'ignored' }),
    );
    expect(opts).toMatchObject({ host: 'cache.internal', port: 6390, username: 'user', password: 'p@ss', db: 5 });
    expect(opts.tls).toBeUndefined();
  });

  it('enables TLS for rediss:// and defaults db to 0', () => {
    const opts = resolveRedisConnectionOptions(new ConfigService({ REDIS_URL: 'rediss://cache.example.com' }));
    expect(opts).toMatchObject({ host: 'cache.example.com', port: 6379, db: 0 });
    expect(opts.tls).toEqual({});
  });

  it('falls back to REDIS_HOST/REDIS_PORT/REDIS_PASSWORD without REDIS_URL', () => {
    const opts = resolveRedisConnectionOptions(
      new ConfigService({ REDIS_HOST: 'redis', REDIS_PORT: '6379', REDIS_PASSWORD: 'secret' }),
    );
    expect(opts).toMatchObject({ host: 'redis', port: 6379, password: 'secret' });
  });
});
