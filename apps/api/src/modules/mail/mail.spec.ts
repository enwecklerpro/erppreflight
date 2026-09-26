import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { SmtpMailTransport } from './smtp.transport';
import { HttpMailTransport } from './http.transport';
import { buildMimeMessage, dotStuff, encodeHeaderValue } from './mime';
import { resolveMailConfig } from './mail.config';
import { assertSafeAddress, MailMessage } from './mail.types';
import { escapeHtml, renderInvitation, renderPasswordReset } from './mail.templates';

const message: MailMessage = {
  to: 'user@example.com',
  from: 'ERP Preflight <no-reply@example.com>',
  subject: 'Reset your password',
  text: 'Hello\n.leading dot line\nLink: https://app.example.com/reset-password?token=abc',
  html: '<p>Hello</p>',
  template: 'PASSWORD_RESET',
};

interface FakeSmtpOptions {
  auth?: 'PLAIN' | 'LOGIN' | 'NONE';
  rejectRcpt?: boolean;
}

/** Minimal RFC 5321 server speaking the real protocol over TCP. */
function startFakeSmtp(opts: FakeSmtpOptions = {}) {
  const transcript: string[] = [];
  let data = '';
  const server = net.createServer((socket) => {
    let inData = false;
    let buffer = '';
    let loginStep = 0;
    socket.write('220 fake.smtp ESMTP ready\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 2.0.0 Ok: queued as FAKE123\r\n');
          } else {
            data += line + '\r\n';
          }
          continue;
        }
        transcript.push(line);
        if (loginStep === 1) {
          loginStep = 2;
          socket.write('334 UGFzc3dvcmQ6\r\n');
          continue;
        }
        if (loginStep === 2) {
          loginStep = 0;
          socket.write('235 2.7.0 Authentication successful\r\n');
          continue;
        }
        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO')) {
          const auth = opts.auth === 'LOGIN' ? '250-AUTH LOGIN\r\n' : opts.auth === 'NONE' ? '' : '250-AUTH PLAIN LOGIN\r\n';
          socket.write(`250-fake.smtp\r\n${auth}250 8BITMIME\r\n`);
        } else if (upper.startsWith('AUTH PLAIN')) {
          socket.write('235 2.7.0 Authentication successful\r\n');
        } else if (upper === 'AUTH LOGIN') {
          loginStep = 1;
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (upper.startsWith('MAIL FROM')) {
          socket.write('250 2.1.0 Ok\r\n');
        } else if (upper.startsWith('RCPT TO')) {
          socket.write(opts.rejectRcpt ? '550 5.1.1 User unknown\r\n' : '250 2.1.5 Ok\r\n');
        } else if (upper === 'DATA') {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (upper === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else {
          socket.write('502 5.5.2 Command not recognized\r\n');
        }
      }
    });
  });
  return new Promise<{ port: number; transcript: string[]; data: () => string; close: () => void }>((resolve) => {
    server.listen(0, '0.0.0.0', () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        transcript,
        data: () => data,
        close: () => server.close(),
      });
    });
  });
}

