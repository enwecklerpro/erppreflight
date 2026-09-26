import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * In-app + webhook + (optional) e-mail notifications. OutboxModule is global;
 * e-mail goes through the platform MailService (a MAIL_SENDER provider overrides it).
 */
@Module({
  imports: [DatabaseModule, MailModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
