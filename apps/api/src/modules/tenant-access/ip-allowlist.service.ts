import { BadRequestException, ConflictException, Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService } from '../database/database.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { CidrError, ParsedCidr, anyCidrContains, parseCidr } from './cidr';

export const IP_ALLOWLIST_MAX_ENTRIES = 50;

export const IpAllowlistEntryInputSchema = z
  .object({
    cidr: z.string().trim().min(1).max(64),
    label: z
      .string()
      .trim()
      .max(100)
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .strict();

export const IpAllowlistReplaceSchema = z
  .object({
    entries: z.array(IpAllowlistEntryInputSchema).max(IP_ALLOWLIST_MAX_ENTRIES, {
      message: `An allowlist can hold at most ${IP_ALLOWLIST_MAX_ENTRIES} entries`,
    }),
    /** Save although the caller's current address is outside the new list (locks the caller out). */
    confirmLockout: z.boolean().optional().default(false),
  })
  .strict();
export type IpAllowlistReplaceDto = z.infer<typeof IpAllowlistReplaceSchema>;

export interface IpAllowlistEntry {
  id: string;
  cidr: string;
  label: string | null;
  createdAt: string;
  createdByEmail: string | null;
}

export interface IpAllowlistView {
  entries: IpAllowlistEntry[];
  /** true when at least one entry exists (requests from other addresses get 403 IP_NOT_ALLOWED). */
  enforced: boolean;
  maxEntries: number;
  /** The address the API sees for this request (after trusted-proxy resolution). */
  clientIp: string | null;
  clientIpAllowed: boolean;
  /** Plan includes the IP allowlist feature (managing entries requires it; clearing never does). */
  featureAvailable: boolean;
}

/**
 * Organization IP allowlist (spec 10.2, Enterprise feature). Entries are validated
 * and canonicalised in the API (cidr.ts) and stored as PostgreSQL `cidr`, which the
 * per-request check in TenantAccessService evaluates with `cidr >>= inet`.
 */
@Injectable()
export class IpAllowlistService {
  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly entitlements?: EntitlementsService
  ) {}

  private async featureAvailable(organizationId: string): Promise<boolean> {
    if (!this.entitlements) return false;
    try {
      const state = await this.entitlements.getPlanState(organizationId);
      return Boolean(state.limits.features.ipAllowlist);
    } catch {
      return false;
    }
  }

  private async entries(organizationId: string): Promise<IpAllowlistEntry[]> {
    const res = await this.db.query(
      `SELECT a.id, a.cidr::text AS cidr, a.label, a.created_at, u.email AS created_by_email
         FROM organization_ip_allowlist a
         LEFT JOIN users u ON u.id = a.created_by
        WHERE a.organization_id = $1
        ORDER BY a.created_at ASC, a.cidr ASC`,
      [organizationId],
      { tenantId: organizationId }
    );
    return (res.rows ?? []).map((r: any) => ({
      id: r.id,
      cidr: r.cidr,
      label: r.label ?? null,
      createdAt: new Date(r.created_at).toISOString(),
      createdByEmail: r.created_by_email ?? null,
    }));
  }

  async get(organizationId: string, clientIp: string | null): Promise<IpAllowlistView> {
    const [entries, featureAvailable] = await Promise.all([this.entries(organizationId), this.featureAvailable(organizationId)]);
    const parsed = entries.map((e) => parseCidr(e.cidr));
    return {
      entries,
      enforced: entries.length > 0,
      maxEntries: IP_ALLOWLIST_MAX_ENTRIES,
      clientIp,
      clientIpAllowed: entries.length === 0 || anyCidrContains(parsed, clientIp),
      featureAvailable,
    };
  }

  /** Validates and canonicalises entries; duplicates (after canonicalisation) are rejected. */
  static validateEntries(entries: IpAllowlistReplaceDto['entries']): Array<ParsedCidr & { label: string | null }> {
    const out: Array<ParsedCidr & { label: string | null }> = [];
    const seen = new Set<string>();
    const errors: string[] = [];
    entries.forEach((entry, index) => {
      try {
        const parsed = parseCidr(entry.cidr);
        if (seen.has(parsed.cidr)) {
          errors.push(`entries.${index}: ${parsed.cidr} is listed twice`);
          return;
        }
        seen.add(parsed.cidr);
        out.push({ ...parsed, label: entry.label ?? null });
      } catch (err) {
        errors.push(`entries.${index}: ${err instanceof CidrError ? err.message : 'invalid entry'}`);
      }
    });
    if (errors.length) {
      throw new BadRequestException({ code: 'IP_ALLOWLIST_INVALID', message: `Invalid IP allowlist: ${errors.join('; ')}` });
    }
    return out;
  }

  /**
   * Replaces the whole list atomically. Lockout protection: a non-empty list that does
   * not contain the caller's current address is refused with 409 IP_ALLOWLIST_LOCKOUT
   * unless `confirmLockout` is true.
   */
  async replace(
    organizationId: string,
    actorId: string | null,
    dto: IpAllowlistReplaceDto,
    clientIp: string | null
  ): Promise<IpAllowlistView & { previousCount: number; lockoutConfirmed: boolean }> {
    const parsed = IpAllowlistService.validateEntries(dto.entries);
    const excludesCaller = parsed.length > 0 && !anyCidrContains(parsed, clientIp);
    if (excludesCaller && !dto.confirmLockout) {
      throw new ConflictException({
        code: 'IP_ALLOWLIST_LOCKOUT',
        message: `Your current address ${clientIp ?? '(unknown)'} is not in the new allowlist. Saving it would block your own access immediately; confirm to save anyway.`,
        clientIp,
      });
    }
    const previousCount = await this.db.withTenantTransaction(organizationId, async (client) => {
      const prev = await client.query(
        `DELETE FROM organization_ip_allowlist WHERE organization_id = $1 RETURNING id`,
        [organizationId]
      );
      for (const entry of parsed) {
        await client.query(
          `INSERT INTO organization_ip_allowlist (organization_id, cidr, label, created_by)
           VALUES ($1, $2::cidr, $3, $4)`,
          [organizationId, entry.cidr, entry.label, actorId]
        );
      }
      return prev.rowCount ?? 0;
    });
    const view = await this.get(organizationId, clientIp);
    return { ...view, previousCount, lockoutConfirmed: excludesCaller };
  }

  async clear(organizationId: string): Promise<{ removed: number }> {
    const res = await this.db.query(
      `DELETE FROM organization_ip_allowlist WHERE organization_id = $1 RETURNING id`,
      [organizationId],
      { tenantId: organizationId }
    );
    return { removed: res.rowCount ?? res.rows?.length ?? 0 };
  }
}
