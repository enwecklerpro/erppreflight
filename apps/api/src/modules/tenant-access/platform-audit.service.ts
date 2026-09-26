import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { normalizeIp } from './cidr';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PlatformAuditInput {
  organizationId: string | null;
  actorId: string | null;
  actorEmail?: string | null;
  impersonationId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  payload?: Record<string, unknown>;
  clientIp?: string | null;
  userAgent?: string | null;
}

export interface PlatformAuditEvent {
  id: string;
  sequenceNum: number;
  organizationId: string | null;
  actorId: string | null;
  actorEmail: string | null;
  impersonationId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  payload: Record<string, unknown>;
  clientIp: string | null;
  createdAt: string;
}

function uuidOrNull(v: unknown): string | null {
  return typeof v === 'string' && UUID_RE.test(v) ? v : null;
}

function toEvent(r: any): PlatformAuditEvent {
  return {
    id: r.id,
    sequenceNum: Number(r.sequence_num),
    organizationId: r.organization_id ?? null,
    actorId: r.actor_id ?? null,
    actorEmail: r.actor_email ?? null,
    impersonationId: r.impersonation_id ?? null,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id ?? null,
    payload: r.payload ?? {},
    clientIp: r.client_ip ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/**
 * Append-only platform ledger (migration 021) of super-admin actions across tenants:
 * suspension, trial extension, IP-allowlist break-glass, impersonation start/end and
 * every request made while impersonating. The tenant's own hash-chained ledger
 * (AuditService) receives the same facts; this one lets operators review all
 * privileged platform activity in one place. Writes are FAIL-CLOSED (they throw).
 */
@Injectable()
export class PlatformAuditService {
  constructor(private readonly db: DatabaseService) {}

  async record(input: PlatformAuditInput): Promise<void> {
    await this.db.query(
      `INSERT INTO platform_audit_events
         (organization_id, actor_id, actor_email, impersonation_id, action, target_type, target_id, payload, client_ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::inet, $10)`,
      [
        uuidOrNull(input.organizationId),
        uuidOrNull(input.actorId),
        input.actorEmail ? String(input.actorEmail).slice(0, 255) : null,
        uuidOrNull(input.impersonationId),
        input.action.slice(0, 120),
        input.targetType.slice(0, 60),
        uuidOrNull(input.targetId),
        JSON.stringify(input.payload ?? {}),
        normalizeIp(input.clientIp),
        input.userAgent ? String(input.userAgent).slice(0, 500) : null,
      ],
      { bypassRls: true }
    );
  }

  /** Newest first; optionally one tenant and/or one impersonation session. */
  async list(filters: { organizationId?: string; impersonationId?: string; limit?: number } = {}): Promise<PlatformAuditEvent[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.organizationId) {
      params.push(filters.organizationId);
      where.push(`organization_id = $${params.length}::uuid`);
    }
    if (filters.impersonationId) {
      params.push(filters.impersonationId);
      where.push(`impersonation_id = $${params.length}::uuid`);
    }
    params.push(Math.min(Math.max(Number(filters.limit) || 100, 1), 500));
    const res = await this.db.query(
      `SELECT id, sequence_num, organization_id, actor_id, actor_email, impersonation_id, action, target_type,
              target_id, payload, host(client_ip) AS client_ip, created_at
         FROM platform_audit_events
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY sequence_num DESC
        LIMIT $${params.length}`,
      params,
      { bypassRls: true }
    );
    return (res.rows ?? []).map(toEvent);
  }
}
