import { Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { DatabaseModule } from '../database/database.module';
import { CredentialVault } from '../connectors/credential-vault';

@Module({
  imports: [DatabaseModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, CredentialVault],
  exports: [WebhooksService],
})
export class WebhooksModule {}
