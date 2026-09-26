import * as net from 'node:net';
import * as tls from 'node:tls';
import * as os from 'node:os';
import {
  MailDeliveryResult,
  MailMessage,
  MailTransport,
  assertSafeAddress,
  bareAddress,
} from './mail.types';
import { buildMimeMessage, dotStuff } from './mime';

export type SmtpSecurity = 'tls' | 'starttls' | 'none';

export interface SmtpConfig {
  host: string;
  port: number;
  /** tls = implicit TLS (465), starttls = upgrade after EHLO (587), none = plaintext relay. */
  security: SmtpSecurity;
  user?: string;
  password?: string;
  /** Verify the server certificate (default true). */
  rejectUnauthorized: boolean;
  timeoutMs: number;
  ehloName?: string;
}

interface SmtpReply {
  code: number;
  lines: string[];
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Minimal RFC 5321 SMTP client over node:net / node:tls (no third-party dependency).
 * Supports implicit TLS, STARTTLS, AUTH PLAIN and AUTH LOGIN, one message per connection.
 * Credentials are never sent over an unencrypted connection except to a loopback relay.
 */
export class SmtpConnection {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer = '';
  private pendingLines: string[] = [];
  private waiters: Array<{ resolve: (r: SmtpReply) => void; reject: (e: Error) => void }> = [];
  private replies: SmtpReply[] = [];
  private failure: Error | null = null;
  private encrypted = false;

  constructor(private readonly config: SmtpConfig) {}

  async connect(): Promise<void> {
    const { host, port, security, rejectUnauthorized } = this.config;
    const socket =
      security === 'tls'
        ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized })
        : net.connect({ host, port });
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      socket.once('error', onError);
      socket.once(security === 'tls' ? 'secureConnect' : 'connect', () => {
        socket.removeListener('error', onError);
        resolve();
      });
    });
    this.encrypted = security === 'tls';
    this.attach(socket);
  }

  private attach(socket: net.Socket | tls.TLSSocket): void {
    this.socket = socket;
    this.buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(this.config.timeoutMs, () => {
      this.fail(new Error(`SMTP timeout after ${this.config.timeoutMs}ms`));
      socket.destroy();
    });
    socket.on('data', (chunk: string) => this.onData(chunk));
    socket.on('error', (err: Error) => this.fail(err));
    socket.on('close', () => this.fail(new Error('SMTP connection closed')));
  }

  private detach(): void {
    if (!this.socket) return;
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('error');
    this.socket.removeAllListeners('close');
    this.socket.setTimeout(0);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 1_000_000) {
      this.fail(new Error('SMTP reply too large'));
      this.socket?.destroy();
      return;
    }
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!match) {
        this.fail(new Error(`Malformed SMTP reply: ${line.slice(0, 120)}`));
        return;
      }
      this.pendingLines.push(match[3]);
      if (match[2] === ' ') {
        const reply = { code: Number(match[1]), lines: this.pendingLines };
        this.pendingLines = [];
        const waiter = this.waiters.shift();
        if (waiter) waiter.resolve(reply);
        else this.replies.push(reply);
      }
    }
  }

  private fail(err: Error): void {
    if (!this.failure) this.failure = err;
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w.reject(this.failure);
  }

  private readReply(): Promise<SmtpReply> {
    const queued = this.replies.shift();
    if (queued) return Promise.resolve(queued);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private write(data: string): void {
    if (!this.socket || this.failure) {
      throw this.failure || new Error('SMTP connection is not open');
    }
    this.socket.write(data);
  }

  async command(line: string | null, expected: number[], redactedLabel?: string): Promise<SmtpReply> {
    if (line !== null) {
      if (/[\r\n]/.test(line)) throw new Error('SMTP command contains a line break');
      this.write(`${line}\r\n`);
    }
    const reply = await this.readReply();
    if (!expected.includes(reply.code)) {
      const shown = redactedLabel || (line ?? 'greeting');
      throw new Error(`SMTP ${shown} rejected: ${reply.code} ${reply.lines.join(' ').slice(0, 200)}`);
    }
    return reply;
  }

  async upgradeToTls(): Promise<void> {
    const plain = this.socket as net.Socket;
    this.detach();
    const { host, rejectUnauthorized } = this.config;
    const secure = tls.connect({
      socket: plain,
      servername: net.isIP(host) ? undefined : host,
      rejectUnauthorized,
    });
    await new Promise<void>((resolve, reject) => {
      secure.once('secureConnect', () => resolve());
      secure.once('error', reject);
    });
    this.encrypted = true;
    this.attach(secure);
  }

  isEncrypted(): boolean {
    return this.encrypted;
  }

  async sendData(raw: string): Promise<SmtpReply> {
    this.write(`${dotStuff(raw)}\r\n.\r\n`);
    const reply = await this.readReply();
    if (reply.code !== 250) {
      throw new Error(`SMTP message rejected: ${reply.code} ${reply.lines.join(' ').slice(0, 200)}`);
    }
    return reply;
  }

  close(): void {
    try {
      this.detach();
      this.socket?.end();
      this.socket?.destroy();
    } catch {
      // already closed
    }
  }
}