describe('SmtpMailTransport (real SMTP dialogue over TCP)', () => {
  let close: (() => void) | undefined;
  afterEach(() => close?.());

  it('delivers with AUTH PLAIN, dot-stuffs DATA and returns the queue id', async () => {
    const srv = await startFakeSmtp({ auth: 'PLAIN' });
    close = srv.close;
    const transport = new SmtpMailTransport({
      host: '127.0.0.1',
      port: srv.port,
      security: 'none',
      user: 'mailer',
      password: 's3cret',
      rejectUnauthorized: true,
      timeoutMs: 5000,
      ehloName: 'api.test',
    });
    const result = await transport.send(message);
    expect(result).toEqual({ transport: 'smtp', messageId: 'FAKE123' });
    expect(srv.transcript[0]).toBe('EHLO api.test');
    const authLine = srv.transcript.find((l) => l.startsWith('AUTH PLAIN'))!;
    expect(Buffer.from(authLine.slice('AUTH PLAIN '.length), 'base64').toString()).toBe('\u0000mailer\u0000s3cret');
    expect(srv.transcript).toContain('MAIL FROM:<no-reply@example.com>');
    expect(srv.transcript).toContain('RCPT TO:<user@example.com>');
    expect(srv.data()).toContain('Subject: Reset your password');
    expect(srv.data()).toContain('Content-Type: multipart/alternative');
  });

  it('falls back to AUTH LOGIN when PLAIN is not offered', async () => {
    const srv = await startFakeSmtp({ auth: 'LOGIN' });
    close = srv.close;
    const transport = new SmtpMailTransport({
      host: '127.0.0.1',
      port: srv.port,
      security: 'none',
      user: 'mailer',
      password: 'pw',
      rejectUnauthorized: true,
      timeoutMs: 5000,
    });
    await transport.send(message);
    expect(srv.transcript).toContain('AUTH LOGIN');
    expect(srv.transcript).toContain(Buffer.from('mailer').toString('base64'));
  });

  it('surfaces a rejected recipient as an error', async () => {
    const srv = await startFakeSmtp({ rejectRcpt: true });
    close = srv.close;
    const transport = new SmtpMailTransport({
      host: '127.0.0.1',
      port: srv.port,
      security: 'none',
      rejectUnauthorized: true,
      timeoutMs: 5000,
    });
    await expect(transport.send(message)).rejects.toThrow(/550/);
  });

  it('refuses STARTTLS mode when the server does not offer it', async () => {
    const srv = await startFakeSmtp();
    close = srv.close;
    const transport = new SmtpMailTransport({
      host: '127.0.0.1',
      port: srv.port,
      security: 'starttls',
      rejectUnauthorized: true,
      timeoutMs: 5000,
    });
    await expect(transport.send(message)).rejects.toThrow(/STARTTLS/);
  });

  it('never sends credentials in clear text to a non-loopback host', async () => {
    const srv = await startFakeSmtp();
    close = srv.close;
    // 127.0.0.2 is loopback-routed on Linux but not in the loopback allow-list
    const transport = new SmtpMailTransport({
      host: '127.0.0.2',
      port: srv.port,
      security: 'none',
      user: 'mailer',
      password: 'pw',
      rejectUnauthorized: true,
      timeoutMs: 5000,
    });
    await expect(transport.send(message)).rejects.toThrow(/unencrypted/);
    expect(srv.transcript.some((l) => l.startsWith('AUTH'))).toBe(false);
  });
});

