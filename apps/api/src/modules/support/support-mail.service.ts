import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import {
  MailLocale,
  TicketMailContext,
  normalizeMailLocale,
  renderTicketCreated,
  renderTicketReply,
  renderTicketStatusChanged,
} from '../mail/operations.templates';
import type { RenderedMail } from '../mail/mail.templates';

export interface TicketMailFacts {
  id: string;
  subject: string;
  description: string;
  category: string;
  locale: string;
  organizationName: string;
  requesterEmail: string | null;
}

/**
 * Support ticket e-mails (spec 10.14 / C §62): the requester (in the ticket's language)
 * and the operator inbox SUPPORT_INBOX_EMAIL (in SUPPORT_INBOX_LOCALE, default en) are
 * informed when a ticket is created, replied to or changes status. Nobody is e-mailed
 * about their own message. Delivery is asynchronous and never fails the request.
 */
@Injectable()
export class SupportMailService {
  private readonly logger = new Logger(SupportMailService.name);

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly mail?: MailService
  ) {}

  inboxAddress(): string | null {
    const v = String(this.config.get<string>('SUPPORT_INBOX_EMAIL') ?? process.env.SUPPORT_INBOX_EMAIL ?? '').trim();
    return v || null;
  }

  inboxLocale(): MailLocale {
    return normalizeMailLocale(this.config.get<string>('SUPPORT_INBOX_LOCALE') ?? process.env.SUPPORT_INBOX_LOCALE ?? 'en');
  }

  private context(t: TicketMailFacts, audience: 'requester' | 'inbox'): TicketMailContext {
    const url =
      audience === 'requester'
        ? this.mail!.link('/settings/support', { ticket: t.id })
        : this.mail!.link('/admin', { tab: 'support', ticket: t.id });
    return {
      locale: audience === 'requester' ? normalizeMailLocale(t.locale) : this.inboxLocale(),
      audience,
      ticketId: t.id,
      subject: t.subject,
      category: t.category,
      organizationName: t.organizationName,
      requesterEmail: t.requesterEmail,
      url,
    };
  }

  private deliver(to: string | null, mail: () => RenderedMail, skip?: string | null): boolean {
    if (!this.mail || !to) return false;
    if (skip && to.trim().toLowerCase() === skip.trim().toLowerCase()) return false;
    try {
      this.mail.sendInBackground(to, mail());
      return true;
    } catch (err: any) {
      this.logger.error(`Support e-mail could not be queued: ${err?.message ?? err}`);
      return false;
    }
  }

  ticketCreated(t: TicketMailFacts): { requester: boolean; inbox: boolean } {
    if (!this.mail) return { requester: false, inbox: false };
    return {
      requester: this.deliver(t.requesterEmail, () => renderTicketCreated(this.context(t, 'requester'), t.description)),
      inbox: this.deliver(this.inboxAddress(), () => renderTicketCreated(this.context(t, 'inbox'), t.description)),
    };
  }

  ticketReplied(
    t: TicketMailFacts,
    reply: { authorRole: 'CUSTOMER' | 'SUPPORT'; authorEmail: string | null; body: string }
  ): { requester: boolean; inbox: boolean } {
    if (!this.mail) return { requester: false, inbox: false };
    return {
      requester: this.deliver(t.requesterEmail, () => renderTicketReply(this.context(t, 'requester'), reply), reply.authorEmail),
      inbox: this.deliver(this.inboxAddress(), () => renderTicketReply(this.context(t, 'inbox'), reply), reply.authorEmail),
    };
  }

  statusChanged(t: TicketMailFacts, change: { from: string; to: string }, actorEmail: string | null): { requester: boolean; inbox: boolean } {
    if (!this.mail) return { requester: false, inbox: false };
    return {
      requester: this.deliver(t.requesterEmail, () => renderTicketStatusChanged(this.context(t, 'requester'), change), actorEmail),
      inbox: this.deliver(this.inboxAddress(), () => renderTicketStatusChanged(this.context(t, 'inbox'), change), actorEmail),
    };
  }
}