function parseCapabilities(reply: SmtpReply): { starttls: boolean; auth: Set<string> } {
  const auth = new Set<string>();
  let starttls = false;
  for (const line of reply.lines.slice(1)) {
    const upper = line.toUpperCase().trim();
    if (upper === 'STARTTLS') starttls = true;
    if (upper.startsWith('AUTH ') || upper.startsWith('AUTH=')) {
      for (const mech of upper.slice(5).split(/\s+/)) if (mech) auth.add(mech);
    }
  }
  return { starttls, auth };
}

export class SmtpMailTransport implements MailTransport {
  readonly kind = 'smtp' as const;

  constructor(private readonly config: SmtpConfig) {}

  async send(message: MailMessage): Promise<MailDeliveryResult> {
    const to = assertSafeAddress(message.to);
    const envelopeFrom = assertSafeAddress(bareAddress(message.from));
    const { raw, messageId } = buildMimeMessage(message);
    const conn = new SmtpConnection(this.config);
    const ehloName = (this.config.ehloName || os.hostname() || 'localhost').replace(/[^A-Za-z0-9.-]/g, '');

    try {
      await conn.connect();
      await conn.command(null, [220]);
      let ehlo = await conn.command(`EHLO ${ehloName}`, [250]);
      let caps = parseCapabilities(ehlo);

      if (this.config.security === 'starttls') {
        if (!caps.starttls) {
          throw new Error('SMTP server does not advertise STARTTLS (set SMTP_SECURE=tls or none)');
        }
        await conn.command('STARTTLS', [220]);
        await conn.upgradeToTls();
        ehlo = await conn.command(`EHLO ${ehloName}`, [250]);
        caps = parseCapabilities(ehlo);
      }

      if (this.config.user) {
        if (!conn.isEncrypted() && !LOOPBACK_HOSTS.has(this.config.host)) {
          throw new Error('Refusing to send SMTP credentials over an unencrypted connection');
        }
        const user = this.config.user;
        const password = this.config.password || '';
        if (caps.auth.has('PLAIN') || caps.auth.size === 0) {
          const token = Buffer.from(`\u0000${user}\u0000${password}`, 'utf8').toString('base64');
          await conn.command(`AUTH PLAIN ${token}`, [235], 'AUTH PLAIN');
        } else if (caps.auth.has('LOGIN')) {
          await conn.command('AUTH LOGIN', [334]);
          await conn.command(Buffer.from(user, 'utf8').toString('base64'), [334], 'AUTH LOGIN user');
          await conn.command(Buffer.from(password, 'utf8').toString('base64'), [235], 'AUTH LOGIN password');
        } else {
          throw new Error(`No supported SMTP AUTH mechanism (server offers ${[...caps.auth].join(', ')})`);
        }
      }

      await conn.command(`MAIL FROM:<${envelopeFrom}>`, [250]);
      await conn.command(`RCPT TO:<${to}>`, [250, 251]);
      await conn.command('DATA', [354]);
      const accepted = await conn.sendData(raw);
      try {
        await conn.command('QUIT', [221]);
      } catch {
        // The message is already accepted; a failed QUIT is irrelevant.
      }
      const queueId = /queued as\s+(\S+)/i.exec(accepted.lines.join(' '))?.[1];
      return { transport: 'smtp', messageId: queueId || messageId };
    } finally {
      conn.close();
    }
  }
}
