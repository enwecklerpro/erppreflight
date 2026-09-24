# Technical Blueprint: Audit Trail Monotonic Ordering, Composite Trust Calibration & Release Alignment

**Target Components**:
- TypeScript:
  - `packages/database/migrations/003_audit_monotonic_sequence.sql`
  - `packages/database/src/schema/audit.ts`
  - `packages/schemas/src/audit.ts`
  - `apps/api/src/modules/audit/audit.service.ts`
  - `apps/api/src/modules/audit/audit-trail.service.ts`
  - `packages/evidence/src/classifier.ts`
  - `packages/evidence/src/trust-score.ts`
  - `packages/evidence/src/release_validator.ts`
  - `packages/evidence/src/release-alignment.ts`
  - `apps/api/test/m2_challenges.spec.ts`
- Python:
  - `services/analysis-python/src/platform/audit.py`
  - `services/analysis-python/src/platform/evidence.py`
  - `services/analysis-python/tests/adversarial/test_m2_challenges.py`

**Author**: `m2_it2_explorer_3_gen2`  
**Date**: 2026-09-24  
**Status**: APPROVED BLUEPRINT (Iteration 2 Explorer Delivery)

---

## 1. Executive Summary & Problem Statements

Milestone 2 Challenger 2 (`m2_challenger_2`) and Reviewer 2 (`m2_reviewer_2`) identified three critical platform defects requiring architectural remediation:

### 1.1 Audit Trail False Positive Tamper Alerts on Millisecond Timestamp Collisions
- **Vulnerability**:
  In `apps/api/src/modules/audit/audit.service.ts` (lines 61, 124), queries sort audit records by:
  ```sql
  ORDER BY created_at ASC, id ASC
  ```
  And the latest tip hash by:
  ```sql
  ORDER BY created_at DESC, id DESC LIMIT 1
  ```
- **Root Cause**:
  In high-throughput enterprise preflight workflows (e.g. batch file quarantine, scanning, secret redaction, and hash calculation), multiple audit events occur within the exact same millisecond and share identical `created_at` timestamps.
  When timestamps collide, PostgreSQL falls back to `id ASC`. Because `id` is a random UUIDv4 (`uuidv4()`), there is a 50% probability that a later event in the chain has a lexicographically smaller UUID than its predecessor.
  When `verifyTenantLedger` retrieves rows sorted by `(created_at, id)`, the rows arrive out of topological sequence. Event 2 precedes Event 1. Event 2's `prev_hash` does not equal `GENESIS_PREV_HASH`, and Event 1's `prev_hash` does not equal Event 2's `current_hash`.
  **Consequence**: Completely valid, untampered audit ledgers are falsely flagged as corrupted (`is_valid = false`, `MISSING_GENESIS_PREV_HASH`, `BROKEN_CHAIN_LINK`), destroying audit credibility.
- **Architectural Solution**:
  Introduce a monotonic 64-bit integer sequence (`sequence_num BIGSERIAL`) to the `audit_events` table and Drizzle schema. Sort strictly by `sequence_num ASC` in `verifyTenantLedger` and `sequence_num DESC LIMIT 1` when acquiring the chain tip. Support sequence gap detection (`GAP_DETECTED`) when records are deleted.

### 1.2 Composite Trust Accumulator Mathematical Attenuation Defect
- **Vulnerability**:
  In `services/analysis-python/src/platform/evidence.py` (lines 176–186) and `packages/evidence/src/classifier.ts` (lines 54–66), the composite trust formula was implemented as:
  $$\text{Trust}_{\text{composite}} = \max(s_k) \times \left(1 - \prod_{k} (1 - 0.2 \cdot s_k)\right)$$
- **Root Cause**:
  For two pieces of corroborating evidence ($s_1 = 1.0, s_2 = 0.85$):
  $$\prod = (1 - 0.2) \times (1 - 0.17) = 0.80 \times 0.83 = 0.664$$
  $$1 - \prod = 0.336$$
  $$\text{Trust}_{\text{composite}} = 1.0 \times 0.336 = \mathbf{0.336}$$
  Instead of corroborating evidence increasing or maintaining trust, adding high-trust evidence caused the composite score to plummet by 66.4%!
- **Architectural Solution**:
  Implement an asymptotic uncertainty reduction model (Noisy-OR evidence booster):
  $$\text{Trust}_{\text{composite}} = M + (1.0 - M) \times \left(1 - \prod_{k \in \text{corroborating}} (1 - 0.2 \cdot s_k)\right)$$
  Where $M = \max_k(s_k)$ is the anchor evidence score. Corroborating items monotonically close the uncertainty gap $(1.0 - M)$. The score is strictly bounded to $[0.0, 1.0]$ and capped at $0.60$ whenever LLM assistance is involved.

### 1.3 ReleaseAlignmentValidator Dead Code & S/4HANA Cloud Misclassification
- **Vulnerability**:
  In `packages/evidence/src/release_validator.ts` (lines 25–26):
  ```typescript
  if (num > 2000) return { family: 'ON_PREMISE', version: num };
  if (num > 2000 && num < 2700) return { family: 'CLOUD', version: num };
  ```
- **Root Cause**:
  Line 25 catches all numbers $> 2000$, rendering line 26 dead code. Releases such as `"2308"`, `"2402"`, `"2408"` are misclassified as `ON_PREMISE` in TypeScript while classified as `CLOUD` in Python.
- **Architectural Solution**:
  Implement the exact regex `^(2[0-9])(0[1-9]|1[0-2])$` to accurately classify 4-digit S/4HANA Cloud `YYMM` releases (such as 2308, 2402, 2408) as `S4HANA_CLOUD`. Provide bidirectional aliases between `CLOUD` and `S4HANA_CLOUD`. Unify behavior across TypeScript and Python.

---

## 2. Component 1: Audit Trail Monotonic Sequencing Blueprint

### 2.1 Database Migration: `003_audit_monotonic_sequence.sql`
**Path**: `H:/erppreflight/packages/database/migrations/003_audit_monotonic_sequence.sql`

