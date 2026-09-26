/**
 * E-mail abstraction (spec 00 §0.3: every credentials-dependent integration has an
 * interface, a real production adapter and a local development adapter).
 */

export type MailTransportKind = 'smtp' | 'http' | 'dev';

export type MailTemplateId =
  | 'EMAIL_VERIFICATION'
  | 'PASSWORD_RESET'
  | 'MAGIC_LINK'
  | 'PASSWORD_CHANGED'
  | 'ORGANIZATION_INVITATION'
  | 'TWO_FACTOR_ENABLED'
  | 'TWO_FACTOR_DISABLED'
  | 'ACCOUNT_DELETED';

export interface MailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  /** Template identifier, recorded by the development outbox. */
  template: MailTemplateId;
}

export interface MailDeliveryResult {
  transport: MailTransportKind;
  /** Provider / server message id when available. */
  messageId: string;
}

export interface MailTransport {
  readonly kind: MailTransportKind;
  send(message: MailMessage): Promise<MailDeliveryResult>;
}

/** Nest injection token for the active MailTransport. */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/** Rejects header-injection attempts and obviously invalid addresses. */
export function assertSafeAddress(address: string): string {
  const value = String(address ?? '').trim();
  if (
    value.length === 0 ||
    value.length > 320 ||
    /[\r\n<>,;"\s]/.test(value) ||
    !/^[^@]+@[^@]+\.[^@]+$/.test(value)
  ) {
    throw new Error('Invalid e-mail address');
  }
  return value;
}

/** Extracts the bare address from `Name <addr@host>` or returns the input. */
export function bareAddress(from: string): string {
  const match = /<([^>]+)>\s*$/.exec(from);
  return (match ? match[1] : from).trim();
}
