import { Global, Module } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController } from './api-keys.controller';
import { DatabaseModule } from '../database/database.module';

/**
 * Global so that every JwtAuthGuard instance (guards are instantiated in the
 * module that uses them) can resolve ApiKeysService: without it the optional
 * injection is undefined and `x-api-key` requests are rejected on every route
 * outside AuthModule — which broke the CLI and the API-key REST access.
 */
@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