```sql
-- ==============================================================================
-- ERP Preflight — Audit Trail Monotonic Sequence Migration
-- Migration: 003_audit_monotonic_sequence.sql
-- Purpose: Add strictly monotonic BIGSERIAL sequence_num to eliminate
--          millisecond timestamp sort collision false-positive tamper alerts.
-- ==============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'audit_events' AND column_name = 'sequence_num'
    ) THEN
        ALTER TABLE audit_events ADD COLUMN sequence_num BIGSERIAL;
    END IF;
END $$;

-- High-performance b-tree index for tenant ledger ordered traversal
CREATE INDEX IF NOT EXISTS idx_audit_events_seq 
ON audit_events(organization_id, sequence_num ASC);

-- Index for acquiring the latest chain tip in constant time
CREATE INDEX IF NOT EXISTS idx_audit_events_tip 
ON audit_events(organization_id, sequence_num DESC);
```

### 2.2 Drizzle Schema: `packages/database/src/schema/audit.ts`
**Path**: `H:/erppreflight/packages/database/src/schema/audit.ts`

```typescript
import { pgTable, uuid, varchar, text, jsonb, timestamp, inet, bigserial, index } from 'drizzle-orm/pg-core';

export const auditEvents = pgTable(
  'audit_events',
  {
    sequenceNum: bigserial('sequence_num', { mode: 'number' }).primaryKey(),
    id: uuid('id').defaultRandom().notNull(),
    organizationId: uuid('organization_id').notNull(),
    actorType: varchar('actor_type', { length: 50 }).default('SYSTEM').notNull(),
    actorId: uuid('actor_id'),
    action: varchar('action', { length: 100 }).notNull(),
    resourceType: varchar('resource_type', { length: 100 }).default('SYSTEM').notNull(),
    resourceId: uuid('resource_id'),
    payload: jsonb('payload').default({}).notNull(),
    clientIp: inet('client_ip'),
    userAgent: text('user_agent'),
    prevHash: varchar('prev_hash', { length: 64 }).notNull(),
    currentHash: varchar('current_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgSeqIdx: index('idx_audit_events_seq').on(table.organizationId, table.sequenceNum),
  })
);

export type AuditEventRow = typeof auditEvents.$inferSelect;
export type NewAuditEventRow = typeof auditEvents.$inferInsert;
```

Update `packages/database/src/index.ts` to export the schema:
```typescript
export * from './client';
export * from './rls';
export * from './migrate';
export * from './schema/audit';
```

### 2.3 Shared Zod Contract: `packages/schemas/src/audit.ts`
**Path**: `H:/erppreflight/packages/schemas/src/audit.ts`

Add `sequenceNum` to `AuditEventWireSchema`:
```typescript
export const AuditEventWireSchema = z.object({
  id: z.string().uuid(),
  sequenceNum: z.coerce.number().int().positive().optional(),
  organizationId: z.string().uuid(),
  actorType: ActorTypeEnum.default('SYSTEM'),
  actorId: z.string().uuid().nullable().optional(),
  actorMetadata: z.record(z.unknown()).default({}),
  action: z.string().min(1),
  resourceType: z.string().min(1).default('SYSTEM'),
  resourceId: z.string().uuid().nullable().optional(),
  payload: z.record(z.unknown()).default({}),
  clientIp: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  prevHash: z.string().regex(/^[a-fA-F0-9]{64}$/),
  currentHash: z.string().regex(/^[a-fA-F0-9]{64}$/),
  createdAt: z.string(),
});
export type AuditEventWire = z.infer<typeof AuditEventWireSchema>;
```

### 2.4 TypeScript Implementation: `apps/api/src/modules/audit/audit.service.ts`
**Path**: `H:/erppreflight/apps/api/src/modules/audit/audit.service.ts`

```typescript
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
    if (genesis.prev_hash !== AuditService.GENESIS_PREV_HASH) {
      anomalies.push({
        anomalyType: 'MISSING_GENESIS_PREV_HASH',
        eventIndex: 0,
        eventId: genesis.id,
        expectedValue: AuditService.GENESIS_PREV_HASH,
        actualValue: genesis.prev_hash || '',
        details: { message: 'Genesis event prev_hash must be 64 zeros' },
      });
    }

    // 2. Sequential Chain Traversal
    for (let i = 0; i < sortedEvents.length; i++) {
      const curr = sortedEvents[i];

      if (i > 0) {
        const prev = sortedEvents[i - 1];

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
        if (curr.prev_hash !== prev.current_hash) {
          anomalies.push({
            anomalyType: 'BROKEN_CHAIN_LINK',
            eventIndex: i,
            eventId: curr.id,
            expectedValue: prev.current_hash,
            actualValue: curr.prev_hash,
            details: { predecessorId: prev.id },
          });
        }

        // Chronological monotonicity check
        const currTime = new Date(curr.created_at).getTime();
        const prevTime = new Date(prev.created_at).getTime();
        if (currTime < prevTime) {
          anomalies.push({
            anomalyType: 'TIMESTAMP_ANACHRONISM',
            eventIndex: i,
            eventId: curr.id,
            expectedValue: `>= ${prev.created_at}`,
            actualValue: curr.created_at,
            details: { message: 'Event timestamp is earlier than predecessor' },
          });
        }
      }

      // Recompute SHA-256 hash
      const payload = typeof curr.payload === 'string' ? JSON.parse(curr.payload) : (curr.payload || {});
      const createdAtIso = new Date(curr.created_at).toISOString();

      const recomputedHash = computeAuditChainHash(
        curr.prev_hash,
        curr.id,
        curr.organization_id,
        curr.action,
        createdAtIso,
        payload
      );

      if (recomputedHash !== curr.current_hash) {
        anomalies.push({
          anomalyType: 'CORRUPTED_PAYLOAD',
          eventIndex: i,
          eventId: curr.id,
          expectedValue: recomputedHash,
          actualValue: curr.current_hash,
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
```

Create `apps/api/src/modules/audit/audit-trail.service.ts` to export `AuditTrailService` as an alias:
```typescript
import { Injectable } from '@nestjs/common';
import { AuditService } from './audit.service';

@Injectable()
export class AuditTrailService extends AuditService {}
```

### 2.5 Python Implementation: `services/analysis-python/src/platform/audit.py`
**Path**: `H:/erppreflight/services/analysis-python/src/platform/audit.py`

