import { Global, Module } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController } from './api-keys.controller';
import { DatabaseModule } from '../database/database.module';

/**
 * Global so that JwtAuthGuard — instantiated in every feature module that uses
 * it — can always resolve ApiKeysService. Without this, API-key authentication
 * (developer API / CLI, C §47) was rejected on every route outside AuthModule
 * with "API key authentication is not available on this route".
 */
@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
