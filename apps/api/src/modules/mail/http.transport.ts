import { MailDeliveryResult, MailMessage, MailTransport, assertSafeAddress } from './mail.types';

export type HttpMailProvider = 'resend' | 'postmark';

export interface HttpMailConfig {
  provider: HttpMailProvider;
  /** Provider endpoint, e.g. https://api.resend.com/emails or https://api.postmarkapp.com/email */
  url: string;
  apiKey: string;
  timeoutMs: number;
}

export const DEFAULT_HTTP_MAIL_URLS: Record<HttpMailProvider, string> = {
  resend: 'https://api.resend.com/emails',
  postmark: 'https://api.postmarkapp.com/email',
};

/**
 * Transactional e-mail over a provider HTTP API (Resend-style or Postmark-style JSON).
 * Uses the global fetch; any non-2xx response is an error (never silently dropped).
 */
export class HttpMailTransport implements MailTransport {
  readonly kind = 'http' as const;

  constructor(
    private readonly config: HttpMailConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  buildRequest(message: MailMessage): { headers: Record<string, string>; body: string } {
    const to = assertSafeAddress(message.to);
    if (this.config.provider === 'postmark') {
      return {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Postmark-Server-Token': this.config.apiKey,
        },
        body: JSON.stringify({
          From: message.from,
          To: to,
          Subject: message.subject,
          TextBody: message.text,
          HtmlBody: message.html,
          Tag: message.template.toLowerCase(),
          MessageStream: 'outbound',
        }),
      };
    }
    return {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        from: message.from,
        to: [to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        tags: [{ name: 'template', value: message.template.toLowerCase() }],
      }),
    };
  }

  async send(message: MailMessage): Promise<MailDeliveryResult> {
    const { headers, body } = this.buildRequest(message);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
        redirect: 'error',
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Mail provider responded ${response.status}: ${text.slice(0, 200)}`);
    }
    let messageId = '';
    try {
      const parsed = JSON.parse(text);
      messageId = String(parsed.id || parsed.MessageID || '');
    } catch {
      // Provider returned a non-JSON 2xx body: delivery accepted, id unknown.
    }
    return { transport: 'http', messageId };
  }
}
