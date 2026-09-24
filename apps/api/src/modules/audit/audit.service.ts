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
    const payload = params.payload || {};
    const actorType = params.actorType || 'SYSTEM';
    const actorId = params.actorId || null;
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
      const lastEventRes = await client.query<{ current_hash: string }>(
        `SELECT current_hash FROM audit_events 
         WHERE organization_id = $1 
         ORDER BY sequence_num DESC NULLS LAST, created_at DESC, id DESC 
         LIMIT 1`,
        [organizationId]
      );

      const prevHash = lastEventRes.rows[0]?.current_hash || AuditService.GENESIS_PREV_HASH;

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
          id, organization_id, actor_type, actor_id, action, resource_type,
          resource_id, payload, client_ip, user_agent, prev_hash, current_hash, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
      [organizationId]
    );

    const events = res.rows || [];
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
    const res = await this.db.query(
      `SELECT id, sequence_num, organization_id, actor_type, actor_id, action, resource_type, resource_id, prev_hash, current_hash, created_at 
       FROM audit_events 
       WHERE organization_id = $1 
       ORDER BY sequence_num DESC NULLS LAST, created_at DESC 
       LIMIT $2`,
      [organizationId, limit]
    );
    return res.rows || [];
  }
}