describe('HttpMailTransport', () => {
  let server: http.Server | undefined;
  afterEach(() => server?.close());

  async function start(status: number, body: string) {
    const received: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
    server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body: data });
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(body);
      });
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/emails`, received };
  }

  it('posts a Resend-style payload with a Bearer key', async () => {
    const { url, received } = await start(200, '{"id":"msg_1"}');
    const t = new HttpMailTransport({ provider: 'resend', url, apiKey: 're_key', timeoutMs: 5000 });
    expect(await t.send(message)).toEqual({ transport: 'http', messageId: 'msg_1' });
    expect(received[0].headers.authorization).toBe('Bearer re_key');
    const body = JSON.parse(received[0].body);
    expect(body).toMatchObject({ to: ['user@example.com'], subject: 'Reset your password', html: '<p>Hello</p>' });
  });

  it('posts a Postmark-style payload with the server token header', async () => {
    const { url, received } = await start(200, '{"MessageID":"pm-1"}');
    const t = new HttpMailTransport({ provider: 'postmark', url, apiKey: 'pm_key', timeoutMs: 5000 });
    expect((await t.send(message)).messageId).toBe('pm-1');
    expect(received[0].headers['x-postmark-server-token']).toBe('pm_key');
    expect(JSON.parse(received[0].body)).toMatchObject({ To: 'user@example.com', TextBody: message.text });
  });

  it('treats non-2xx provider responses as failures', async () => {
    const { url } = await start(422, '{"message":"invalid from"}');
    const t = new HttpMailTransport({ provider: 'resend', url, apiKey: 'k', timeoutMs: 5000 });
    await expect(t.send(message)).rejects.toThrow(/422/);
  });
});

describe('MIME building and address safety', () => {
  it('builds a multipart/alternative message with base64 parts', () => {
    const { raw, messageId } = buildMimeMessage(message, {
      now: new Date('2026-01-02T03:04:05Z'),
      boundarySeed: 'seed',
    });
    expect(messageId).toMatch(/^<[0-9a-f-]+@example\.com>$/);
    expect(raw).toContain('From: ERP Preflight <no-reply@example.com>');
    expect(raw).toContain('Date: Fri, 02 Jan 2026 03:04:05 +0000');
    expect(raw).toContain('boundary="=_erppreflight_seed"');
    const textPart = raw.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0];
    expect(Buffer.from(textPart.replace(/\r\n/g, ''), 'base64').toString()).toBe(message.text);
  });

  it('encodes non-ASCII subjects as RFC 2047 words', () => {
    expect(encodeHeaderValue('Passwort zurücksetzen')).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    expect(encodeHeaderValue('plain')).toBe('plain');
    expect(encodeHeaderValue('a\r\nBcc: x@y.z')).not.toMatch(/\r|\n/);
  });

  it('dot-stuffs lines starting with a dot', () => {
    expect(dotStuff('a\r\n.b\r\n..c')).toBe('a\r\n..b\r\n...c');
  });

  it('rejects header-injection in recipient addresses', () => {
    expect(() => assertSafeAddress('victim@example.com\r\nBcc: all@example.com')).toThrow();
    expect(() => assertSafeAddress('a@b')).toThrow();
    expect(assertSafeAddress(' ok@example.com ')).toBe('ok@example.com');
  });
});

describe('Mail templates', () => {
  it('escapes user-controlled values in HTML', () => {
    expect(escapeHtml('<script>"x"</script>')).toBe('&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
    const mail = renderInvitation({
      organizationName: '<b>Evil</b>',
      inviterName: 'Mallory',
      role: 'VIEWER',
      url: 'https://app.example.com/accept-invite?token=t',
      expiresDays: 7,
    });
    expect(mail.html).not.toContain('<b>Evil</b>');
    expect(mail.html).toContain('&lt;b&gt;Evil&lt;/b&gt;');
    expect(mail.text).toContain('https://app.example.com/accept-invite?token=t');
  });

  it('states expiry and single use in reset e-mails', () => {
    const mail = renderPasswordReset({ name: 'Ann', url: 'https://x.example/reset-password?token=t', expiresMinutes: 60 });
    expect(mail.template).toBe('PASSWORD_RESET');
    expect(mail.text).toMatch(/expires in 60 minutes and can be used once/);
  });
});

describe('resolveMailConfig', () => {
  it('defaults to the dev outbox outside production', () => {
    const { config, errors } = resolveMailConfig({ NODE_ENV: 'development' });
    expect(errors).toEqual([]);
    expect(config.transport).toBe('dev');
    expect(config.devOutboxEnabled).toBe(true);
    expect(config.appPublicUrl).toBe('http://localhost:3000');
  });

  it('requires an explicit transport, sender and public URL in production', () => {
    const { errors } = resolveMailConfig({ NODE_ENV: 'production' });
    expect(errors.join('\n')).toMatch(/MAIL_TRANSPORT/);
    expect(errors.join('\n')).toMatch(/MAIL_FROM/);
    expect(errors.join('\n')).toMatch(/APP_PUBLIC_URL/);
  });

  it('accepts SMTP in production and infers implicit TLS on port 465', () => {
    const { config, errors } = resolveMailConfig({
      NODE_ENV: 'production',
      MAIL_TRANSPORT: 'smtp',
      MAIL_FROM: 'no-reply@example.com',
      APP_PUBLIC_URL: 'https://app.example.com/',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_USER: 'u',
      SMTP_PASSWORD: 'p',
    });
    expect(errors).toEqual([]);
    expect(config.smtp).toMatchObject({ host: 'smtp.example.com', port: 465, security: 'tls' });
    expect(config.appPublicUrl).toBe('https://app.example.com');
  });

  it('only allows the dev transport in production with a strong mailbox token', () => {
    const weak = resolveMailConfig({
      NODE_ENV: 'production',
      MAIL_TRANSPORT: 'dev',
      MAIL_FROM: 'a@b.co',
      APP_PUBLIC_URL: 'https://x.example',
    });
    expect(weak.errors.join()).toMatch(/MAIL_DEV_OUTBOX_TOKEN/);
    const ok = resolveMailConfig({
      NODE_ENV: 'production',
      MAIL_TRANSPORT: 'dev',
      MAIL_FROM: 'a@b.co',
      APP_PUBLIC_URL: 'https://x.example',
      MAIL_DEV_OUTBOX_TOKEN: 'x'.repeat(32),
    });
    expect(ok.errors).toEqual([]);
    expect(ok.config.devOutboxEnabled).toBe(true);
  });

  it('rejects clear-text SMTP credentials in production and requires an API key for http', () => {
    expect(
      resolveMailConfig({
        NODE_ENV: 'production',
        MAIL_TRANSPORT: 'smtp',
        MAIL_FROM: 'a@b.co',
        APP_PUBLIC_URL: 'https://x.example',
        SMTP_HOST: 'h',
        SMTP_SECURE: 'none',
        SMTP_USER: 'u',
      }).errors.join()
    ).toMatch(/clear text/);
    expect(
      resolveMailConfig({ NODE_ENV: 'development', MAIL_TRANSPORT: 'http' }).errors.join()
    ).toMatch(/MAIL_HTTP_API_KEY/);
  });
});