```python
import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, field


def canonical_json_serialize(obj: Any) -> str:
    """RFC 8785 deterministic JSON canonicalization."""
    return json.dumps(
        obj,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False
    )


def compute_audit_chain_hash(
    prev_hash: str,
    event_id: str,
    tenant_id: str,
    action: str,
    timestamp: str,
    payload: Any
) -> str:
    """Computes SHA-256 chained hash: SHA256(prev_hash:event_id:tenant_id:action:timestamp:JCS(payload))."""
    jcs_str = canonical_json_serialize(payload)
    raw = f"{prev_hash}:{event_id}:{tenant_id}:{action}:{timestamp}:{jcs_str}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


@dataclass
class AuditEvent:
    id: str
    organization_id: str
    action: str
    resource_type: str
    resource_id: Optional[str]
    payload: Dict[str, Any]
    prev_hash: str
    current_hash: str
    sequence_num: Optional[int] = None
    actor_type: str = "SYSTEM"
    actor_id: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class LedgerAnomaly:
    anomaly_type: str
    event_index: int
    event_id: str
    expected_value: str
    actual_value: str
    details: Dict[str, Any]


@dataclass
class TamperDetectionResult:
    is_valid: bool = True
    total_events_verified: int = 0
    genesis_event_id: Optional[str] = None
    tip_event_id: Optional[str] = None
    anomalies: List[LedgerAnomaly] = field(default_factory=list)
    verified_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class AuditTrailLedger:
    """Tamper-evident append-only ledger with cryptographic hash chaining."""

    GENESIS_PREV_HASH: str = "0" * 64

    @classmethod
    def create_event(
        cls,
        organization_id: str,
        action: str,
        resource_type: str = "SYSTEM",
        resource_id: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
        prev_hash: Optional[str] = None,
        sequence_num: Optional[int] = None,
        actor_type: str = "SYSTEM",
        actor_id: Optional[str] = None,
        timestamp: Optional[str] = None,
    ) -> AuditEvent:
        event_id = str(uuid.uuid4())
        created_at = timestamp or datetime.now(timezone.utc).isoformat()
        previous = prev_hash or cls.GENESIS_PREV_HASH
        data_payload = payload or {}
        current_hash = compute_audit_chain_hash(
            prev_hash=previous,
            event_id=event_id,
            tenant_id=organization_id,
            action=action,
            timestamp=created_at,
            payload=data_payload,
        )

        return AuditEvent(
            id=event_id,
            sequence_num=sequence_num,
            organization_id=organization_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            payload=data_payload,
            prev_hash=previous,
            current_hash=current_hash,
            actor_type=actor_type,
            actor_id=actor_id,
            created_at=created_at,
        )

    @classmethod
    def verify_ledger(cls, events: List[Dict[str, Any] | AuditEvent]) -> TamperDetectionResult:
        if not events:
            return TamperDetectionResult(is_valid=True, total_events_verified=0, anomalies=[])

        # Normalize to dictionaries
        raw_events: List[Dict[str, Any]] = []
        for e in events:
            if isinstance(e, AuditEvent):
                raw_events.append({
                    "id": e.id,
                    "sequence_num": e.sequence_num,
                    "organization_id": e.organization_id,
                    "action": e.action,
                    "resource_type": e.resource_type,
                    "resource_id": e.resource_id,
                    "payload": e.payload,
                    "prev_hash": e.prev_hash,
                    "current_hash": e.current_hash,
                    "actor_type": e.actor_type,
                    "actor_id": e.actor_id,
                    "created_at": e.created_at,
                })
            else:
                raw_events.append(dict(e))

        # Deterministic sort by monotonic sequence_num / chain_index if available
        has_sequence = any(
            x.get("sequence_num") is not None or x.get("chain_index") is not None 
            for x in raw_events
        )
        if has_sequence:
            raw_events.sort(
                key=lambda x: int(x.get("sequence_num") if x.get("sequence_num") is not None else (x.get("chain_index") or 0))
            )

        anomalies: List[LedgerAnomaly] = []

        # 1. Genesis check
        genesis = raw_events[0]
        genesis_prev = genesis.get("prev_hash") or genesis.get("previous_event_hash")
        if genesis_prev != cls.GENESIS_PREV_HASH:
            anomalies.append(LedgerAnomaly(
                anomaly_type="MISSING_GENESIS_PREV_HASH",
                event_index=0,
                event_id=str(genesis.get("id") or genesis.get("event_id")),
                expected_value=cls.GENESIS_PREV_HASH,
                actual_value=str(genesis_prev),
                details={"message": "Genesis event prev_hash must be 64 zeros"},
            ))

        # 2. Sequential traversal
        for i in range(len(raw_events)):
            curr = raw_events[i]
            curr_id = str(curr.get("id") or curr.get("event_id"))
            curr_prev = curr.get("prev_hash") or curr.get("previous_event_hash")
            curr_hash = curr.get("current_hash") or curr.get("event_hash")
            curr_tenant = str(curr.get("organization_id") or curr.get("tenant_id"))
            curr_action = str(curr.get("action"))
            curr_created = str(curr.get("created_at") or curr.get("timestamp"))
            curr_payload = curr.get("payload") if "payload" in curr else curr.get("details", {})

            if i > 0:
                prev_ev = raw_events[i - 1]

                # Monotonic sequence gap detection
                curr_seq = curr.get("sequence_num") if curr.get("sequence_num") is not None else curr.get("chain_index")
                prev_seq = prev_ev.get("sequence_num") if prev_ev.get("sequence_num") is not None else prev_ev.get("chain_index")
                if curr_seq is not None and prev_seq is not None:
                    try:
                        curr_seq_int = int(curr_seq)
                        prev_seq_int = int(prev_seq)
                        if curr_seq_int > prev_seq_int + 1:
                            anomalies.append(LedgerAnomaly(
                                anomaly_type="GAP_DETECTED",
                                event_index=i,
                                event_id=curr_id,
                                expected_value=str(prev_seq_int + 1),
                                actual_value=str(curr_seq_int),
                                details={"message": f"Monotonic sequence gap detected between {prev_seq_int} and {curr_seq_int}"},
                            ))
                    except (ValueError, TypeError):
                        pass

                # Chain link check
                prev_hash_expected = prev_ev.get("current_hash") or prev_ev.get("event_hash")
                if curr_prev != prev_hash_expected:
                    anomalies.append(LedgerAnomaly(
                        anomaly_type="BROKEN_CHAIN_LINK",
                        event_index=i,
                        event_id=curr_id,
                        expected_value=str(prev_hash_expected),
                        actual_value=str(curr_prev),
                        details={"predecessor_id": str(prev_ev.get("id") or prev_ev.get("event_id"))},
                    ))

                # Monotonic time check
                prev_created = str(prev_ev.get("created_at") or prev_ev.get("timestamp"))
                if curr_created < prev_created:
                    anomalies.append(LedgerAnomaly(
                        anomaly_type="TIMESTAMP_ANACHRONISM",
                        event_index=i,
                        event_id=curr_id,
                        expected_value=f">= {prev_created}",
                        actual_value=curr_created,
                        details={"message": "Event timestamp earlier than predecessor"},
                    ))

            # Cryptographic hash recalculation
            recalculated = compute_audit_chain_hash(
                prev_hash=str(curr_prev),
                event_id=curr_id,
                tenant_id=curr_tenant,
                action=curr_action,
                timestamp=curr_created,
                payload=curr_payload,
            )

            if recalculated != curr_hash:
                anomalies.append(LedgerAnomaly(
                    anomaly_type="CORRUPTED_PAYLOAD",
                    event_index=i,
                    event_id=curr_id,
                    expected_value=recalculated,
                    actual_value=str(curr_hash),
                    details={"message": "Hash does not match payload and event header contents"},
                ))

        return TamperDetectionResult(
            is_valid=(len(anomalies) == 0),
            total_events_verified=len(raw_events),
            genesis_event_id=str(raw_events[0].get("id") or raw_events[0].get("event_id")),
            tip_event_id=str(raw_events[-1].get("id") or raw_events[-1].get("event_id")),
            anomalies=anomalies,
            verified_at=datetime.now(timezone.utc).isoformat(),
        )

    @classmethod
    def verify_chain(cls, events: List[Dict[str, Any] | AuditEvent]) -> TamperDetectionResult:
        """Alias for verify_ledger guaranteeing explicit linear sequence sorting."""
        return cls.verify_ledger(events)
```

