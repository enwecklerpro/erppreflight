import { Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleInit, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { DomainEventOutbox } from '@erppreflight/schemas';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../outbox/outbox.service';
import { MAIL_SENDER, MailSender } from './mail-sender.interface';
import {
  EMAIL_DEFAULT,
  NOTIFICATION_EVENT_TYPES,
  NotificationEventType,
  NotificationLocale,
  RECIPIENT_POLICY,
  RenderedNotification,
  renderNotification,
  severityLabel,
  toNotificationLocale,
} from './notification-renderer';
import { MailService } from '../mail/mail.service';
import { renderFindingAssignedMail, renderNotificationMail } from './notification-mail.templates';

interface Recipient {
  userId: string;
  email: string | null;
  name: string | null;
  locale: NotificationLocale;
}

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
 *  - e-mail: the platform MailService (SMTP / HTTP provider / dev outbox) with EN/DE
 *    templates per recipient (users.preferred_locale); a MAIL_SENDER provider, when
 *    registered, overrides it (custom delivery, tests).
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
    private readonly moduleRef: ModuleRef,
    @Optional() private readonly mail?: MailService
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
        this.mailSender ? 'MAIL_SENDER provider' : this.mail ? `platform mail (${this.mail.transportKind})` : 'not configured — skipped'
      }`
    );
  }

  /** For tests and for mail modules that register late. */
  setMailSender(sender: MailSender | null): void {
    this.mailSender = sender;
  }

  channels() {
    return { inApp: true, webhook: true, email: this.mailSender !== null || !!this.mail };
  }

  async handleEvent(event: DomainEventOutbox): Promise<void> {
    const rendered = renderNotification(event.eventType, event.aggregateId, event.payload ?? {});
    if (!rendered) return;
    const eventType = event.eventType as NotificationEventType;
    const orgId = event.organizationId;

    const recipients = await this.resolveRecipients(orgId, eventType, rendered);
    if (recipients.length === 0) return;
    // Texts in the recipient's language (falls back to English for events without a DE text).
    const localized = new Map<NotificationLocale, RenderedNotification>([['en', rendered]]);
    const forLocale = (locale: NotificationLocale): RenderedNotification => {
      if (!localized.has(locale)) {
        localized.set(locale, renderNotification(event.eventType, event.aggregateId, event.payload ?? {}, locale) ?? rendered);
      }
      return localized.get(locale)!;
    };

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
          const n = forLocale(r.locale);
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
              n.severity,
              n.title,
              n.body,
              n.link,
              n.projectId,
              n.engine,
              n.resourceType,
              n.resourceId,
              n.groupKey,
              dedupeKey,
              JSON.stringify({ outboxEventId: event.id, ...this.compactPayload(event.payload) }),
            ]
          );
          if (res.rows[0]) inserted.add(r.userId);
        }
      });
    }

    if (!this.mailSender && !this.mail) return;
    const emailDefault = EMAIL_DEFAULT[eventType] ?? false;
    for (const r of recipients) {
      // Only e-mail when this delivery is new (in-app row inserted, or in-app muted), never on retries.
      const isNew = inserted.has(r.userId) || !pref(r.userId, 'IN_APP', true);
      if (!isNew || !pref(r.userId, 'EMAIL', emailDefault) || !r.email) continue;
      try {
        await this.sendEmail(eventType, r, forLocale(r.locale));
      } catch (err: any) {
        this.logger.warn(`E-mail notification to user ${r.userId} failed: ${err?.message ?? err}`);
      }
    }
  }

  private async sendEmail(eventType: NotificationEventType, r: Recipient, n: RenderedNotification): Promise<void> {
    if (this.mailSender) {
      await this.mailSender.send({
        to: r.email!,
        subject: `[ERP Preflight] ${n.title}`,
        text: `${n.title}\n\n${n.body}\n\nSeverity: ${n.severity}${
          n.link ? `\nOpen: ${n.link}` : ''
        }\n\nManage notification preferences in ERP Preflight → Notifications.`,
        tags: { eventType, severity: n.severity },
      });
      return;
    }
    const url = n.link ? this.mail!.link(n.link) : null;
    const mail =
      eventType === 'finding.assigned'
        ? renderFindingAssignedMail(r.locale, n, url, r.name)
        : renderNotificationMail(r.locale, n, severityLabel(n.severity, r.locale), url);
    await this.mail!.send(r.email!, mail);
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
  ): Promise<Recipient[]> {
    const members = await this.db.query(
      `SELECT m.user_id, m.role, u.email, u.full_name, u.preferred_locale
         FROM organization_members m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = $1 AND u.status = 'ACTIVE'`,
      [orgId],
      { bypassRls: true }
    );
    const all = members.rows as Array<{
      user_id: string;
      role: string;
      email: string;
      full_name: string | null;
      preferred_locale: string | null;
    }>;
    const policy = RECIPIENT_POLICY[eventType] ?? 'ALL_MEMBERS';
    let chosen: typeof all;
    if (policy === 'ALL_MEMBERS') {
      chosen = all;
    } else if (policy === 'RECIPIENT_USER') {
      // Exactly the addressed member of THIS organization; nobody for self-actions.
      const target = rendered.recipientUserId ?? null;
      chosen = target && target !== rendered.actorUserId ? all.filter((m) => m.user_id === target) : [];
    } else {
      const actor = rendered.actorUserId;
      chosen = all.filter(
        (m) => m.user_id === actor || (policy === 'TRIGGERING_USER_AND_OWNERS' && m.role === 'ORGANIZATION_OWNER')
      );
      // Unknown or departed actor: fall back to the organization owners, never to nobody.
      if (chosen.length === 0) chosen = all.filter((m) => m.role === 'ORGANIZATION_OWNER');
    }
    return chosen.map((m) => ({
      userId: m.user_id,
      email: m.email ?? null,
      name: m.full_name ?? null,
      locale: toNotificationLocale(m.preferred_locale),
    }));
  }

  /** Language of the caller's notification texts (in-app + e-mail); NULL = English. */
  async emailLocale(userId: string): Promise<{ locale: NotificationLocale; explicit: boolean }> {
    const res = await this.db.query(`SELECT preferred_locale FROM users WHERE id = $1`, [userId], { bypassRls: true });
    const raw = res.rows[0]?.preferred_locale ?? null;
    return { locale: toNotificationLocale(raw), explicit: raw !== null };
  }

  async setEmailLocale(userId: string, locale: NotificationLocale): Promise<{ locale: NotificationLocale; explicit: boolean }> {
    await this.db.query(`UPDATE users SET preferred_locale = $2 WHERE id = $1`, [userId, locale], { bypassRls: true });
    return { locale, explicit: true };
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
