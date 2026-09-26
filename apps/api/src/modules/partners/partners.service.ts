import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { IntegrationAuditService } from '../connectors/integration-audit.service';
import { parseBody } from '../connectors/zod-body';

/**
 * Partner mode (C §61): a consulting partner organization works in customer
 * organizations ONLY through explicit, customer-granted, time-limited and audited
 * delegated access.
 *
 * - Only the customer (grantor) creates and revokes grants; the partner can read
 *   grants addressed to it (second RLS policy on partner_access_grants).
 * - Delegated access is resolved inside the regular membership-verified tenancy
 *   path (TenancyMiddleware → resolveDelegatedRole): the caller must be an
 *   ACTIVE member of the partner organization AND an ACTIVE, unexpired grant
 *   must exist. No separate bypass exists; RLS still scopes every query to the
 *   customer tenant.
 * - Grant roles map to existing tenant roles so RolesGuard keeps working:
 *   VIEWER → VIEWER, ANALYST → MIGRATION_CONSULTANT, PROJECT_ADMIN → LEAD_ARCHITECT.
 *   Delegated users can never become ORGANIZATION_OWNER / SECURITY_ADMIN.
 */

export const DELEGATED_ROLE_MAP: Record<string, string> = {
  VIEWER: 'VIEWER',
  ANALYST: 'MIGRATION_CONSULTANT',
  PROJECT_ADMIN: 'LEAD_ARCHITECT',
};