---

## 3. Component 2: Composite Trust Accumulator Blueprint

### 3.1 Mathematical Derivation & Axiomatic Invariants
Let $S = [s_1, s_2, \dots, s_N]$ be the collection of evidence scores, each $s_i \in [0.0, 1.0]$.
1. **Anchor Selection**: $M = \max(S)$. The single most authoritative piece of evidence defines the baseline trust level.
2. **Corroborating Evidence Set**: Let $C = S \setminus \{\text{argmax}(S)\}$ be the list of $N-1$ secondary evidence items.
3. **Noisy-OR Uncertainty Reduction**:
   Each corroborating item $s_k \in C$ closes a fraction $w_k = 0.20 \cdot s_k$ of the remaining uncertainty $\Delta = 1.0 - M$.
   The unclosed uncertainty fraction is:
   $$\Pi(C) = \prod_{s_k \in C} (1.0 - 0.20 \cdot s_k)$$
   The closed uncertainty fraction is $1.0 - \Pi(C)$.
4. **Composite Formulation**:
   $$\text{Trust}_{\text{composite}} = M + (1.0 - M) \times (1.0 - \Pi(C))$$
5. **Mathematical Verification of Axioms**:
   - **Identity on $N=1$**: If $|S| = 1$, $C = \emptyset \implies \Pi(C) = 1.0 \implies \text{Trust} = M + 0 = M$. (Ex: $s_1 = 0.85 \implies \text{Trust} = 0.85$).
   - **Monotonic Non-Decreasing**: For any $s_{\text{new}} \ge 0$, $\text{Trust}(S \cup \{s_{\text{new}}\}) \ge \text{Trust}(S)$.
     Adding evidence *never* lowers trust!
   - **Epistemic Bounding**:
     If $M = 1.0$ (VERIFIED): $(1.0 - M) = 0 \implies \text{Trust} = 1.0$ regardless of corroborating items.
     If $M = 0.85$ and second item has $0.85$: $\text{Trust} = 0.85 + (0.15) \times (0.17) = 0.8755 \approx 0.876$.
   - **LLM Ceilings**: Findings derived with AI involvement can **never** exceed $0.60$ (`INFERRED`).

### 3.2 TypeScript Implementation: `packages/evidence/src/trust-score.ts` & `classifier.ts`
**Path**: `H:/erppreflight/packages/evidence/src/trust-score.ts`

```typescript
import { ConfidenceScoreMap } from '@erppreflight/schemas';

export const TrustScoreConstants = {
  OFFICIAL_METADATA: 1.0,
  OFFICIAL_DOCS: 0.95,
  OFFICIAL_SUPPORT: 0.9,
  CURATED_RULE: 0.85,
  OFFICIAL_COMMUNITY: 0.7,
  THIRD_PARTY_REF: 0.6,
  CUSTOMER_EVIDENCE: 0.5,
  INFERRED: 0.3,
};

export interface TrustCalculationOptions {
  isLlmGenerated?: boolean;
  maxCeiling?: number;
}

/**
 * Calculates composite trust score for an array of evidence items.
 * Uses an asymptotic Noisy-OR uncertainty booster anchored on the maximum score.
 * Formula: Trust_composite = max(s_k) + (1.0 - max(s_k)) * (1.0 - prod_{corrob}(1.0 - 0.2 * s_k))
 */
export function calculateCompositeTrustScore(
  evidenceList: Array<{ trustScore?: number } | number>,
  options?: TrustCalculationOptions
): number {
  if (!evidenceList || evidenceList.length === 0) return 0.0;

  const rawScores: number[] = evidenceList.map((item) => {
    if (typeof item === 'number') return item;
    return item?.trustScore ?? 0.5;
  });

  if (rawScores.length === 0) return 0.0;

  const maxScore = Math.max(...rawScores);
  if (rawScores.length === 1) {
    return clampTrust(maxScore, options);
  }

  // Find index of first maximum score to treat as anchor
  const maxIndex = rawScores.indexOf(maxScore);
  const corroboratingScores = rawScores.filter((_, idx) => idx !== maxIndex);

  // Compute unclosed uncertainty fraction
  let prod = 1.0;
  for (const s of corroboratingScores) {
    prod *= 1.0 - 0.20 * Math.max(0.0, Math.min(1.0, s));
  }

  const uncertaintyClosed = 1.0 - prod;
  const composite = maxScore + (1.0 - maxScore) * uncertaintyClosed;

  return clampTrust(composite, options);
}

function clampTrust(value: number, options?: TrustCalculationOptions): number {
  let ceiling = 1.0;
  if (options?.isLlmGenerated) {
    ceiling = ConfidenceScoreMap.INFERRED; // 0.60 strict ceiling
  }
  if (options?.maxCeiling !== undefined && options.maxCeiling < ceiling) {
    ceiling = options.maxCeiling;
  }

  const rounded = Number(value.toFixed(3));
  return Math.min(ceiling, Math.max(0.0, rounded));
}
```

