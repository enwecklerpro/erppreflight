import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import {
  OutboundPolicy,
  safeOutboundRequest,
  validateOutboundUrl,
  UnsafeOutboundUrlError,
} from '../../common/security/outbound-request';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../outbox/outbox.service';
import { CredentialVault } from '../connectors/credential-vault';
import { CreateWebhookDto } from './dto/webhook.dto';
import * as crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  WEBHOOK_EVENT_CATALOG,
  WEBHOOK_EVENT_TYPES,
  hubSignature,
  retryDelayMs,
  timestampedSignature,
} from './webhook-signing';

const GENERIC_URL_ERROR = 'Webhook URL is not allowed: it must be a publicly reachable http(s) endpoint';
const SECRET_PURPOSE = 'webhook-signing-secret';

function requireHttpsInProduction(url: string): void {
  if (process.env.NODE_ENV === 'production' && !url.toLowerCase().startsWith('https://')) {
    throw new BadRequestException('Webhook URL must use https');
  }
}

/** Private network targets only with an explicit operator opt-in (self-hosted receivers). */
export function webhookOutboundPolicy(env: NodeJS.ProcessEnv = process.env): OutboundPolicy {
  return {
    allowPrivateNetworks: env.WEBHOOK_ALLOW_PRIVATE_NETWORKS === 'true',
    allowLoopbackInTests: env.WEBHOOK_ALLOW_LOOPBACK_IN_TESTS === 'true',
  };
}

export interface DeliveryRow {
  id: string;
  organization_id: string;
  webhook_id: string;
  event_id: string;
  event_type: string;
  payload: any;
  status: string;
  attempts: number;
  max_attempts: number;
}

/**
 * Webhooks (C §48): event catalog, signed deliveries, persistent delivery log,
 * retries with backoff, replay and idempotency.
 *
 * Domain events from the transactional outbox are fanned out into
 * webhook_deliveries (UNIQUE(webhook_id, event_id) ⇒ an outbox event is never
 * enqueued twice for the same endpoint). A background worker claims due
 * deliveries with FOR UPDATE SKIP LOCKED (safe with several API replicas).
 */
