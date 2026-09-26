import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { timingSafeEqual, createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { MAIL_CONFIG } from './mail.tokens';
import type { ResolvedMailConfig } from './mail.config';

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Development mailbox: exposes messages captured by the dev mail transport so local
 * and E2E test suites can follow verification / reset / invitation links.
 *
 * - Returns 404 unless MAIL_TRANSPORT=dev (it does not exist for smtp/http delivery).
 * - In production (staging/E2E stacks only) it additionally requires the
 *   X-Dev-Mailbox-Token header to match MAIL_DEV_OUTBOX_TOKEN.
 * - Messages are filtered by exact recipient; there is no "list everything" mode.
 */
@Controller('dev/mail')
export class DevMailboxController {
  constructor(
    private readonly db: DatabaseService,
    @Inject(MAIL_CONFIG) private readonly config: ResolvedMailConfig
  ) {}

  @Get('messages')
  async list(
    @Query('to') to: string | undefined,
    @Query('limit') limitRaw: string | undefined,
    @Headers('x-dev-mailbox-token') token: string | undefined
  ) {
    if (this.config.transport !== 'dev' || !this.config.devOutboxEnabled) {
      throw new NotFoundException();
    }
    if (this.config.devOutboxToken && !safeEqual(String(token || ''), this.config.devOutboxToken)) {
      throw new ForbiddenException('Invalid dev mailbox token');
    }
    const recipient = String(to || '').trim().toLowerCase();
    if (!EMAIL_RE.test(recipient) || recipient.length > 320) {
      throw new BadRequestException('Query parameter "to" must be an e-mail address');
    }
    const limit = Math.min(Math.max(Number(limitRaw) || 10, 1), 50);
    const res = await this.db.query(
      `SELECT id, to_address, from_address, subject, template, text_body, html_body, created_at
       FROM mail_outbox
       WHERE lower(to_address) = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [recipient, limit],
      { bypassRls: true }
    );
    return {
      items: res.rows.map((row: any) => ({
        id: row.id,
        to: row.to_address,
        from: row.from_address,
        subject: row.subject,
        template: row.template,
        text: row.text_body,
        html: row.html_body,
        links: Array.from(new Set<string>(String(row.text_body).match(/https?:\/\/[^\s]+/g) || [])),
        createdAt: row.created_at,
      })),
    };
  }
}