Update `packages/evidence/src/classifier.ts` to re-export from `trust-score.ts`:
```typescript
export * from './trust-score';
```
And export `* from './trust-score'` in `packages/evidence/src/index.ts`.

### 3.3 Python Implementation: `services/analysis-python/src/platform/evidence.py`
**Path**: `H:/erppreflight/services/analysis-python/src/platform/evidence.py`

Update `EvidenceEngine.calculate_composite_trust`:
```python
    @classmethod
    def calculate_composite_trust(
        cls,
        scores: List[float],
        is_llm_generated: bool = False,
        max_ceiling: Optional[float] = None
    ) -> float:
        """
        Calculates composite trust using the Noisy-OR corroboration formula:
        Trust = max(scores) + (1.0 - max(scores)) * (1.0 - prod_{corrob}(1.0 - 0.2 * s_k))
        Guarantees that additional corroborating evidence strictly increases or maintains trust.
        """
        if not scores:
            return 0.0

        clamped_scores = [max(0.0, min(1.0, float(s))) for s in scores]
        max_score = max(clamped_scores)
        if len(clamped_scores) == 1:
            return cls._clamp_trust(max_score, is_llm_generated, max_ceiling)

        max_idx = clamped_scores.index(max_score)
        corroborating = [s for idx, s in enumerate(clamped_scores) if idx != max_idx]

        prod = 1.0
        for s in corroborating:
            prod *= (1.0 - 0.20 * s)

        uncertainty_closed = 1.0 - prod
        composite = max_score + (1.0 - max_score) * uncertainty_closed
        return cls._clamp_trust(composite, is_llm_generated, max_ceiling)

    @classmethod
    def _clamp_trust(
        cls,
        value: float,
        is_llm_generated: bool = False,
        max_ceiling: Optional[float] = None
    ) -> float:
        ceiling = 1.0
        if is_llm_generated:
            ceiling = 0.60  # Epistemic ceiling for INFERRED
        if max_ceiling is not None and max_ceiling < ceiling:
            ceiling = max_ceiling
        return min(ceiling, max(0.0, round(value, 3)))
```

---

## 4. Component 3: ReleaseAlignmentValidator & Regex Classification Blueprint

### 4.1 Regular Expression & Classification Matrix
- **S/4HANA Cloud Regex**: `^(2[0-9])(0[1-9]|1[0-2])$`
  - Group 1: `(2[0-9])` -> Years 2020 through 2029 (e.g., 21, 22, 23, 24, 25).
  - Group 2: `(0[1-9]|1[0-2])` -> Months 01 through 12.
- **Classification Table**:

| Input Release String | Clean Suffix / Digits | Regex Match Status | Resolved Family | Resolved Version |
|:---|:---|:---:|:---:|:---:|
| `2308` | `2308` | **MATCH** (`23`, `08`) | `S4HANA_CLOUD` | `2308` |
| `2402` | `2402` | **MATCH** (`24`, `02`) | `S4HANA_CLOUD` | `2402` |
| `2408` | `2408` | **MATCH** (`24`, `08`) | `S4HANA_CLOUD` | `2408` |
| `2502` | `2502` | **MATCH** (`25`, `02`) | `S4HANA_CLOUD` | `2502` |
| `S4HC_2408` | `2408` | Prefix `S4HC_` | `S4HANA_CLOUD` | `2408` |
| `S4HANA_CLOUD_2308` | `2308` | Prefix `S4HANA_CLOUD_` | `S4HANA_CLOUD` | `2308` |
| `2020` | `2020` | Non-match (month `20` invalid) | `ON_PREMISE` | `2020` |
| `2021` | `2021` | Non-match (month `21` invalid) | `ON_PREMISE` | `2021` |
| `2022` | `2022` | Non-match (month `22` invalid) | `ON_PREMISE` | `2022` |
| `2023` | `2023` | Non-match (month `23` invalid) | `ON_PREMISE` | `2023` |
| `2025` | `2025` | Non-match (month `25` invalid) | `ON_PREMISE` | `2025` |
| `S4H_2023` | `2023` | Prefix `S4H_` | `ON_PREMISE` | `2023` |
| `1909` | `1909` | Non-match (`19` != `2x`) | `ON_PREMISE` | `1909` |
| `1809` | `1809` | Non-match (`18` != `2x`) | `ON_PREMISE` | `1809` |
| `ECC_600` / `ECC` | `600` | Prefix `ECC` | `ECC` | `600` |

### 4.2 TypeScript Implementation: `packages/evidence/src/release-alignment.ts` & `release_validator.ts`
**Path**: `H:/erppreflight/packages/evidence/src/release-alignment.ts`

