import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MailModule } from '../mail/mail.module';
import { SupportService } from './support.service';
import { SupportMailService } from './support-mail.service';
import { SupportThreadService } from './support-thread.service';
import { SupportAdminController, SupportController } from './support.controller';

@Module({
  imports: [DatabaseModule, MailModule],
  controllers: [SupportController, SupportAdminController],
  providers: [SupportService, SupportMailService, SupportThreadService],
  exports: [SupportService, SupportThreadService],
})
export class SupportModule {}
