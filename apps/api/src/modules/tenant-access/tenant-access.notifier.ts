import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { MailService } from '../mail/mail.service';
import { renderTenantReactivated, renderTenantSuspended, renderTrialExtended } from '../mail/operations.templates';

function utcStamp(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function longDate(iso: string, locale: 'de-DE' | 'en-GB'): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(iso)) + ' UTC';
  } catch {
    return `${utcStamp(iso)} UTC`;
  }
}

/**
 * E-mails organization owners about operator actions on their tenant (spec 10.7).
 * Delivery is asynchronous and never fails the admin action; failures are logged.
 */
@Injectable()
export class TenantAccessNotifier {
  private readonly logger = new Logger(TenantAccessNotifier.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @Optional() private readonly mail?: MailService
  ) {}

  supportInbox(): string | null {
    const v = String(this.config.get<string>('SUPPORT_INBOX_EMAIL') ?? process.env.SUPPORT_INBOX_EMAIL ?? '').trim();
    return v || null;
  }

  async ownerEmails(organizationId: string): Promise<string[]> {
    const res = await this.db.query(
      `SELECT DISTINCT u.email FROM organization_members m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = $1 AND m.role = 'ORGANIZATION_OWNER' AND u.status = 'ACTIVE'
        ORDER BY u.email`,
      [organizationId],
      { bypassRls: true }
    );
    return (res.rows ?? []).map((r: any) => String(r.email)).filter(Boolean);
  }

  private async sendToOwners(organizationId: string, render: () => ReturnType<typeof renderTenantSuspended>): Promise<number> {
    if (!this.mail) {
      this.logger.warn('Mail service unavailable: owner notification skipped');
      return 0;
    }
    let owners: string[] = [];
    try {
      owners = await this.ownerEmails(organizationId);
    } catch (err: any) {
      this.logger.error(`Could not resolve owners of ${organizationId}: ${err?.message ?? err}`);
      return 0;
    }
    const mail = render();
    for (const to of owners) this.mail.sendInBackground(to, mail);
    return owners.length;
  }

  notifySuspended(org: { id: string; name: string }, reason: string, when: string): Promise<number> {
    return this.sendToOwners(org.id, () =>
      renderTenantSuspended({
        organizationName: org.name,
        reason,
        when: utcStamp(when),
        supportEmail: this.supportInbox(),
        exportUrl: this.mail!.link('/settings/account'),
      })
    );
  }

  notifyReactivated(org: { id: string; name: string }, reason: string, when: string): Promise<number> {
    return this.sendToOwners(org.id, () =>
      renderTenantReactivated({ organizationName: org.name, reason, when: utcStamp(when), appUrl: this.mail!.link('/dashboard') })
    );
  }

  notifyTrialExtended(org: { id: string; name: string }, p: { days: number; trialTier: string; endsAt: string }): Promise<number> {
    return this.sendToOwners(org.id, () =>
      renderTrialExtended({
        organizationName: org.name,
        days: p.days,
        trialTier: p.trialTier,
        endsAtDe: longDate(p.endsAt, 'de-DE'),
        endsAtEn: longDate(p.endsAt, 'en-GB'),
        billingUrl: this.mail!.link('/settings/billing'),
      })
    );
  }
}