```typescript
import { ReleaseAlignment } from '@erppreflight/schemas';

export type ReleaseFamily = 'ON_PREMISE' | 'CLOUD' | 'S4HANA_CLOUD' | 'ECC' | 'UNKNOWN';

export interface ReleaseParseResult {
  family: ReleaseFamily;
  version: number;
}

export interface ReleaseAlignmentResult {
  status: ReleaseAlignment;
  isAligned: boolean;
  penalty: number;
  message: string;
}

export class ReleaseAlignmentValidator {
  private static readonly CLOUD_YYMM_REGEX = /^(2[0-9])(0[1-9]|1[0-2])$/;
  private static readonly CLOUD_FAMILIES = new Set<string>(['CLOUD', 'S4HANA_CLOUD']);

  public static isSameFamily(famA?: string | null, famB?: string | null): boolean {
    if (!famA || !famB) return false;
    if (famA === famB) return true;
    return this.CLOUD_FAMILIES.has(famA) && this.CLOUD_FAMILIES.has(famB);
  }

  public static parseRelease(rel: string): ReleaseParseResult {
    const clean = rel.trim().toUpperCase();

    // 1. Explicit S/4HANA Cloud prefixes
    if (clean.startsWith('S4HC_') || clean.startsWith('S4HANA_CLOUD_')) {
      const numStr = clean.replace(/[^0-9]/g, '');
      return { family: 'S4HANA_CLOUD', version: parseInt(numStr, 10) || 0 };
    }

    // 2. Explicit S/4HANA On-Premise prefixes
    if (clean.startsWith('S4H_') || clean.startsWith('S4_') || clean.startsWith('S4HANA_')) {
      const numStr = clean.replace(/[^0-9]/g, '');
      return { family: 'ON_PREMISE', version: parseInt(numStr, 10) || 0 };
    }

    // 3. SAP ECC prefix
    if (clean.startsWith('ECC')) {
      return { family: 'ECC', version: 600 };
    }

    const digitsOnly = clean.replace(/[^0-9]/g, '');

    // 4. Exact S/4HANA Cloud YYMM format: 2308, 2402, 2408, 2502
    if (this.CLOUD_YYMM_REGEX.test(clean) || this.CLOUD_YYMM_REGEX.test(digitsOnly)) {
      return { family: 'S4HANA_CLOUD', version: parseInt(digitsOnly, 10) || 0 };
    }

    const num = parseInt(digitsOnly, 10);
    if (!isNaN(num)) {
      // 5. Classic S/4HANA On-Premise releases: 1511, 1610, 1709, 1809, 1909, 2020, 2021, 2022, 2023, 2025
      if ((num >= 1500 && num <= 2100) || num === 2025) {
        return { family: 'ON_PREMISE', version: num };
      }
      // 6. Generic cloud versions (2200-2999)
      if (num >= 2200 && num <= 2999) {
        return { family: 'S4HANA_CLOUD', version: num };
      }
    }

    return { family: 'UNKNOWN', version: 0 };
  }

  public static validate(
    targetRelease: string,
    validFrom?: string | null,
    validTo?: string | null,
    targetFamily?: string | null,
    evidenceFamily?: string | null
  ): ReleaseAlignmentResult {
    const target = this.parseRelease(targetRelease);

    // Check family consistency across target and evidence
    if (evidenceFamily && targetFamily && !this.isSameFamily(evidenceFamily, targetFamily)) {
      return {
        status: 'FAMILY_MISMATCH',
        isAligned: false,
        penalty: 0.5,
        message: `Evidence release family (${evidenceFamily}) does not match target family (${targetFamily}).`,
      };
    }

    if (validFrom) {
      const from = this.parseRelease(validFrom);
      if (this.isSameFamily(target.family, from.family) && target.version < from.version) {
        return {
          status: 'RELEASE_PREMATURE',
          isAligned: false,
          penalty: 0.0,
          message: `Feature requires release >= ${validFrom}, but target is ${targetRelease}.`,
        };
      }
    }

    if (validTo) {
      const to = this.parseRelease(validTo);
      if (this.isSameFamily(target.family, to.family) && target.version > to.version) {
        return {
          status: 'RELEASE_DEPRECATED',
          isAligned: false,
          penalty: 0.0,
          message: `Feature was deprecated or removed after release ${validTo}. Target is ${targetRelease}.`,
        };
      }
    }

    return {
      status: 'RELEASE_ALIGNED',
      isAligned: true,
      penalty: 1.0,
      message: 'Evidence is release-aligned.',
    };
  }
}
```

In `packages/evidence/src/release_validator.ts`:
```typescript
export * from './release-alignment';
```
In `packages/evidence/src/index.ts`:
```typescript
export * from './hashing';
export * from './classifier';
export * from './chain';
export * from './canonical_json';
export * from './offsets';
export * from './trust-score';
export * from './release_validator';
export * from './release-alignment';
```

### 4.3 Python Implementation: `services/analysis-python/src/platform/evidence.py`
**Path**: `H:/erppreflight/services/analysis-python/src/platform/evidence.py`

