import { Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { MailDeliveryResult, MailMessage, MailTransport, assertSafeAddress } from './mail.types';

/**
 * Development transport: persists every message to the `mail_outbox` table instead
 * of delivering it. The messages are readable through the dev mailbox endpoint
 * (see DevMailboxController), which is how the live E2E suites follow e-mail links.
 * Message bodies are never logged (they contain single-use tokens).
 */
export class DevMailTransport implements MailTransport {
  readonly kind = 'dev' as const;
  private readonly logger = new Logger('DevMailTransport');

  constructor(private readonly db: DatabaseService) {}

  async send(message: MailMessage): Promise<MailDeliveryResult> {
    const to = assertSafeAddress(message.to);
    const res = await this.db.query(
      `INSERT INTO mail_outbox (to_address, from_address, subject, template, text_body, html_body)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [to, message.from, message.subject, message.template, message.text, message.html],
      { bypassRls: true }
    );
    const id = String(res.rows[0]?.id ?? '');
    this.logger.log(`Captured ${message.template} e-mail for ${to} in mail_outbox (${id})`);
    return { transport: 'dev', messageId: id };
  }
}