export const CreateGrantSchema = z
  .object({
    partnerOrganizationId: z.string().uuid().optional(),
    partnerOrganizationSlug: z.string().trim().min(1).max(255).optional(),
    accessRole: z.enum(['VIEWER', 'ANALYST', 'PROJECT_ADMIN']).default('VIEWER'),
    expiresInDays: z.coerce.number().int().min(1).max(365).default(30),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict()
  .refine((d) => Boolean(d.partnerOrganizationId || d.partnerOrganizationSlug), {
    message: 'partnerOrganizationId or partnerOrganizationSlug is required',
  });

export interface DelegatedAccess {
  grantId: string;
  partnerOrganizationId: string;
  accessRole: string;
  tenantRole: string;
  expiresAt: Date;
}

/**
 * Resolves delegated access of `userId` to `customerOrganizationId`, or null.
 * Called by TenancyMiddleware when the user is not a direct member.
 */
export async function resolveDelegatedRole(db: DatabaseService, customerOrganizationId: string, userId: string): Promise<DelegatedAccess | null> {
  const res = await db.query(
    `SELECT g.id, g.partner_organization_id, g.access_role, g.expires_at
       FROM partner_access_grants g
       JOIN organization_members pm ON pm.organization_id = g.partner_organization_id AND pm.user_id = $2
       JOIN organizations po ON po.id = g.partner_organization_id AND po.status = 'ACTIVE'
      WHERE g.organization_id = $1 AND g.status = 'ACTIVE' AND g.expires_at > NOW()
      ORDER BY CASE g.access_role WHEN 'PROJECT_ADMIN' THEN 1 WHEN 'ANALYST' THEN 2 ELSE 3 END
      LIMIT 1`,
    [customerOrganizationId, userId],
    { bypassRls: true }
  );
  const r = res?.rows?.[0];
  if (!r) return null;
  return {
    grantId: r.id,
    partnerOrganizationId: r.partner_organization_id,
    accessRole: r.access_role,
    tenantRole: DELEGATED_ROLE_MAP[r.access_role] ?? 'VIEWER',
    expiresAt: new Date(r.expires_at),
  };
}

@Injectable()
export class PartnersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: IntegrationAuditService
  ) {}

  private mapGrant(r: any) {
    const expired = new Date(r.expires_at) <= new Date();
    return {
      id: r.id,
      customerOrganizationId: r.organization_id,
      customerOrganizationName: r.customer_name,
      partnerOrganizationId: r.partner_organization_id,
      partnerOrganizationName: r.partner_name,
      accessRole: r.access_role,
      effectiveTenantRole: DELEGATED_ROLE_MAP[r.access_role],
      status: r.status === 'ACTIVE' && expired ? 'EXPIRED' : r.status,
      reason: r.reason,
      expiresAt: r.expires_at,
      grantedBy: r.granted_by,
      revokedBy: r.revoked_by,
      revokedAt: r.revoked_at,
      lastUsedAt: r.last_used_at,
      createdAt: r.created_at,
    };
  }

  private select(where: string) {
    return `SELECT g.*, c.name AS customer_name, p.name AS partner_name
              FROM partner_access_grants g
              JOIN organizations c ON c.id = g.organization_id
              JOIN organizations p ON p.id = g.partner_organization_id
             WHERE ${where}`;
  }

  /** Customer side: grants this organization has given. */
  async listGiven(organizationId: string) {
    const res = await this.db.query(this.select('g.organization_id = $1') + ' ORDER BY g.created_at DESC', [organizationId], { tenantId: organizationId });
    return res.rows.map((r: any) => this.mapGrant(r));
  }

  /** Partner side: customer organizations that granted access to this organization. */
  async listClients(organizationId: string) {
    const res = await this.db.query(this.select('g.partner_organization_id = $1') + ' ORDER BY c.name', [organizationId], { tenantId: organizationId });
    return res.rows.map((r: any) => this.mapGrant(r));
  }

  async grant(organizationId: string, actorId: string, body: unknown) {
    const dto = parseBody(CreateGrantSchema, body);
    const partner = await this.db.query(
      dto.partnerOrganizationId
        ? `SELECT id, name, status FROM organizations WHERE id = $1`
        : `SELECT id, name, status FROM organizations WHERE slug = $1`,
      [dto.partnerOrganizationId ?? dto.partnerOrganizationSlug],
      { bypassRls: true }
    );
    const p = partner.rows[0];
    if (!p || p.status !== 'ACTIVE') throw new NotFoundException('Partner organization not found');
    if (p.id === organizationId) throw new BadRequestException('An organization cannot grant access to itself');
    const expiresAt = new Date(Date.now() + dto.expiresInDays * 24 * 3600 * 1000);
    try {
      const res = await this.db.query(
        `INSERT INTO partner_access_grants (id, organization_id, partner_organization_id, access_role, reason, expires_at, granted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [uuidv4(), organizationId, p.id, dto.accessRole, dto.reason, expiresAt, actorId],
        { tenantId: organizationId }
      );
      await this.audit.record({
        organizationId,
        action: 'partner.access_granted',
        resourceType: 'ORGANIZATION',
        resourceId: p.id,
        actorId,
        payload: { grantId: res.rows[0].id, partnerOrganizationId: p.id, partnerName: p.name, accessRole: dto.accessRole, expiresAt: expiresAt.toISOString(), reason: dto.reason },
      });
      await this.audit.record({
        organizationId: p.id,
        action: 'partner.access_received',
        resourceType: 'ORGANIZATION',
        resourceId: organizationId,
        payload: { grantId: res.rows[0].id, customerOrganizationId: organizationId, accessRole: dto.accessRole, expiresAt: expiresAt.toISOString() },
      });
      const full = await this.db.query(this.select('g.organization_id = $1 AND g.id = $2'), [organizationId, res.rows[0].id], { tenantId: organizationId });
      return this.mapGrant(full.rows[0]);
    } catch (err: any) {
      if (err?.code === '23505') throw new ConflictException('An active grant for this partner already exists; revoke it first');
      throw err;
    }
  }

  async revoke(organizationId: string, actorId: string, grantId: string) {
    const res = await this.db.query(
      `UPDATE partner_access_grants SET status = 'REVOKED', revoked_at = NOW(), revoked_by = $3
        WHERE organization_id = $1 AND id = $2 AND status = 'ACTIVE' RETURNING partner_organization_id`,
      [organizationId, grantId, actorId],
      { tenantId: organizationId }
    );
    if (!res.rows[0]) throw new NotFoundException('Active grant not found');
    await this.audit.record({
      organizationId,
      action: 'partner.access_revoked',
      resourceType: 'ORGANIZATION',
      resourceId: res.rows[0].partner_organization_id,
      actorId,
      payload: { grantId },
    });
    await this.audit.record({
      organizationId: res.rows[0].partner_organization_id,
      action: 'partner.access_revoked_by_customer',
      resourceType: 'ORGANIZATION',
      resourceId: organizationId,
      payload: { grantId },
    });
    return { success: true, grantId };
  }
}