Update `ReleaseAlignmentValidator`:
```python
class ReleaseAlignmentValidator:
    """Validates release compatibility of evidence against target preflight release."""

    CLOUD_YYMM_REGEX = re.compile(r"^(2[0-9])(0[1-9]|1[0-2])$")
    CLOUD_FAMILIES = {"CLOUD", "S4HANA_CLOUD"}

    @classmethod
    def _is_same_family(cls, fam_a: Optional[str], fam_b: Optional[str]) -> bool:
        if not fam_a or not fam_b:
            return False
        if fam_a == fam_b:
            return True
        return fam_a in cls.CLOUD_FAMILIES and fam_b in cls.CLOUD_FAMILIES

    @classmethod
    def _parse_release(cls, rel: str) -> Tuple[str, int]:
        clean = rel.strip().upper()
        if clean.startswith("S4HC_") or clean.startswith("S4HANA_CLOUD_"):
            digits = re.sub(r"[^0-9]", "", clean)
            return ("S4HANA_CLOUD", int(digits) if digits else 0)
        if clean.startswith("S4H_") or clean.startswith("S4_") or clean.startswith("S4HANA_"):
            digits = re.sub(r"[^0-9]", "", clean)
            return ("ON_PREMISE", int(digits) if digits else 0)
        if clean.startswith("ECC"):
            return ("ECC", 600)

        digits = re.sub(r"[^0-9]", "", clean)

        # Match exact S/4HANA Cloud YYMM releases: 2308, 2402, 2408, 2502
        if cls.CLOUD_YYMM_REGEX.match(clean) or (digits and cls.CLOUD_YYMM_REGEX.match(digits)):
            return ("S4HANA_CLOUD", int(digits) if digits else 0)

        num = int(digits) if digits else 0
        if (1500 <= num <= 2100) or num == 2025:
            return ("ON_PREMISE", num)
        if 2200 <= num <= 2999:
            return ("S4HANA_CLOUD", num)
        return ("UNKNOWN", num)

    @classmethod
    def validate(
        cls,
        target_release: str,
        valid_from: Optional[str] = None,
        valid_to: Optional[str] = None,
        target_family: Optional[str] = None,
        evidence_family: Optional[str] = None,
    ) -> ReleaseAlignmentResult:
        if evidence_family and target_family and not cls._is_same_family(evidence_family, target_family):
            return ReleaseAlignmentResult(
                status="FAMILY_MISMATCH",
                is_aligned=False,
                penalty=0.50,
                message=f"Evidence from {evidence_family} does not apply to {target_family}.",
            )

        target_fam, target_ver = cls._parse_release(target_release)

        if valid_from:
            from_fam, from_ver = cls._parse_release(valid_from)
            if cls._is_same_family(target_fam, from_fam) and target_ver < from_ver:
                return ReleaseAlignmentResult(
                    status="RELEASE_PREMATURE",
                    is_aligned=False,
                    penalty=0.0,
                    message=f"Feature requires release >= {valid_from}, but target is {target_release}.",
                )

        if valid_to:
            to_fam, to_ver = cls._parse_release(valid_to)
            if cls._is_same_family(target_fam, to_fam) and target_ver > to_ver:
                return ReleaseAlignmentResult(
                    status="RELEASE_DEPRECATED",
                    is_aligned=False,
                    penalty=0.0,
                    message=f"Feature was deprecated or removed after release {valid_to}. Target: {target_release}.",
                )

        return ReleaseAlignmentResult(
            status="RELEASE_ALIGNED",
            is_aligned=True,
            penalty=1.00,
            message="Evidence is release-aligned.",
        )
```

---

## 5. Test Suite Updates & Regression Prevention

### 5.1 Python Adversarial Suite: `services/analysis-python/tests/adversarial/test_m2_challenges.py`

Update `test_vulnerability_timestamp_collision_sorting_inversion_hazard` to assert successful remediation via `sequence_num`, and add test for sequence gap detection:

```python
    def test_remediation_timestamp_collision_resolved_by_sequence_num(self):
        """
        REMEDIATION VERIFICATION:
        When multiple events are emitted in the same millisecond, ordering exclusively
        by sequence_num prevents sort inversion and guarantees zero false-positive tamper alerts.
        """
        genesis = "0" * 64
        shared_time = "2026-09-24T03:00:00.000Z"

        # Event A: Larger UUID, but sequence_num = 1
        id_a = "ffffffff-0000-0000-0000-000000000000"
        hash_a = compute_audit_chain_hash(genesis, id_a, "t1", "ACTION_A", shared_time, {})
        ev_a = {
            "id": id_a,
            "sequence_num": 1,
            "organization_id": "t1",
            "action": "ACTION_A",
            "created_at": shared_time,
            "payload": {},
            "prev_hash": genesis,
            "current_hash": hash_a,
        }

        # Event B: Smaller UUID, but sequence_num = 2
        id_b = "00000000-0000-0000-0000-000000000000"
        hash_b = compute_audit_chain_hash(hash_a, id_b, "t1", "ACTION_B", shared_time, {})
        ev_b = {
            "id": id_b,
            "sequence_num": 2,
            "organization_id": "t1",
            "action": "ACTION_B",
            "created_at": shared_time,
            "payload": {},
            "prev_hash": hash_a,
            "current_hash": hash_b,
        }

        # Verify query sorted by sequence_num ASC resolves correctly
        query_result = sorted([ev_b, ev_a], key=lambda x: x["sequence_num"])
        assert query_result[0]["id"] == id_a
        assert query_result[1]["id"] == id_b

        # Ledger verification succeeds with 0 anomalies
        res = AuditTrailLedger.verify_ledger(query_result)
        assert res.is_valid is True
        assert res.total_events_verified == 2
        assert len(res.anomalies) == 0

    def test_audit_ledger_sequence_gap_detection(self):
        """Detects deleted or missing audit events via sequence_num gaps."""
        genesis = "0" * 64
        t0 = "2026-09-24T03:00:00.000Z"
        t1 = "2026-09-24T03:01:00.000Z"

        id1 = "11111111-1111-1111-1111-111111111111"
        h1 = compute_audit_chain_hash(genesis, id1, "t1", "ACT_1", t0, {})
        ev1 = {"id": id1, "sequence_num": 1, "organization_id": "t1", "action": "ACT_1", "created_at": t0, "payload": {}, "prev_hash": genesis, "current_hash": h1}

        # Event 2 was deleted! Event 3 has sequence_num = 3 and links to h1
        id3 = "33333333-3333-3333-3333-333333333333"
        h3 = compute_audit_chain_hash(h1, id3, "t1", "ACT_3", t1, {})
        ev3 = {"id": id3, "sequence_num": 3, "organization_id": "t1", "action": "ACT_3", "created_at": t1, "payload": {}, "prev_hash": h1, "current_hash": h3}

        res = AuditTrailLedger.verify_ledger([ev1, ev3])
        assert res.is_valid is False
        gaps = [a for a in res.anomalies if a.anomaly_type == "GAP_DETECTED"]
        assert len(gaps) == 1
        assert gaps[0].event_index == 1
        assert gaps[0].expected_value == "2"
        assert gaps[0].actual_value == "3"

    def test_composite_trust_monotonic_booster(self):
        """Corroborating evidence must monotonically boost or maintain trust."""
        single = EvidenceEngine.calculate_composite_trust([0.85])
        assert single == 0.85

        corroborated_2 = EvidenceEngine.calculate_composite_trust([0.85, 0.85])
        assert corroborated_2 > 0.85
        assert corroborated_2 == 0.876

        corroborated_3 = EvidenceEngine.calculate_composite_trust([0.85, 0.85, 0.85])
        assert corroborated_3 > corroborated_2
        assert corroborated_3 == 0.897

        # 1.0 is anchored
        max_anchored = EvidenceEngine.calculate_composite_trust([1.0, 0.85])
        assert max_anchored == 1.0

        # LLM ceiling strictly capped at 0.60
        llm_capped = EvidenceEngine.calculate_composite_trust([0.85, 0.85], is_llm_generated=True)
        assert llm_capped == 0.60

    def test_s4hana_cloud_yymm_regex_classification(self):
        """Releases matching ^(2[0-9])(0[1-9]|1[0-2])$ classify as S4HANA_CLOUD."""
        for rel in ["2308", "2402", "2408", "2502"]:
            fam, ver = ReleaseAlignmentValidator._parse_release(rel)
            assert fam == "S4HANA_CLOUD"
            assert ver == int(rel)

        for rel in ["2020", "2021", "2022", "2023", "2025"]:
            fam, ver = ReleaseAlignmentValidator._parse_release(rel)
            assert fam == "ON_PREMISE"
            assert ver == int(rel)
```

