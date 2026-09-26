import { ConflictException, Injectable, NotFoundException, Optional, UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService } from '../database/database.service';
import { EntitlementsService, PAID_STATUSES } from '../billing/entitlements.service';
import type { SubscriptionStatus } from '@erppreflight/schemas';
import { PlatformAuditService } from './platform-audit.service';
import { TenantAccessNotifier } from './tenant-access.notifier';
import { IpAllowlistService } from './ip-allowlist.service';
import { ImpersonationService } from './impersonation.service';

export const MAX_TRIAL_EXTENSION_DAYS = 90;

const Reason = z.string().trim().min(10, 'Reason must be at least 10 characters').max(1000);

export const SuspendTenantSchema = z
  .object({
    reason: Reason,
    /** E-mail the organization owners (default true). */
    notifyOwners: z.boolean().optional().default(true),
  })
  .strict();
export const UnsuspendTenantSchema = SuspendTenantSchema;
export const ExtendTrialSchema = z
  .object({
    days: z.number().int().min(1).max(MAX_TRIAL_EXTENSION_DAYS),
    reason: Reason,
    notifyOwners: z.boolean().optional().default(true),
  })
  .strict();
export const BreakGlassReasonSchema = z.object({ reason: Reason }).strict();

export type SuspendTenantDto = z.infer<typeof SuspendTenantSchema>;
export type ExtendTrialDto = z.infer<typeof ExtendTrialSchema>;

export interface OperatorContext {
  id: string | null;
  email: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
}

function iso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Super-admin tenant actions (spec 10.7): suspend / reactivate with mandatory reason
 * and bounded trial extension. Each action updates the organization, writes the
 * platform ledger (fail-closed) and e-mails the owners; the tenant ledger entry is
 * written by the @Audited controller route (security: fail-closed).
 */
