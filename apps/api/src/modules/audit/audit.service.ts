import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  computeAuditChainHash,
  canonicalJsonSerialize,
} from '@erppreflight/evidence';
import {
  AuditEventWire,
  TamperDetectionResult,
  LedgerAnomaly,
  ActorType,
} from '@erppreflight/schemas';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  public static readonly GENESIS_PREV_HASH = '0'.repeat(64);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Appends an immutable, cryptographically chained audit event to the tenant's ledger.
   * Uses advisory locks to ensure chain serialization under concurrent writes.
   * Returns sequenceNum along with the hash chain attributes.
   */
  public async recordEvent(params: {
    organizationId: string;
    action: string;
    resourceType?: string;
    resourceId?: string | null;
    payload?: Record<string, unknown>;
    actorType?: ActorType;
    actorId?: string | null;
    clientIp?: string | null;
    userAgent?: string | null;
    timestamp?: string;
  }): Promise<AuditEventWire> {
    const { organizationId, action } = params;
    const resourceType = params.resourceType || 'SYSTEM';
    const resourceId = params.resourceId || null;
    const actorType = params.actorType || 'SYSTEM';
    const actorId = params.actorId || null;
    // Mirror the indexed columns into the hashed payload so tampering with
    // target/actor columns is detectable by verifyChain().
    const payload: Record<string, unknown> = {
      ...(params.payload || {}),
      _ref: { targetType: resourceType, targetId: resourceId, actorType, actorId },
    };
    const clientIp = params.clientIp || null;
    const userAgent = params.userAgent || null;
    const eventId = uuidv4();
    // Normalize to exact ISO-8601 string to guarantee byte-for-byte hash consistency
    const createdAt = params.timestamp ? new Date(params.timestamp).toISOString() : new Date().toISOString();

    return await this.db.withTenantTransaction(organizationId, async (client) => {
      // 1. Acquire advisory lock scoped to tenant to ensure linear hash chaining
      try {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('audit_chain_' || $1::text))", [
          organizationId,
        ]);
      } catch (err: any) {
        this.logger.debug(`Advisory lock not acquired: ${err.message}`);
      }

      // 2. Fetch the latest event's current_hash using monotonic sequence_num
      const lastEventRes = await client.query<{ current_hash: string; chain_seq: string | number | null }>(
        `SELECT current_hash, chain_seq FROM audit_events 
         WHERE organization_id = $1 
         ORDER BY sequence_num DESC NULLS LAST, created_at DESC, id DESC 
         LIMIT 1`,
        [organizationId]
      );

      const prevHash = lastEventRes.rows[0]?.current_hash || AuditService.GENESIS_PREV_HASH;
      // Per-tenant contiguous position (migration 012); global sequence_num has cross-tenant gaps.
      const lastChainSeq = lastEventRes.rows[0]?.chain_seq;
      const chainSeq = lastEventRes.rows.length === 0 ? 1 : Number(lastChainSeq ?? 0) + 1;

      // 3. Compute chained SHA-256 hash
      const currentHash = computeAuditChainHash(
        prevHash,
        eventId,
        organizationId,
        action,
        createdAt,
        payload
      );

      // 4. Insert into audit_events and return generated sequence_num
      const insertRes = await client.query<{ sequence_num: string | number }>(
        `INSERT INTO audit_events (
          id, organization_id, actor_type, actor_id, action, target_type,
          target_id, payload, client_ip, user_agent, prev_hash, current_hash, created_at, chain_seq
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING sequence_num`,
        [
          eventId,
          organizationId,
          actorType,
          actorId,
          action,
          resourceType,
          resourceId,
          JSON.stringify(payload),
          clientIp,
          userAgent,
          prevHash,
          currentHash,
          createdAt,
          chainSeq,
        ]
      );

      const rawSeq = insertRes.rows[0]?.sequence_num;
      const sequenceNum = rawSeq !== undefined && rawSeq !== null ? Number(rawSeq) : undefined;

      return {
        id: eventId,
        sequenceNum,
        organizationId,
        actorType,
        actorId,
        actorMetadata: {},
        action,
        resourceType,
        resourceId,
        payload,
        clientIp,
        userAgent,
        prevHash,
        currentHash,
        createdAt,
      };
    });
  }

  /**
   * Verifies the entire audit trail ledger for a tenant, proving cryptographic integrity or pinpointing anomalies.
   * Traverses rows ordered exclusively by monotonic sequence_num ASC.
   */
  public async verifyTenantLedger(organizationId: string): Promise<TamperDetectionResult> {
    const res = await this.db.query(
      `SELECT * FROM audit_events 
       WHERE organization_id = $1 
       ORDER BY sequence_num ASC NULLS LAST, created_at ASC, id ASC`,
      [organizationId],
      { tenantId: organizationId }
    );

    // Gap detection runs on the per-tenant chain position, not the global sequence.
    const events = (res.rows || []).map((row: any) =>
      row.chain_seq !== undefined && row.chain_seq !== null
        ? { ...row, global_sequence_num: row.sequence_num, sequence_num: row.chain_seq }
        : row
    );
    return this.verifyChain(events);
  }

  /**
   * Pure deterministic verification routine over an array of audit events.
   * Can be invoked directly by unit tests or batch verification workers.
   */
  public verifyChain(events: any[]): TamperDetectionResult {
    if (events.length === 0) {
      return {
        isValid: true,
        totalEventsVerified: 0,
        genesisEventId: null,
        tipEventId: null,
        anomalies: [],
        verifiedAt: new Date().toISOString(),
      };
    }

    // Sort by sequence_num if present to prevent any order distortion
    const sortedEvents = [...events].sort((a, b) => {
      const seqA = a.sequence_num ?? a.sequenceNum;
      const seqB = b.sequence_num ?? b.sequenceNum;
      if (seqA !== undefined && seqB !== undefined) {
        return Number(seqA) - Number(seqB);
      }
      return 0; // maintain database order
    });

    const anomalies: LedgerAnomaly[] = [];

    // 1. Genesis Check
    const genesis = sortedEvents[0];
    const genesisPrev = genesis.prev_hash ?? genesis.prevHash;
    if (genesisPrev !== AuditService.GENESIS_PREV_HASH) {
      anomalies.push({
        anomalyType: 'MISSING_GENESIS_PREV_HASH',
        eventIndex: 0,
        eventId: genesis.id,
        expectedValue: AuditService.GENESIS_PREV_HASH,
        actualValue: genesisPrev || '',
        details: { message: 'Genesis event prev_hash must be 64 zeros' },
      });
    }

    // 2. Sequential Chain Traversal
    for (let i = 0; i < sortedEvents.length; i++) {
      const curr = sortedEvents[i];
      const currPrevHash = curr.prev_hash ?? curr.prevHash;
      const currHash = curr.current_hash ?? curr.currentHash;
      const currCreatedAt = curr.created_at ?? curr.createdAt;
      const currOrgId = curr.organization_id ?? curr.organizationId;

      if (i > 0) {
        const prev = sortedEvents[i - 1];
        const prevHash = prev.current_hash ?? prev.currentHash;
        const prevCreatedAt = prev.created_at ?? prev.createdAt;

        // Sequence number gap check
        const currSeq = curr.sequence_num ?? curr.sequenceNum;
        const prevSeq = prev.sequence_num ?? prev.sequenceNum;
        if (currSeq !== undefined && prevSeq !== undefined) {
          const expectedSeq = Number(prevSeq) + 1;
          if (Number(currSeq) > expectedSeq) {
            anomalies.push({
              anomalyType: 'GAP_DETECTED',
              eventIndex: i,
              eventId: curr.id,
              expectedValue: String(expectedSeq),
              actualValue: String(currSeq),
              details: { gapSize: Number(currSeq) - expectedSeq },
            });
          }
        }

        // Previous hash pointer check
        if (currPrevHash !== prevHash) {
          anomalies.push({
            anomalyType: 'BROKEN_CHAIN_LINK',
            eventIndex: i,
            eventId: curr.id,
            expectedValue: prevHash,
            actualValue: currPrevHash,
            details: { predecessorId: prev.id },
          });
        }

        // Chronological monotonicity check
        const currTime = new Date(currCreatedAt).getTime();
        const prevTime = new Date(prevCreatedAt).getTime();
        if (currTime < prevTime) {
          anomalies.push({
            anomalyType: 'TIMESTAMP_ANACHRONISM',
            eventIndex: i,
            eventId: curr.id,
            expectedValue: `>= ${prevCreatedAt}`,
            actualValue: currCreatedAt,
            details: { message: 'Event timestamp is earlier than predecessor' },
          });
        }
      }

      // Recompute SHA-256 hash
      const payload = typeof curr.payload === 'string' ? JSON.parse(curr.payload) : (curr.payload || {});
      const createdAtIso = new Date(currCreatedAt).toISOString();

      const recomputedHash = computeAuditChainHash(
        currPrevHash,
        curr.id,
        currOrgId,
        curr.action,
        createdAtIso,
        payload
      );

      const ref = payload && typeof payload === 'object' ? (payload as any)._ref : undefined;
      if (ref && typeof ref === 'object') {
        const colTargetType = curr.target_type ?? curr.resourceType;
        const colTargetId = curr.target_id ?? curr.resourceId ?? null;
        const colActorId = curr.actor_id ?? curr.actorId ?? null;
        const mismatch =
          (colTargetType !== undefined && ref.targetType !== colTargetType) ||
          (curr.target_id !== undefined && (ref.targetId ?? null) !== colTargetId) ||
          (curr.actor_id !== undefined && (ref.actorId ?? null) !== colActorId);
        if (mismatch) {
          anomalies.push({
            anomalyType: 'CORRUPTED_PAYLOAD',
            eventIndex: i,
            eventId: curr.id,
            expectedValue: JSON.stringify(ref),
            actualValue: JSON.stringify({ targetType: colTargetType, targetId: colTargetId, actorId: colActorId }),
            details: { message: 'Indexed target/actor columns differ from the hashed event reference' },
          });
        }
      }

      if (recomputedHash !== currHash) {
        anomalies.push({
          anomalyType: 'CORRUPTED_PAYLOAD',
          eventIndex: i,
          eventId: curr.id,
          expectedValue: recomputedHash,
          actualValue: currHash,
          details: { message: 'Cryptographic hash mismatch — payload or headers modified after commit' },
        });
      }
    }

    return {
      isValid: anomalies.length === 0,
      totalEventsVerified: sortedEvents.length,
      genesisEventId: sortedEvents[0].id,
      tipEventId: sortedEvents[sortedEvents.length - 1].id,
      anomalies,
      verifiedAt: new Date().toISOString(),
    };
  }

  public async getEvents(organizationId: string, limit: number = 100) {
    const page = await this.listEvents(organizationId, { limit });
    return page.items;
  }

  /**
   * Best-effort write for background workers (analysis processor, retention
   * sweeps). Returns false and logs at ERROR level on failure.
   */
  public async recordSafe(params: Parameters<AuditService['recordEvent']>[0]): Promise<boolean> {
    try {
      await this.recordEvent(params);
      return true;
    } catch (err: any) {
      this.logger.error(`Audit write failed for '${params.action}' (org=${params.organizationId}): ${err?.message ?? err}`);
      return false;
    }
  }

  /**
   * Resolves the primary organization (same rule as login) for a login e-mail so
   * failed sign-ins land in the account's tenant ledger. Platform lookup.
   */
  public async resolveAccountForEmail(
    email: string
  ): Promise<{ userId: string; organizationId: string } | null> {
    const res = await this.db.query(
      `SELECT u.id AS user_id, m.organization_id
         FROM users u
         JOIN LATERAL (
           SELECT om.organization_id FROM organization_members om
            WHERE om.user_id = u.id
            ORDER BY om.created_at ASC, om.organization_id ASC
            LIMIT 1
         ) m ON TRUE
        WHERE u.email = $1`,
      [email.toLowerCase()],
      { bypassRls: true }
    );
    const row = res.rows?.[0];
    return row ? { userId: row.user_id, organizationId: row.organization_id } : null;
  }

  /**
   * Filtered, keyset-paginated audit log for the org-admin UI.
   * `cursor` is the sequence_num of the last row of the previous page.
   */
  public async listEvents(
    organizationId: string,
    filters: {
      action?: string;
      targetType?: string;
      actorId?: string;
      from?: string;
      to?: string;
      cursor?: number;
      limit?: number;
    } = {}
  ): Promise<{ items: any[]; nextCursor: number | null; total: number }> {
    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
    const where: string[] = ['organization_id = $1'];
    const params: unknown[] = [organizationId];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (filters.action) add('action ILIKE ?', `${filters.action.replace(/[%_\\]/g, '\\$&')}%`);
    if (filters.targetType) add('target_type = ?', filters.targetType);
    if (filters.actorId) add('actor_id = ?::uuid', filters.actorId);
    if (filters.from) add('created_at >= ?::timestamptz', filters.from);
    if (filters.to) add('created_at <= ?::timestamptz', filters.to);

    const countRes = await this.db.query(
      `SELECT count(*)::int AS total FROM audit_events WHERE ${where.join(' AND ')}`,
      params,
      { tenantId: organizationId }
    );

    const pageWhere = [...where];
    const pageParams = [...params];
    if (filters.cursor !== undefined && Number.isFinite(filters.cursor)) {
      pageParams.push(filters.cursor);
      pageWhere.push(`sequence_num < $${pageParams.length}`);
    }
    pageParams.push(limit + 1);
    const res = await this.db.query(
      `SELECT e.id, e.sequence_num, e.actor_type, e.actor_id, u.email AS actor_email, e.action,
              e.target_type AS resource_type, e.target_id AS resource_id, e.payload,
              host(e.client_ip) AS client_ip, e.prev_hash, e.current_hash, e.created_at
         FROM audit_events e
         LEFT JOIN users u ON u.id = e.actor_id
        WHERE ${pageWhere.map((w) => w.replace(/^(\w)/, 'e.$1')).join(' AND ')}
        ORDER BY e.sequence_num DESC
        LIMIT $${pageParams.length}`,
      pageParams,
      { tenantId: organizationId }
    );
    const rows = res.rows ?? [];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r: any) => {
      const payload = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload ?? {};
      const { _ref, ...visible } = payload;
      return {
        id: r.id,
        sequenceNum: Number(r.sequence_num),
        actorType: r.actor_type,
        actorId: r.actor_id,
        actorEmail: r.actor_email ?? null,
        action: r.action,
        resourceType: r.resource_type,
        resourceId: r.resource_id,
        payload: visible,
        clientIp: r.client_ip ?? null,
        prevHash: r.prev_hash,
        currentHash: r.current_hash,
        createdAt: new Date(r.created_at).toISOString(),
      };
    });
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].sequenceNum : null,
      total: countRes.rows?.[0]?.total ?? 0,
    };
  }
}