### 5.2 TypeScript Test Suite: `apps/api/test/m2_challenges.spec.ts`

Add verification tests in `apps/api/test/m2_challenges.spec.ts`:

```typescript
    it('REMEDIATED: Audit events with identical timestamps ordered by sequenceNum eliminate false tamper alerts', () => {
      const sharedTime = '2026-09-24T03:00:00.000Z';
      const idA = 'ffffffff-0000-0000-0000-000000000000';
      const hashA = computeAuditChainHash(genesisPrev, idA, tenantId, 'ACT_A', sharedTime, {});

      const evA = {
        id: idA,
        sequenceNum: 1,
        organization_id: tenantId,
        action: 'ACT_A',
        created_at: sharedTime,
        payload: {},
        prev_hash: genesisPrev,
        current_hash: hashA,
      };

      const idB = '00000000-0000-0000-0000-000000000000';
      const hashB = computeAuditChainHash(hashA, idB, tenantId, 'ACT_B', sharedTime, {});

      const evB = {
        id: idB,
        sequenceNum: 2,
        organization_id: tenantId,
        action: 'ACT_B',
        created_at: sharedTime,
        payload: {},
        prev_hash: hashA,
        current_hash: hashB,
      };

      // Even if passed out of order [evB, evA], verifyChain sorts by sequenceNum
      const res = auditService.verifyChain([evB, evA]);
      expect(res.isValid).toBe(true);
      expect(res.totalEventsVerified).toBe(2);
      expect(res.anomalies).toHaveLength(0);
    });

    it('REMEDIATED: Audit trail detects sequence gaps when an event is missing', () => {
      const t0 = '2026-09-24T03:00:00.000Z';
      const t1 = '2026-09-24T03:01:00.000Z';

      const id1 = '11111111-1111-1111-1111-111111111111';
      const h1 = computeAuditChainHash(genesisPrev, id1, tenantId, 'ACT_1', t0, {});
      const ev1 = { id: id1, sequenceNum: 1, organization_id: tenantId, action: 'ACT_1', created_at: t0, payload: {}, prev_hash: genesisPrev, current_hash: h1 };

      const id3 = '33333333-3333-3333-3333-333333333333';
      const h3 = computeAuditChainHash(h1, id3, tenantId, 'ACT_3', t1, {});
      const ev3 = { id: id3, sequenceNum: 3, organization_id: tenantId, action: 'ACT_3', created_at: t1, payload: {}, prev_hash: h1, current_hash: h3 };

      const res = auditService.verifyChain([ev1, ev3]);
      expect(res.isValid).toBe(false);
      const gaps = res.anomalies.filter((a) => a.anomalyType === 'GAP_DETECTED');
      expect(gaps).toHaveLength(1);
      expect(gaps[0].expectedValue).toBe('2');
      expect(gaps[0].actualValue).toBe('3');
    });

    it('REMEDIATED: Composite Trust Accumulator increases score monotonically and bounds properly', () => {
      expect(calculateCompositeTrustScore([{ trustScore: 0.85 }])).toBe(0.85);

      const score2 = calculateCompositeTrustScore([{ trustScore: 0.85 }, { trustScore: 0.85 }]);
      expect(score2).toBe(0.876);
      expect(score2).toBeGreaterThan(0.85);

      const score3 = calculateCompositeTrustScore([{ trustScore: 0.85 }, { trustScore: 0.85 }, { trustScore: 0.85 }]);
      expect(score3).toBe(0.897);
      expect(score3).toBeGreaterThan(score2);

      // LLM ceiling
      const llmScore = calculateCompositeTrustScore([{ trustScore: 0.85 }, { trustScore: 0.85 }], { isLlmGenerated: true });
      expect(llmScore).toBe(0.60);
    });

    it('REMEDIATED: S/4HANA Cloud releases (2308, 2402, 2408) classify as S4HANA_CLOUD and match regex', () => {
      const res2308 = ReleaseAlignmentValidator.parseRelease('2308');
      expect(res2308.family).toBe('S4HANA_CLOUD');
      expect(res2308.version).toBe(2308);

      const res2402 = ReleaseAlignmentValidator.parseRelease('2402');
      expect(res2402.family).toBe('S4HANA_CLOUD');
      expect(res2402.version).toBe(2402);

      const res2023 = ReleaseAlignmentValidator.parseRelease('2023');
      expect(res2023.family).toBe('ON_PREMISE');
      expect(res2023.version).toBe(2023);
    });
```

---

## 6. Implementation Verification Runbook

Once applied by the remediation worker agent, independently verify all components with:

```powershell
# 1. Run Python Unit & Adversarial Tests
py -m pytest services/analysis-python/tests/adversarial/test_m2_challenges.py -v
py -m pytest services/analysis-python/tests -v

# 2. Run TypeScript Backend & Adversarial Tests
cmd.exe /c "set PATH=C:\Users\SKAF\AppData\Roaming\npm;%PATH% && pnpm --filter api test"

# 3. Run Monorepo Build across all 7 packages
cmd.exe /c "set PATH=C:\Users\SKAF\AppData\Roaming\npm;%PATH% && pnpm run build"

# 4. Run E2E Test Suite
py -m pytest tests/e2e/ -v
```