@Injectable()
export class TenantAdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly platformAudit: PlatformAuditService,
    private readonly notifier: TenantAccessNotifier,
    private readonly ipAllowlist: IpAllowlistService,
    private readonly impersonation: ImpersonationService,
    @Optional() private readonly entitlements?: EntitlementsService
  ) {}

  private async organization(organizationId: string) {
    const res = await this.db.query(
      `SELECT id, name, status, suspended_at, suspended_by, suspension_reason, plan_tier, subscription_status,
              trial_tier, trial_started_at, trial_ends_at, trial_original_ends_at, trial_extended_days
         FROM organizations WHERE id = $1`,
      [organizationId],
      { bypassRls: true }
    );
    const row = res.rows?.[0];
    if (!row) throw new NotFoundException(`Organization ${organizationId} not found`);
    return row;
  }

  /** Access overview for the admin console: status, trial bounds, allowlist, members, impersonations. */
  async accessOverview(organizationId: string) {
    // Plan state first: it materialises a not-yet-anchored trial, so the overview below
    // shows the real trial window (and whether it can be extended).
    const planState = this.entitlements ? await this.entitlements.getPlanState(organizationId) : null;
    const org = await this.organization(organizationId);
    const [members, allowlist, sessions] = await Promise.all([
      this.db.query(
        `SELECT u.id, u.email, u.full_name AS "fullName", u.status, u.system_role AS "systemRole", m.role
           FROM organization_members m JOIN users u ON u.id = m.user_id
          WHERE m.organization_id = $1 ORDER BY m.created_at ASC`,
        [organizationId],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT cidr::text AS cidr, label, created_at FROM organization_ip_allowlist WHERE organization_id = $1 ORDER BY created_at`,
        [organizationId],
        { tenantId: organizationId }
      ),
      this.impersonation.list({ organizationId, limit: 20 }),
    ]);
    const originalEnds = iso(org.trial_original_ends_at) ?? iso(org.trial_ends_at);
    return {
      organization: {
        id: org.id,
        name: org.name,
        status: org.status,
        suspendedAt: iso(org.suspended_at),
        suspensionReason: org.suspension_reason ?? null,
        planTier: org.plan_tier,
        subscriptionStatus: org.subscription_status,
      },
      trial: {
        tier: org.trial_tier ?? null,
        startedAt: iso(org.trial_started_at),
        endsAt: iso(org.trial_ends_at),
        originalEndsAt: originalEnds,
        extendedDays: Number(org.trial_extended_days ?? 0),
        maxEndsAt: originalEnds ? new Date(new Date(originalEnds).getTime() + MAX_TRIAL_EXTENSION_DAYS * 86_400_000).toISOString() : null,
        active: planState?.trial.active ?? false,
        effectiveTier: planState?.effectiveTier ?? null,
        extendable: this.trialExtendable(org, planState?.subscriptionStatus ?? null),
      },
      ipAllowlist: (allowlist.rows ?? []).map((r: any) => ({ cidr: r.cidr, label: r.label ?? null, createdAt: iso(r.created_at) })),
      members: (members.rows ?? []).map((m: any) => ({
        ...m,
        impersonable: m.status === 'ACTIVE' && (m.systemRole ?? 'USER') === 'USER',
      })),
      impersonations: sessions,
    };
  }

  private trialExtendable(org: any, subscriptionStatus: SubscriptionStatus | null): boolean {
    const status = (subscriptionStatus ?? org.subscription_status ?? 'NONE') as SubscriptionStatus;
    return !!org.trial_tier && !!org.trial_ends_at && !PAID_STATUSES.has(status);
  }

  async suspend(organizationId: string, dto: SuspendTenantDto, operator: OperatorContext) {
    const org = await this.organization(organizationId);
    if (org.status === 'SUSPENDED') {
      throw new ConflictException({ code: 'TENANT_ALREADY_SUSPENDED', message: 'The organization is already suspended' });
    }
    const res = await this.db.query(
      `UPDATE organizations
          SET status = 'SUSPENDED', suspended_at = NOW(), suspended_by = $2, suspension_reason = $3, updated_at = NOW()
        WHERE id = $1 AND status <> 'SUSPENDED'
        RETURNING id, name, status, suspended_at, suspension_reason`,
      [organizationId, operator.id, dto.reason],
      { bypassRls: true }
    );
    const row = res.rows?.[0];
    if (!row) throw new ConflictException({ code: 'TENANT_ALREADY_SUSPENDED', message: 'The organization is already suspended' });
    // Active impersonations of a suspended tenant keep working (operator access, read-only).
    await this.platformAudit.record({
      organizationId,
      actorId: operator.id,
      actorEmail: operator.email,
      action: 'tenant.suspended',
      targetType: 'ORGANIZATION',
      targetId: organizationId,
      payload: { reason: dto.reason, previousStatus: org.status, notifyOwners: dto.notifyOwners },
      clientIp: operator.clientIp,
      userAgent: operator.userAgent,
    });
    const suspendedAt = iso(row.suspended_at)!;
    const ownersNotified = dto.notifyOwners ? await this.notifier.notifySuspended({ id: row.id, name: row.name }, dto.reason, suspendedAt) : 0;
    return { organizationId, status: row.status, suspendedAt, suspensionReason: row.suspension_reason, ownersNotified };
  }

  async unsuspend(organizationId: string, dto: SuspendTenantDto, operator: OperatorContext) {
    const org = await this.organization(organizationId);
    if (org.status !== 'SUSPENDED') {
      throw new ConflictException({ code: 'TENANT_NOT_SUSPENDED', message: 'The organization is not suspended' });
    }
    const res = await this.db.query(
      `UPDATE organizations
          SET status = 'ACTIVE', suspended_at = NULL, suspended_by = NULL, suspension_reason = NULL, updated_at = NOW()
        WHERE id = $1 AND status = 'SUSPENDED'
        RETURNING id, name, status, updated_at`,
      [organizationId],
      { bypassRls: true }
    );
    const row = res.rows?.[0];
    if (!row) throw new ConflictException({ code: 'TENANT_NOT_SUSPENDED', message: 'The organization is not suspended' });
    await this.platformAudit.record({
      organizationId,
      actorId: operator.id,
      actorEmail: operator.email,
      action: 'tenant.reactivated',
      targetType: 'ORGANIZATION',
      targetId: organizationId,
      payload: {
        reason: dto.reason,
        suspendedAt: iso(org.suspended_at),
        suspensionReason: org.suspension_reason ?? null,
        notifyOwners: dto.notifyOwners,
      },
      clientIp: operator.clientIp,
      userAgent: operator.userAgent,
    });
    const reactivatedAt = iso(row.updated_at)!;
    const ownersNotified = dto.notifyOwners ? await this.notifier.notifyReactivated({ id: row.id, name: row.name }, dto.reason, reactivatedAt) : 0;
    return { organizationId, status: row.status, reactivatedAt, previousSuspendedAt: iso(org.suspended_at), ownersNotified };
  }

  /**
   * Extends the trial by `days` from max(current end, now). The cumulative extension
   * is bounded: the new end may lie at most 90 days after the ORIGINAL trial end
   * (organizations.trial_original_ends_at, set on the first extension). Entitlements
   * are computed live from these columns, so the new effective tier applies at once.
   */
  async extendTrial(organizationId: string, dto: ExtendTrialDto, operator: OperatorContext) {
    // Materialises a not-yet-started trial (EntitlementsService anchors it at creation).
    const state = this.entitlements ? await this.entitlements.getPlanState(organizationId) : null;
    const org = await this.organization(organizationId);
    if (!this.trialExtendable(org, state?.subscriptionStatus ?? null)) {
      throw new ConflictException({
        code: 'TRIAL_NOT_APPLICABLE',
        message: PAID_STATUSES.has((state?.subscriptionStatus ?? org.subscription_status) as SubscriptionStatus)
          ? 'The organization has a paid subscription; a trial extension does not apply.'
          : 'The organization has no trial that could be extended.',
      });
    }
    const res = await this.db.query(
      `WITH cur AS (
         SELECT id, trial_ends_at,
                COALESCE(trial_original_ends_at, trial_ends_at) AS original_end,
                GREATEST(trial_ends_at, NOW()) + make_interval(days => $2::int) AS new_end
           FROM organizations WHERE id = $1 FOR UPDATE
       )
       UPDATE organizations o
          SET trial_original_ends_at = cur.original_end,
              trial_ends_at = cur.new_end,
              trial_extended_days = LEAST(90, GREATEST(0, CEIL(EXTRACT(EPOCH FROM (cur.new_end - cur.original_end)) / 86400.0)))::int,
              trial_expired_at = NULL,
              updated_at = NOW()
         FROM cur
        WHERE o.id = cur.id AND cur.new_end <= cur.original_end + INTERVAL '90 days'
        RETURNING o.id, o.name, o.trial_tier, cur.trial_ends_at AS previous_end, o.trial_ends_at,
                  o.trial_original_ends_at, o.trial_extended_days`,
      [organizationId, dto.days],
      { bypassRls: true }
    );
    const row = res.rows?.[0];
    if (!row) {
      const originalEnd = iso(org.trial_original_ends_at) ?? iso(org.trial_ends_at);
      const maxEndsAt = originalEnd ? new Date(new Date(originalEnd).getTime() + MAX_TRIAL_EXTENSION_DAYS * 86_400_000).toISOString() : null;
      throw new UnprocessableEntityException({
        code: 'TRIAL_EXTENSION_LIMIT',
        message: `A trial can be extended by at most ${MAX_TRIAL_EXTENSION_DAYS} days beyond its original end${
          maxEndsAt ? ` (${maxEndsAt.slice(0, 10)})` : ''
        }.`,
      });
    }
    const after = this.entitlements ? await this.entitlements.getPlanState(organizationId) : null;
    await this.platformAudit.record({
      organizationId,
      actorId: operator.id,
      actorEmail: operator.email,
      action: 'tenant.trial_extended',
      targetType: 'ORGANIZATION',
      targetId: organizationId,
      payload: {
        days: dto.days,
        reason: dto.reason,
        previousEndsAt: iso(row.previous_end),
        endsAt: iso(row.trial_ends_at),
        originalEndsAt: iso(row.trial_original_ends_at),
        extendedDaysTotal: Number(row.trial_extended_days),
        effectiveTier: after?.effectiveTier ?? null,
      },
      clientIp: operator.clientIp,
      userAgent: operator.userAgent,
    });
    const ownersNotified = dto.notifyOwners
      ? await this.notifier.notifyTrialExtended({ id: row.id, name: row.name }, {
          days: dto.days,
          trialTier: String(row.trial_tier ?? ''),
          endsAt: iso(row.trial_ends_at)!,
        })
      : 0;
    return {
      organizationId,
      days: dto.days,
      previousEndsAt: iso(row.previous_end),
      trialEndsAt: iso(row.trial_ends_at),
      trialOriginalEndsAt: iso(row.trial_original_ends_at),
      trialExtendedDays: Number(row.trial_extended_days),
      maxEndsAt: new Date(new Date(iso(row.trial_original_ends_at)!).getTime() + MAX_TRIAL_EXTENSION_DAYS * 86_400_000).toISOString(),
      trial: after?.trial ?? null,
      effectiveTier: after?.effectiveTier ?? null,
      ownersNotified,
    };
  }

  /** Break-glass removal of a tenant's IP allowlist (customer locked out). */
  async clearIpAllowlist(organizationId: string, reason: string, operator: OperatorContext) {
    await this.organization(organizationId);
    const { removed } = await this.ipAllowlist.clear(organizationId);
    await this.platformAudit.record({
      organizationId,
      actorId: operator.id,
      actorEmail: operator.email,
      action: 'tenant.ip_allowlist.cleared',
      targetType: 'ORGANIZATION',
      targetId: organizationId,
      payload: { reason, removed },
      clientIp: operator.clientIp,
      userAgent: operator.userAgent,
    });
    return { organizationId, removed };
  }
}