@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhooksService.name);
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
    @Optional() private readonly vault?: CredentialVault
  ) {}

  onModuleInit() {
    this.outbox.subscribe('*', async (event) => {
      await this.dispatchEvent(event.organizationId, event.eventType, event.payload, (event as any).id);
    });
    const interval = Number(process.env.WEBHOOK_RETRY_INTERVAL_MS || 10_000);
    if (process.env.NODE_ENV !== 'test' && interval > 0) {
      this.timer = setInterval(() => void this.processDueDeliveries().catch(() => undefined), interval);
      this.timer.unref?.();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  eventCatalog() {
    return WEBHOOK_EVENT_CATALOG.map((e) => ({ type: e.type, description: e.description, payloadFields: [...e.payload] }));
  }

  // ---------------------------------------------------------------------------
  // Secrets (encrypted at rest; legacy plaintext rows keep working)
  // ---------------------------------------------------------------------------
  private sealSecret(organizationId: string, secret: string): string {
    if (!this.vault) return secret;
    return this.vault.encryptString(organizationId, SECRET_PURPOSE, secret).ciphertext;
  }

  private openSecret(organizationId: string, stored: string): string {
    if (this.vault && typeof stored === 'string' && stored.startsWith('v1.')) {
      return this.vault.decryptString(organizationId, SECRET_PURPOSE, stored);
    }
    return stored;
  }

  private validateEvents(events?: string[]): string[] {
    const list = events && events.length ? Array.from(new Set(events)) : ['analysis.completed', 'analysis.failed', 'finding.critical'];
    const unknown = list.filter((e) => e !== '*' && !WEBHOOK_EVENT_TYPES.has(e));
    if (unknown.length) {
      throw new BadRequestException(`Unknown webhook event type(s): ${unknown.join(', ')}. See GET /webhooks/events.`);
    }
    return list;
  }

  async create(organizationId: string, userId: string, dto: CreateWebhookDto) {
    requireHttpsInProduction(dto.url);
    try {
      await validateOutboundUrl(dto.url, webhookOutboundPolicy());
    } catch (err) {
      if (err instanceof UnsafeOutboundUrlError) {
        this.logger.warn(`Rejected webhook URL for org ${organizationId}: ${err.reason}`);
        throw new BadRequestException(GENERIC_URL_ERROR);
      }
      throw err;
    }

    const id = uuidv4();
    const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
    const events = this.validateEvents(dto.events);

    const res = await this.db.query(
      `INSERT INTO webhooks (
        id, organization_id, url, secret, events, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, url, events, status, created_at`,
      [id, organizationId, dto.url, this.sealSecret(organizationId, secret), JSON.stringify(events), userId]
    );

    // The signing secret is returned exactly once.
    return { ...res.rows[0], secret };
  }

  async findAll(organizationId: string) {
    const res = await this.db.query(
      `SELECT w.id, w.url, w.events, w.status, w.failure_count, w.last_triggered_at, w.created_at,
              (SELECT COUNT(*)::int FROM webhook_deliveries d WHERE d.webhook_id = w.id AND d.status = 'SUCCEEDED') AS delivered,
              (SELECT COUNT(*)::int FROM webhook_deliveries d WHERE d.webhook_id = w.id AND d.status IN ('FAILED','DEAD')) AS failed
       FROM webhooks w
       WHERE w.organization_id = $1
       ORDER BY w.created_at DESC`,
      [organizationId]
    );
    return res.rows;
  }

  async setStatus(organizationId: string, id: string, status: 'ACTIVE' | 'DISABLED') {
    const res = await this.db.query(
      `UPDATE webhooks SET status = $3, failure_count = CASE WHEN $3 = 'ACTIVE' THEN 0 ELSE failure_count END, updated_at = NOW()
        WHERE organization_id = $1 AND id = $2 RETURNING id, status`,
      [organizationId, id, status]
    );
    if (!res.rows?.length) throw new NotFoundException(`Webhook with ID '${id}' not found`);
    return res.rows[0];
  }

  async rotateSecret(organizationId: string, id: string) {
    const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
    const res = await this.db.query(
      `UPDATE webhooks SET secret = $3, updated_at = NOW() WHERE organization_id = $1 AND id = $2 RETURNING id`,
      [organizationId, id, this.sealSecret(organizationId, secret)]
    );
    if (!res.rows?.length) throw new NotFoundException(`Webhook with ID '${id}' not found`);
    return { id, secret };
  }

  async remove(organizationId: string, id: string) {
    const res = await this.db.query(
      `DELETE FROM webhooks WHERE organization_id = $1 AND id = $2 RETURNING id`,
      [organizationId, id]
    );
    if (!res.rows?.length) {
      throw new NotFoundException(`Webhook with ID '${id}' not found`);
    }
    return { success: true, deletedId: id };
  }

  async listDeliveries(organizationId: string, webhookId: string, limit = 50) {
    const hook = await this.db.query(`SELECT id FROM webhooks WHERE organization_id = $1 AND id = $2`, [organizationId, webhookId]);
    if (!hook.rows?.length) throw new NotFoundException(`Webhook with ID '${webhookId}' not found`);
    const res = await this.db.query(
      `SELECT id, event_id, event_type, status, attempts, max_attempts, next_attempt_at, last_http_status, last_error,
              last_duration_ms, replay_of, created_at, delivered_at
         FROM webhook_deliveries WHERE organization_id = $1 AND webhook_id = $2
        ORDER BY created_at DESC LIMIT $3`,
      [organizationId, webhookId, Math.min(Math.max(limit, 1), 200)]
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      eventId: r.event_id,
      eventType: r.event_type,
      status: r.status,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      nextAttemptAt: r.status === 'PENDING' || r.status === 'FAILED' ? r.next_attempt_at : null,
      lastHttpStatus: r.last_http_status,
      lastError: r.last_error,
      lastDurationMs: r.last_duration_ms,
      replayOf: r.replay_of,
      createdAt: r.created_at,
      deliveredAt: r.delivered_at,
    }));
  }

  async getDeliveryPayload(organizationId: string, webhookId: string, deliveryId: string) {
    const res = await this.db.query(
      `SELECT payload FROM webhook_deliveries WHERE organization_id = $1 AND webhook_id = $2 AND id = $3`,
      [organizationId, webhookId, deliveryId]
    );
    if (!res.rows?.length) throw new NotFoundException('Delivery not found');
    return res.rows[0].payload;
  }

  /** Re-sends an earlier delivery's payload (same event id → receivers stay idempotent). */
  async replay(organizationId: string, webhookId: string, deliveryId: string) {
    const res = await this.db.query(
      `SELECT * FROM webhook_deliveries WHERE organization_id = $1 AND webhook_id = $2 AND id = $3`,
      [organizationId, webhookId, deliveryId]
    );
    const orig = res.rows?.[0];
    if (!orig) throw new NotFoundException('Delivery not found');
    const id = uuidv4();
    await this.db.query(
      `INSERT INTO webhook_deliveries (id, organization_id, webhook_id, event_id, event_type, payload, replay_of, next_attempt_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, NOW() + INTERVAL '1 minute')`,
      [id, organizationId, webhookId, `${orig.event_id}#replay-${id.slice(0, 8)}`, orig.event_type, JSON.stringify(orig.payload), orig.id]
    );
    const delivered = await this.attemptDelivery(organizationId, id);
    return { deliveryId: id, replayOf: orig.id, ...delivered };
  }

  async sendTestPing(organizationId: string, id: string) {
    const res = await this.db.query(`SELECT id FROM webhooks WHERE organization_id = $1 AND id = $2`, [organizationId, id]);
    if (!res.rows?.length) {
      throw new NotFoundException(`Webhook with ID '${id}' not found`);
    }
    const eventId = uuidv4();
    const deliveryId = uuidv4();
    const payload = {
      id: eventId,
      event: 'ping',
      organizationId,
      timestamp: new Date().toISOString(),
      data: { webhookId: id, message: 'ERP Preflight webhook verification ping.' },
    };
    await this.db.query(
      `INSERT INTO webhook_deliveries (id, organization_id, webhook_id, event_id, event_type, payload, max_attempts, next_attempt_at)
       VALUES ($1,$2,$3,$4,'ping',$5,1, NOW() + INTERVAL '1 minute')`,
      [deliveryId, organizationId, id, eventId, JSON.stringify(payload)]
    );
    const result = await this.attemptDelivery(organizationId, deliveryId);
    return { deliveryId, ...result, payload };
  }

  /** Fans an event out to every subscribed, active endpoint of the tenant. */
  async dispatchEvent(organizationId: string, eventName: string, eventData: Record<string, any>, eventId?: string) {
    const res = await this.db.query(
      `SELECT id, events FROM webhooks WHERE organization_id = $1 AND status = 'ACTIVE'`,
      [organizationId],
      { tenantId: organizationId }
    );
    const idForEvent = eventId || uuidv4();
    const deliveryIds: string[] = [];
    for (const wh of res.rows || []) {
      const subscribed: string[] = typeof wh.events === 'string' ? JSON.parse(wh.events) : wh.events;
      if (!subscribed.includes(eventName) && !subscribed.includes('*')) continue;
      const payload = {
        id: idForEvent,
        event: eventName,
        organizationId,
        timestamp: new Date().toISOString(),
        data: eventData,
      };
      const inserted = await this.db.query(
        `INSERT INTO webhook_deliveries (id, organization_id, webhook_id, event_id, event_type, payload, next_attempt_at)
         VALUES ($1,$2,$3,$4,$5,$6, NOW() + INTERVAL '1 minute')
         ON CONFLICT (webhook_id, event_id) DO NOTHING RETURNING id`,
        [uuidv4(), organizationId, wh.id, idForEvent, eventName, JSON.stringify(payload)],
        { tenantId: organizationId }
      );
      if (inserted.rows?.[0]) deliveryIds.push(inserted.rows[0].id);
    }
    for (const id of deliveryIds) {
      await this.attemptDelivery(organizationId, id).catch((err) =>
        this.logger.warn(`Webhook delivery ${id} attempt failed: ${err?.message}`)
      );
    }
    return { enqueued: deliveryIds.length };
  }

  /** One delivery attempt with signature headers; updates the delivery log. */
  async attemptDelivery(organizationId: string, deliveryId: string): Promise<{ success: boolean; httpStatus?: number; error?: string; status: string }> {
    const res = await this.db.query(
      `SELECT d.*, w.url, w.secret, w.status AS webhook_status FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
        WHERE d.organization_id = $1 AND d.id = $2`,
      [organizationId, deliveryId],
      { tenantId: organizationId }
    );
    const d = res.rows?.[0];
    if (!d) throw new NotFoundException('Delivery not found');
    if (d.status === 'SUCCEEDED') return { success: true, status: 'SUCCEEDED' };
    if (d.webhook_status !== 'ACTIVE' && d.event_type !== 'ping') {
      return { success: false, status: d.status, error: 'Webhook is disabled' };
    }
    const body = JSON.stringify(d.payload);
    const secret = this.openSecret(organizationId, d.secret);
    const ts = Math.floor(Date.now() / 1000);
    const started = Date.now();
    let httpStatus: number | undefined;
    let error: string | undefined;
    try {
      const resp = await safeOutboundRequest(d.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ERPPreflight-Webhooks/1.0',
          'X-Hub-Signature-256': hubSignature(secret, body),
          'X-ERPPreflight-Signature': timestampedSignature(secret, body, ts),
          'X-ERPPreflight-Event-Id': String(d.payload?.id ?? d.event_id),
          'X-ERPPreflight-Delivery-Id': d.id,
          'X-Delivery-ID': d.id,
          'X-Event-Type': d.event_type,
        },
        body,
        timeoutMs: 10_000,
        policy: webhookOutboundPolicy(),
      });
      httpStatus = resp.status;
      if (resp.status < 200 || resp.status >= 300) error = `Receiver answered HTTP ${resp.status}`;
    } catch (err: any) {
      error = err instanceof UnsafeOutboundUrlError ? GENERIC_URL_ERROR : err?.name === 'AbortError' ? 'Receiver timed out' : 'Receiver unreachable';
    }
    const attempts = d.attempts + 1;
    const duration = Date.now() - started;
    const success = !error;
    const status = success ? 'SUCCEEDED' : attempts >= d.max_attempts ? 'DEAD' : 'FAILED';
    await this.db.query(
      `UPDATE webhook_deliveries
          SET status = $3, attempts = $4, last_http_status = $5, last_error = $6, last_duration_ms = $7,
              next_attempt_at = $8, delivered_at = CASE WHEN $3 = 'SUCCEEDED' THEN NOW() ELSE delivered_at END
        WHERE organization_id = $1 AND id = $2`,
      [organizationId, deliveryId, status, attempts, httpStatus ?? null, error ?? null, duration, new Date(Date.now() + retryDelayMs(attempts))],
      { tenantId: organizationId }
    );
    await this.db.query(
      success
        ? `UPDATE webhooks SET last_triggered_at = NOW(), failure_count = 0 WHERE organization_id = $1 AND id = $2`
        : `UPDATE webhooks SET failure_count = failure_count + 1 WHERE organization_id = $1 AND id = $2`,
      [organizationId, d.webhook_id],
      { tenantId: organizationId }
    );
    return { success, httpStatus, error, status };
  }

  /** Background retry worker: claims due FAILED/PENDING deliveries across tenants. */
  async processDueDeliveries(limit = 25): Promise<number> {
    if (this.draining) return 0;
    this.draining = true;
    try {
      const claimed = await this.db.query(
        `UPDATE webhook_deliveries SET next_attempt_at = NOW() + INTERVAL '2 minutes'
          WHERE id IN (
            SELECT id FROM webhook_deliveries
             WHERE status IN ('PENDING','FAILED') AND next_attempt_at <= NOW()
             ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED)
          RETURNING id, organization_id`,
        [limit],
        { bypassRls: true }
      );
      for (const row of claimed.rows || []) {
        await this.attemptDelivery(row.organization_id, row.id).catch((err) =>
          this.logger.warn(`Webhook retry ${row.id} failed: ${err?.message}`)
        );
      }
      return claimed.rows?.length ?? 0;
    } finally {
      this.draining = false;
    }
  }
}
