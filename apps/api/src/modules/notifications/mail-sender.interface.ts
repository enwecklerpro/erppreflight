/**
 * E-mail channel contract for the notification engine (Part 05 §5.10).
 *
 * The notifications module never talks to SMTP/providers directly. A mail
 * module (owned by another workstream) registers a provider under the
 * MAIL_SENDER token anywhere in the Nest application, e.g.
 *
 *   { provide: MAIL_SENDER, useExisting: SmtpMailService }
 *
 * The notification engine resolves it lazily (ModuleRef, non-strict). When no
 * provider is registered the e-mail channel is a documented no-op: in-app and
 * webhook notifications still work and `GET /notifications/channels` reports
 * `email: false`.
 */
export const MAIL_SENDER = 'ERPPREFLIGHT_MAIL_SENDER';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Opaque tags for provider-side analytics / suppression (e.g. event type). */
  tags?: Record<string, string>;
}

export interface MailSender {
  send(message: MailMessage): Promise<void>;
}
