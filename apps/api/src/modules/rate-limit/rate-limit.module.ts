import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RateLimiterService } from './rate-limiter.service';

/**
 * Global so every module with a public or brute-forceable endpoint (auth, 2FA,
 * invitations, SSO, public tools, knowledge-graph lookup, connectors) shares one
 * Redis-backed limiter without importing this module explicitly.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [RateLimiterService],
  exports: [RateLimiterService],
})
export class RateLimitModule {}
