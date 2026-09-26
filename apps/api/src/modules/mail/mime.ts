import { randomUUID } from 'node:crypto';
import { MailMessage, assertSafeAddress, bareAddress } from './mail.types';

const CRLF = '\r\n';

/** RFC 2047 encoded-word for non-ASCII header values. */
export function encodeHeaderValue(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ');
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(clean)) {
    return clean;
  }
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

/** Base64 body wrapped at 76 characters (RFC 2045). */
export function base64Wrapped(content: string): string {
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  return (b64.match(/.{1,76}/g) || ['']).join(CRLF);
}

/** Formats the From header: bare address or `Display Name <addr>`. */
function formatFrom(from: string): string {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (!match) {
    return assertSafeAddress(from);
  }
  const name = match[1].replace(/^"|"$/g, '');
  const addr = assertSafeAddress(match[2]);
  return name ? `${encodeHeaderValue(name)} <${addr}>` : addr;
}

/**
 * Builds an RFC 5322 multipart/alternative (text + HTML) message.
 * `now` and `boundarySeed` are injectable for deterministic tests.
 */
export function buildMimeMessage(
  message: MailMessage,
  options: { now?: Date; messageIdDomain?: string; boundarySeed?: string } = {}
): { raw: string; messageId: string } {
  const to = assertSafeAddress(message.to);
  const from = formatFrom(message.from);
  const domain = options.messageIdDomain || bareAddress(message.from).split('@')[1] || 'localhost';
  const messageId = `<${randomUUID()}@${domain}>`;
  const boundary = `=_erppreflight_${options.boundarySeed || randomUUID().replace(/-/g, '')}`;
  const date = (options.now || new Date()).toUTCString().replace('GMT', '+0000');

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeaderValue(message.subject)}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Wrapped(message.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Wrapped(message.html),
    `--${boundary}--`,
    '',
  ];

  return { raw: headers.join(CRLF) + CRLF + CRLF + body.join(CRLF), messageId };
}

/** SMTP DATA transparency (RFC 5321 §4.5.2): lines starting with '.' are doubled. */
export function dotStuff(raw: string): string {
  return raw
    .replace(/\r?\n/g, CRLF)
    .split(CRLF)
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join(CRLF);
}
