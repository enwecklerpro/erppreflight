import { Inject, Injectable, Logger } from '@nestjs/common';
import { MAIL_TRANSPORT, MailDeliveryResult, MailTransport } from './mail.types';
import { RenderedMail } from './mail.templates';
import { MAIL_CONFIG } from './mail.tokens';
import type { ResolvedMailConfig } from './mail.config';

/**
 * Sends rendered templates through the configured transport and builds
 * absolute links to the public web application.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    @Inject(MAIL_CONFIG) private readonly config: ResolvedMailConfig
  ) {}

  get transportKind() {
    return this.transport.kind;
  }

  /** Absolute URL on the public web app, e.g. link('/reset-password', { token }). */
  link(path: string, params: Record<string, string> = {}): string {
    const url = new URL(this.config.appPublicUrl + (path.startsWith('/') ? path : `/${path}`));
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  }

  async send(to: string, mail: RenderedMail): Promise<MailDeliveryResult> {
    return this.transport.send({
      to,
      from: this.config.from,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      template: mail.template,
    });
  }

  /**
   * Fire-and-forget delivery for flows whose HTTP response must not depend on
   * delivery timing (e.g. forgot-password, to avoid account enumeration by latency).
   * Failures are logged without the message body.
   */
  sendInBackground(to: string, mail: RenderedMail): void {
    this.send(to, mail).catch((err: Error) => {
      this.logger.error(`Failed to deliver ${mail.template} e-mail via ${this.transport.kind}: ${err.message}`);
    });
  }
}
