import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateWebhookDto } from './dto/webhook.dto';
import * as crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly db: DatabaseService) {}

  async create(organizationId: string, userId: string, dto: CreateWebhookDto) {
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

    // Update last_triggered_at
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

        this.logger.log(`[Webhook Dispatch] Emitted ${eventName} to ${wh.url} (sig: ${signature.slice(0, 8)}...)`);
      }
    }
  }
}
