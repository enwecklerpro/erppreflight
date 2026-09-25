import { Injectable, NotFoundException, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import {
  safeOutboundRequest,
  validateOutboundUrl,
  UnsafeOutboundUrlError,
} from '../../common/security/outbound-request';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../outbox/outbox.service';
import { CreateWebhookDto } from './dto/webhook.dto';
import * as crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

const GENERIC_URL_ERROR = 'Webhook URL is not allowed: it must be a publicly reachable http(s) endpoint';

function requireHttpsInProduction(url: string): void {
  if (process.env.NODE_ENV === 'production' && !url.toLowerCase().startsWith('https://')) {
    throw new BadRequestException('Webhook URL must use https');
  }
}

@Injectable()
export class WebhooksService implements OnModuleInit {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService
  ) {}

  onModuleInit() {
    this.outbox.subscribe('*', async (event) => {
      await this.dispatchEvent(event.organizationId, event.eventType, event.payload);
    });
  }

  async create(organizationId: string, userId: string, dto: CreateWebhookDto) {
    requireHttpsInProduction(dto.url);
    try {
      await validateOutboundUrl(dto.url);
    } catch (err) {
      if (err instanceof UnsafeOutboundUrlError) {
        this.logger.warn(`Rejected webhook URL for org ${organizationId}: ${err.reason}`);
        throw new BadRequestException(GENERIC_URL_ERROR);
      }
      throw err;
    }

    const id = uuidv4();
    const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
    const events = dto.events || [
      'analysis.completed',
      'analysis.failed',
      'finding.critical',
      'changeset.simulated',
    ];

    const res = await this.db.query(
      `INSERT INTO webhooks (
        id, organization_id, url, secret, events, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, url, secret, events, status, created_at`,
      [id, organizationId, dto.url, secret, JSON.stringify(events), userId]
    );

    return res.rows[0];
  }

  async findAll(organizationId: string) {
    const res = await this.db.query(
      `SELECT id, url, events, status, failure_count, last_triggered_at, created_at
       FROM webhooks
       WHERE organization_id = $1
       ORDER BY created_at DESC`,
      [organizationId]
    );
    return res.rows;
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

  async sendTestPing(organizationId: string, id: string) {
    const res = await this.db.query(
      `SELECT * FROM webhooks WHERE organization_id = $1 AND id = $2`,
      [organizationId, id]
    );
    if (!res.rows?.length) {
      throw new NotFoundException(`Webhook with ID '${id}' not found`);
    }
    const webhook = res.rows[0];


    const payload = {
      event: 'ping',
      webhookId: webhook.id,
      timestamp: new Date().toISOString(),
      message: 'ERP Preflight webhook verification ping.',
    };

    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    const deliveryId = uuidv4();

    try {
      const resp = await safeOutboundRequest(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': `sha256=${signature}`,
          'X-Delivery-ID': deliveryId,
          'X-Event-Type': 'ping',
        },
        body: JSON.stringify(payload),
        timeoutMs: 10000,
      });
      if (resp.status < 200 || resp.status >= 300) {
        // Redirects are not followed and count as failures.
        return { success: false, error: 'Receiver did not acknowledge the ping', httpStatus: resp.status };
      }
    } catch (err: any) {
      if (err instanceof UnsafeOutboundUrlError) {
        this.logger.warn(`Ping blocked for webhook ${webhook.id}: ${err.reason}`);
        return { success: false, error: GENERIC_URL_ERROR };
      }
      this.logger.error(`Ping failed for webhook ${webhook.id}: ${err.message}`);
      return { success: false, error: 'Webhook delivery failed' };
    }

    await this.db.query(
      `UPDATE webhooks SET last_triggered_at = NOW() WHERE id = $1`,
      [webhook.id]
    );

    return {
      success: true,
      deliveredTo: webhook.url,
      signatureHeader: `sha256=${signature}`,
      payload,
    };
  }

  async dispatchEvent(organizationId: string, eventName: string, eventData: Record<string, any>) {
    const res = await this.db.query(
      `SELECT * FROM webhooks WHERE organization_id = $1 AND status = 'ACTIVE'`,
      [organizationId],
      { bypassRls: true }
    );
    const webhooks = res.rows || [];

    for (const wh of webhooks) {
      const subscribedEvents: string[] = typeof wh.events === 'string' ? JSON.parse(wh.events) : wh.events;
      if (subscribedEvents.includes(eventName) || subscribedEvents.includes('*')) {
        const payload = {
          id: uuidv4(),
          event: eventName,
          organizationId,
          timestamp: new Date().toISOString(),
          data: eventData,
        };

        const signature = crypto
          .createHmac('sha256', wh.secret)
          .update(JSON.stringify(payload))
          .digest('hex');

        try {
          const resp = await safeOutboundRequest(wh.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Hub-Signature-256': `sha256=${signature}`,
              'X-Delivery-ID': payload.id,
              'X-Event-Type': eventName,
            },
            body: JSON.stringify(payload),
            timeoutMs: 10000,
          });
          if (resp.status < 200 || resp.status >= 300) {
            this.logger.error(`Webhook ${wh.id} returned status ${resp.status}`);
          } else {
            this.logger.log(`[Webhook Dispatch] Successfully delivered ${eventName} to ${wh.url}`);
            await this.db.query(`UPDATE webhooks SET last_triggered_at = NOW() WHERE id = $1`, [wh.id]);
          }
        } catch (err: any) {
          if (err instanceof UnsafeOutboundUrlError) {
            this.logger.warn(`Skipping webhook ${wh.id} due to SSRF protection: ${err.reason}`);
          } else {
            this.logger.error(`Webhook ${wh.id} delivery failed: ${err.message}`);
          }
        }
      }
    }
  }
}
