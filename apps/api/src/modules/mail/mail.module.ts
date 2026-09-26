import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { MAIL_TRANSPORT, MailTransport } from './mail.types';
import { MAIL_CONFIG } from './mail.tokens';
import { ResolvedMailConfig, resolveMailConfig } from './mail.config';
import { SmtpMailTransport } from './smtp.transport';
import { HttpMailTransport } from './http.transport';
import { DevMailTransport } from './dev.transport';
import { MailService } from './mail.service';
import { DevMailboxController } from './dev-mailbox.controller';

export const MAIL_ENV_KEYS = [
  'NODE_ENV',
  'MAIL_TRANSPORT',
  'MAIL_FROM',
  'APP_PUBLIC_URL',
  'CORS_ORIGIN',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_TLS_REJECT_UNAUTHORIZED',
  'SMTP_TIMEOUT_MS',
  'SMTP_EHLO_NAME',
  'MAIL_HTTP_PROVIDER',
  'MAIL_HTTP_URL',
  'MAIL_HTTP_API_KEY',
  'MAIL_HTTP_TIMEOUT_MS',
  'MAIL_DEV_OUTBOX_TOKEN',
] as const;

export function mailEnvFromConfig(config: ConfigService): Record<string, unknown> {
  const env: Record<string, unknown> = {};
  for (const key of MAIL_ENV_KEYS) {
    env[key] = config.get(key) ?? process.env[key];
  }
  return env;
}

@Module({
  imports: [ConfigModule],
  controllers: [DevMailboxController],
  providers: [
    {
      provide: MAIL_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ResolvedMailConfig => {
        const { config: resolved, errors } = resolveMailConfig(mailEnvFromConfig(config));
        if (errors.length > 0) {
          // env.validation.ts reports the same errors at boot; this is a safety net.
          throw new Error(`Mail configuration invalid: ${errors.join('; ')}`);
        }
        return resolved;
      },
    },
    {
      provide: MAIL_TRANSPORT,
      inject: [MAIL_CONFIG, DatabaseService],
      useFactory: (config: ResolvedMailConfig, db: DatabaseService): MailTransport => {
        const logger = new Logger('MailModule');
        if (config.transport === 'smtp' && config.smtp) {
          logger.log(`Mail transport: SMTP ${config.smtp.host}:${config.smtp.port} (${config.smtp.security})`);
          return new SmtpMailTransport(config.smtp);
        }
        if (config.transport === 'http' && config.http) {
          logger.log(`Mail transport: HTTP provider ${config.http.provider}`);
          return new HttpMailTransport(config.http);
        }
        logger.warn(
          'Mail transport: dev outbox (messages are stored in mail_outbox and NOT delivered). ' +
            'Set MAIL_TRANSPORT=smtp or http for real delivery.'
        );
        return new DevMailTransport(db);
      },
    },
    MailService,
  ],
  exports: [MailService, MAIL_CONFIG],
})
export class MailModule {}
