import { Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { DomainEventOutbox } from '@erppreflight/schemas';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../outbox/outbox.service';
import { MAIL_SENDER, MailSender } from './mail-sender.interface';
import {
  EMAIL_DEFAULT,
  NOTIFICATION_EVENT_TYPES,
  NotificationEventType,
  RECIPIENT_POLICY,
  RenderedNotification,
  renderNotification,
} from './notification-renderer';

export interface NotificationListQuery {
  status: 'all' | 'unread';
  limit: number;
  before?: string;
}

/**
 * Notification engine (Part 05 §5.10, Part 14.33).
 *
 * Channels:
 *  - in-app: rows in `notifications` (tenant + user scoped, RLS), inbox API;
 *  - webhook: the existing WebhooksService already subscribes to every outbox
 *    event and delivers it HMAC-SHA256 signed — nothing is duplicated here;
 *  - e-mail: optional MailSender (token MAIL_SENDER) resolved lazily; no-op when absent.
 *
 * Source of events is the transactional outbox, so a notification is created
 * iff the business transaction committed. Delivery is idempotent per
 * (tenant, user, dedupe key) — outbox retries never duplicate inbox entries.
 */
@Injectable()
export class NotificationsService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsService.name);
  private mailSender: MailSender | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
    private readonly moduleRef: ModuleRef
  ) {}

  onModuleInit(): void {
    for (const eventType of NOTIFICATION_EVENT_TYPES) {
      this.outbox.subscribe(eventType, (event) => this.handleEvent(event));
    }
  }

  onApplicationBootstrap(): void {
    try {
      this.mailSender = this.moduleRef.get<MailSender>(MAIL_SENDER, { strict: false }) ?? null;
    } catch {
      this.mailSender = null;
    }
    this.logger.log(
      `Notification channels: in-app, webhook (signed, via WebhooksService), e-mail ${
        this.mailSender ? 'enabled' : 'not configured (no MAIL_SENDER provider) — skipped'
      }`
    );
  }

  /** For tests and for mail modules that register late. */
  setMailSender(sender: MailSender | null): void {
    this.mailSender = sender;
  }

  channels() {
    return { inApp: true, webhook: true, email: this.mailSender !== null };
  }

  async handleEvent(event: DomainEventOutbox): Promise<void> {
    const rendered = renderNotification(event.eventType, event.aggregateId, event.payload ?? {});
    if (!rendered) return;
    const eventType = event.eventType as NotificationEventType;
    const orgId = event.organizationId;

    const recipients = await this.resolveRecipients(orgId, eventType, rendered);
    if (recipients.length === 0) return;

    const prefs = await this.db.query(
      `SELECT user_id, channel, enabled FROM notification_preferences
        WHERE organization_id = $1 AND event_type = $2`,
      [orgId, eventType],
      { tenantId: orgId }
    );
    const pref = (userId: string, channel: 'IN_APP' | 'EMAIL', dflt: boolean) => {
      const row = prefs.rows.find((p: any) => p.user_id === userId && p.channel === channel);
      return row ? Boolean(row.enabled) : dflt;
    };

    // Analysis events are deduplicated per analysis (BullMQ retries); others per outbox event.
    const dedupeKey =
      rendered.resourceType === 'ANALYSIS' ? `${eventType}:${rendered.resourceId ?? event.aggregateId}` : `${eventType}:${event.id}`;

    const inApp = recipients.filter((r) => pref(r.userId, 'IN_APP', true));
    const inserted = new Set<string>();
    if (inApp.length > 0) {
      await this.db.withTenantTransaction(orgId, async (client) => {
        for (const r of inApp) {
          const res = await client.query(
            `INSERT INTO notifications (organization_id, user_id, event_type, severity, title, body, link, project_id,
                                        engine, resource_type, resource_id, group_key, dedupe_key, payload)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             ON CONFLICT (organization_id, user_id, dedupe_key) DO NOTHING
             RETURNING id`,
            [
              orgId,
              r.userId,
              eventType,
              rendered.severity,
              rendered.title,
              rendered.body,
              rendered.link,
              rendered.projectId,
              rendered.engine,
              rendered.resourceType,
              rendered.resourceId,
              rendered.groupKey,
              dedupeKey,
              JSON.stringify({ outboxEventId: event.id, ...this.compactPayload(event.payload) }),
            ]
          );
          if (res.rows[0]) inserted.add(r.userId);
        }
      });
    }

    if (this.mailSender) {
      const emailDefault = EMAIL_DEFAULT[eventType] ?? false;
      for (const r of recipients) {
        // Only e-mail when this delivery is new (in-app row inserted, or in-app muted), never on retries.
        const isNew = inserted.has(r.userId) || !pref(r.userId, 'IN_APP', true);
        if (!isNew || !pref(r.userId, 'EMAIL', emailDefault) || !r.email) continue;
        try {
          await this.mailSender.send({
            to: r.email,
            subject: `[ERP Preflight] ${rendered.title}`,
            text: `${rendered.title}\n\n${rendered.body}\n\nSeverity: ${rendered.severity}${
              rendered.link ? `\nOpen: ${rendered.link}` : ''
            }\n\nManage notification preferences in ERP Preflight → Notifications.`,
            tags: { eventType, severity: rendered.severity },
          });
        } catch (err: any) {
          this.logger.warn(`E-mail notification to user ${r.userId} failed: ${err?.message ?? err}`);
        }
      }
    }
  }

  private compactPayload(payload: Record<string, any> | undefined): Record<string, unknown> {
    if (!payload) return {};
    const { changes, ...rest } = payload;
    return Array.isArray(changes) ? { ...rest, changes: changes.slice(0, 50) } : rest;
  }

  private async resolveRecipients(
    orgId: string,
    eventType: NotificationEventType,
    rendered: RenderedNotification
  ): Promise<Array<{ userId: string; email: string | null }>> {
    const members = await this.db.query(
      `SELECT m.user_id, m.role, u.email FROM organization_members m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = $1 AND u.status = 'ACTIVE'`,
      [orgId],
      { bypassRls: true }
    );
    const all = members.rows as Array<{ user_id: string; role: string; email: string }>;
    const policy = RECIPIENT_POLICY[eventType] ?? 'ALL_MEMBERS';
    let chosen: typeof all;
    if (policy === 'ALL_MEMBERS') {
      chosen = all;
    } else {
      const actor = rendered.actorUserId;
      chosen = all.filter(
        (m) => m.user_id === actor || (policy === 'TRIGGERING_USER_AND_OWNERS' && m.role === 'ORGANIZATION_OWNER')
      );
      // Unknown or departed actor: fall back to the organization owners, never to nobody.
      if (chosen.length === 0) chosen = all.filter((m) => m.role === 'ORGANIZATION_OWNER');
    }
    return chosen.map((m) => ({ userId: m.user_id, email: m.email ?? null }));
  }

  // ---------------------------------------------------------------------------
  // Inbox API
  // ---------------------------------------------------------------------------
  async list(orgId: string, userId: string, q: NotificationListQuery) {
    const res = await this.db.query(
      `SELECT id, event_type, severity, title, body, link, project_id, engine, resource_type, resource_id, group_key,
              read_at, created_at
         FROM notifications
        WHERE organization_id = $1 AND user_id = $2
          AND ($3 = 'all' OR read_at IS NULL)
          AND ($4::timestamptz IS NULL OR created_at < $4::timestamptz)
        ORDER BY created_at DESC, id DESC
        LIMIT $5`,
      [orgId, userId, q.status, q.before ?? null, q.limit + 1]
    );
    const rows = res.rows.slice(0, q.limit);
    const unread = await this.unreadCount(orgId, userId);
    return {
      items: rows.map((r: any) => ({
        id: r.id,
        eventType: r.event_type,
        severity: r.severity,
        title: r.title,
        body: r.body,
        link: r.link,
        projectId: r.project_id,
        engine: r.engine,
        resourceType: r.resource_type,
        resourceId: r.resource_id,
        groupKey: r.group_key,
        readAt: r.read_at,
        createdAt: r.created_at,
      })),
      nextBefore: res.rows.length > q.limit ? new Date(rows[rows.length - 1].created_at).toISOString() : null,
      unreadCount: unread.unreadCount,
    };
  }

  async unreadCount(orgId: string, userId: string) {
    const res = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM notifications WHERE organization_id = $1 AND user_id = $2 AND read_at IS NULL`,
      [orgId, userId]
    );
    return { unreadCount: res.rows[0]?.n ?? 0 };
  }

  async setRead(orgId: string, userId: string, id: string, read: boolean) {
    const res = await this.db.query(
      `UPDATE notifications SET read_at = CASE WHEN $4 THEN COALESCE(read_at, NOW()) ELSE NULL END
        WHERE organization_id = $1 AND user_id = $2 AND id = $3 RETURNING id, read_at`,
      [orgId, userId, id, read]
    );
    if (!res.rows[0]) throw new NotFoundException('Notification not found');
    return { id, readAt: res.rows[0].read_at };
  }

  async markAllRead(orgId: string, userId: string) {
    const res = await this.db.query(
      `UPDATE notifications SET read_at = NOW() WHERE organization_id = $1 AND user_id = $2 AND read_at IS NULL`,
      [orgId, userId]
    );
    return { updated: res.rowCount ?? 0 };
  }

  async preferences(orgId: string, userId: string) {
    const res = await this.db.query(
      `SELECT event_type, channel, enabled FROM notification_preferences WHERE organization_id = $1 AND user_id = $2`,
      [orgId, userId]
    );
    return NOTIFICATION_EVENT_TYPES.map((eventType) => {
      const find = (channel: string) => res.rows.find((r: any) => r.event_type === eventType && r.channel === channel);
      return {
        eventType,
        inApp: find('IN_APP')?.enabled ?? true,
        email: find('EMAIL')?.enabled ?? EMAIL_DEFAULT[eventType],
      };
    });
  }

  async updatePreferences(
    orgId: string,
    userId: string,
    items: Array<{ eventType: NotificationEventType; inApp?: boolean; email?: boolean }>
  ) {
    await this.db.withTenantTransaction(orgId, async (client) => {
      for (const item of items) {
        for (const [channel, value] of [
          ['IN_APP', item.inApp],
          ['EMAIL', item.email],
        ] as const) {
          if (value === undefined) continue;
          await client.query(
            `INSERT INTO notification_preferences (organization_id, user_id, event_type, channel, enabled)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (organization_id, user_id, event_type, channel)
             DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
            [orgId, userId, item.eventType, channel, value]
          );
        }
      }
    });
    return this.preferences(orgId, userId);
  }
}
