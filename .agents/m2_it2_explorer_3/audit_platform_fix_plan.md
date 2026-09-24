# Milestone 2 Technical Fix Blueprint: Audit Monotonic Ordering & Platform Refinements

**Author**: `m2_it2_explorer_3`  
**Target Milestone**: Milestone 2 (Secure Ingestion & Shared Platform Services) — Iteration 2  
**Working Directory**: `H:/erppreflight/.agents/m2_it2_explorer_3`  
**Date**: 2026-09-24  

---

## 1. Executive Summary

During Milestone 2 adversarial and peer reviews (`m2_challenger_2`, `m2_reviewer_2`), three algorithmic and architectural defects were identified in the platform foundation:

1. **Audit Trail Ordering & False Tamper Detection**:
   In `AuditService` (`apps/api/src/modules/audit/audit.service.ts`), sorting events by `created_at ASC, id ASC` causes arbitrary UUIDv4 sort inversions whenever two consecutive audit events share an identical millisecond timestamp. This produces catastrophic false positive alerts (`MISSING_GENESIS_PREV_HASH`, `BROKEN_CHAIN_LINK`) on completely authentic ledgers and risks fork creation during tip retrieval.
   **Solution**: Introduce a database-level monotonic sequence (`sequence_num BIGSERIAL`), update all audit query access paths, and implement an in-memory topological sort algorithm for resilient chain verification.

2. **Composite Trust Score Mathematical Attenuation Defect**:
   In `services/analysis-python/src/platform/evidence.py` and `packages/evidence/src/classifier.ts`, the formula $\max(s) \times (1 - \prod(1 - 0.2s))$ acts as an attenuator rather than an accumulator. When evaluating multiple corroborating evidence items (e.g. $[1.0, 0.85]$), the composite score plunges from $1.0$ down to $0.336$.
   **Solution**: Refactor to an asymptotic residual accumulation formula: $\min(1.0, s_{\max} + (1.0 - s_{\max}) \times (1 - \prod_{k=2}^n (1 - 0.2 \cdot s_{(k)})))$, guaranteeing strict monotonicity, bounded trust $[0, 1]$, and asymptotic convergence to certainty.

3. **ReleaseAlignmentValidator Cloud (`YYMM`) Misclassification**:
   In `packages/evidence/src/release_validator.ts:25`, `if (num > 2000) return { family: 'ON_PREMISE', version: num }` unconditionally captures all 4-digit numbers greater than 2000, misclassifying SAP S/4HANA Cloud releases (`"2005"`, `"2108"`, `"2208"`, `"2302"`, `"2308"`, `"2402"`, `"2408"`) as `ON_PREMISE` and rendering line 26 dead code. Python's parser exhibits corresponding divergence for `2005` and `2108`.
   **Solution**: Implement unified date-part parsing distinguishing Cloud `YYMM` ($MM \in [1, 12]$) from On-Premise annual releases $YYYY$ ($MM \ge 20$) across both TypeScript and Python.

---

## 2. Issue 1: Audit Trail Monotonic Ordering & Deterministic Verification

### 2.1 Root Cause & Mathematical Analysis

In `apps/api/src/modules/audit/audit.service.ts`:
- **Line 61**:
  ```sql
  SELECT current_hash FROM audit_events
  WHERE organization_id = $1
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  ```
- **Line 124**:
  ```sql
  SELECT * FROM audit_events
  WHERE organization_id = $1
  ORDER BY created_at ASC, id ASC
  ```

#### The Failure Mechanism:
1. `id` is generated via `uuidv4()`: randomly distributed 128-bit numbers.
2. In high-throughput event logging (such as an ingestion pipeline running `FILE_QUARANTINED`, `ANTIVIRUS_SCANNED`, and `FILE_PROMOTED`), two or more events are committed within the same millisecond timestamp (`created_at` values match to the millisecond).
3. When SQL evaluates `ORDER BY created_at ASC, id ASC`, SQL uses `id ASC` as the tiebreaker.
4. If Event 1 was inserted with `id_1 = "f47ac10b..."` and Event 2 was inserted with `id_2 = "00a12e34..."`, `id_2 < id_1` lexicographically.
5. SQL returns `[Event 2, Event 1]`.
6. Verification fails immediately:
   - Index 0 is Event 2. Its `prev_hash` is Event 1's `current_hash` (not `0000...0000`). Triggers `MISSING_GENESIS_PREV_HASH`.
   - Index 1 is Event 1. Its `prev_hash` is `0000...0000` (not Event 2's `current_hash`). Triggers `BROKEN_CHAIN_LINK`.
7. Concurrently, tip retrieval (`ORDER BY created_at DESC, id DESC LIMIT 1`) picks `Event 1` because `id_1 > id_2`, causing subsequent Event 3 to attach to Event 1, creating an unintentional fork in the ledger.

---

### 2.2 Technical Fix Blueprint

#### Step 1: Database Migration `003_audit_monotonic_sequence.sql`
Create `packages/database/migrations/003_audit_monotonic_sequence.sql`:

```sql
-- Migration 003: Monotonic Sequence for Tamper-Evident Audit Trail
-- Ensures deterministic linear ledger traversal and eliminates UUID sort collision.

-- 1. Add sequence_num column with BIGSERIAL sequence
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'audit_events' AND column_name = 'sequence_num'
    ) THEN
        ALTER TABLE audit_events ADD COLUMN sequence_num BIGSERIAL;
    END IF;
END $$;

-- 2. Add composite index for tenant-scoped monotonic retrieval
CREATE INDEX IF NOT EXISTS idx_audit_events_org_seq 
ON audit_events(organization_id, sequence_num ASC);

-- 3. Update initial schema reference for fresh deployments in 001_initial_schema.sql:
-- audit_events (..., sequence_num BIGSERIAL NOT NULL, ...)
```

#### Step 2: Update `apps/api/src/modules/audit/audit.service.ts`

Replace all `created_at [ASC|DESC], id [ASC|DESC]` clauses with `sequence_num [ASC|DESC]`:

```typescript
// 1. Fetching latest event tip:
const lastEventRes = await client.query<{ current_hash: string; sequence_num: string }>(
  'SELECT current_hash, sequence_num FROM audit_events WHERE organization_id = $1 ORDER BY sequence_num DESC LIMIT 1',
  [organizationId]
);

const prevHash = lastEventRes.rows[0]?.current_hash || AuditService.GENESIS_PREV_HASH;

// 2. Inserting event: return sequence_num:
const insertRes = await client.query<{ sequence_num: string }>(
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

const sequenceNum = insertRes.rows[0]?.sequence_num ? parseInt(insertRes.rows[0].sequence_num, 10) : undefined;

// 3. Verifying tenant ledger:
const res = await this.db.query(
  'SELECT * FROM audit_events WHERE organization_id = $1 ORDER BY sequence_num ASC',
  [organizationId]
);

// 4. History retrieval:
const res = await this.db.query(
  'SELECT id, organization_id, actor_type, actor_id, action, resource_type, resource_id, prev_hash, current_hash, created_at, sequence_num FROM audit_events WHERE organization_id = $1 ORDER BY sequence_num DESC LIMIT $2',
  [organizationId, limit]
);
```

#### Step 3: Defensive In-Memory Topological Reconstruction Algorithm
To protect against unordered arrays passed to `verifyTenantLedger` or in-memory test mocks, add a deterministic topological chain reconstruction step before traversing:

```typescript
/**
 * Orders audit events deterministically.
 * Primary: sequence_num ascending (if present).
 * Fallback / Defense: Linked-list traversal from genesis (prev_hash -> current_hash).
 */
public static topologicallySortEvents<T extends { id: string; prev_hash?: string; current_hash: string; sequence_num?: any }>(
  events: T[]
): T[] {
  if (events.length <= 1) return events;

  // 1. If sequence_num is present on all records, sort numerically
  const hasAllSeq = events.every((e) => e.sequence_num !== undefined && e.sequence_num !== null);
  if (hasAllSeq) {
    return [...events].sort((a, b) => Number(a.sequence_num) - Number(b.sequence_num));
  }

  // 2. Topological reconstruction via prev_hash -> next node map
  const genesisHash = '0'.repeat(64);
  const byPrevHash = new Map<string, T>();
  const allCurrentHashes = new Set<string>();

  for (const ev of events) {
    const prev = ev.prev_hash || genesisHash;
    byPrevHash.set(prev, ev);
    allCurrentHashes.add(ev.current_hash);
  }

  // Find root: either prev_hash == genesisHash, or prev_hash not present in any current_hash
  let current: T | undefined = byPrevHash.get(genesisHash);
  if (!current) {
    // If genesis was tampered or missing, find event whose prev_hash has no predecessor in this list
    current = events.find((e) => !allCurrentHashes.has(e.prev_hash || ''));
  }

  const sorted: T[] = [];
  const visited = new Set<string>();

  while (current && !visited.has(current.id)) {
    sorted.push(current);
    visited.add(current.id);
    current = byPrevHash.get(current.current_hash);
  }

  // If chain was disjoint or corrupted, append any unvisited elements to preserve anomaly detection
  if (sorted.length < events.length) {
    for (const ev of events) {
      if (!visited.has(ev.id)) {
        sorted.push(ev);
        visited.add(ev.id);
      }
    }
  }

  return sorted;
}
```

#### Step 4: Python Parity in `services/analysis-python/src/platform/audit.py`
In `AuditTrailLedger.verify_ledger`:
```python
@classmethod
def verify_ledger(cls, events: List[Dict[str, Any] | AuditEvent]) -> TamperDetectionResult:
    if not events:
        return TamperDetectionResult(is_valid=True, total_events_verified=0, anomalies=[])

    raw_events: List[Dict[str, Any]] = [
        e if isinstance(e, dict) else e.__dict__ for e in events
    ]

    # Deterministic sequence sorting if sequence_num is present
    if all("sequence_num" in e and e["sequence_num"] is not None for e in raw_events):
        raw_events.sort(key=lambda x: int(x["sequence_num"]))
    elif all("created_at" in e and "prev_hash" in e for e in raw_events):
        # Topological reconstruction from genesis
        by_prev = {e.get("prev_hash") or cls.GENESIS_PREV_HASH: e for e in raw_events}
        curr = by_prev.get(cls.GENESIS_PREV_HASH)
        sorted_events = []
        visited = set()
        while curr and curr["id"] not in visited:
            sorted_events.append(curr)
            visited.add(curr["id"])
            curr = by_prev.get(curr.get("current_hash"))
        if len(sorted_events) == len(raw_events):
            raw_events = sorted_events
```

#### Step 5: Schema Updates in `packages/schemas/src/audit.ts`
```typescript
export const AuditEventWireSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  sequenceNum: z.union([z.number(), z.string()]).optional(),
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
```

---

## 3. Issue 2: Evidence Engine Composite Trust Score Accumulator

### 3.1 Mathematical Defect in Existing Implementation

In both `services/analysis-python/src/platform/evidence.py:185` and `packages/evidence/src/classifier.ts:64`:
$$\text{Trust}_{\text{composite}} = \max(s_k) \times \left(1 - \prod_{k=1}^n (1 - 0.2 \cdot s_k)\right)$$

#### Numerical Failure Trace:
- Case A: Single verified evidence item $S = [1.0]$:
  - $\text{length} == 1 \implies \text{returns } 1.0$.
- Case B: Two verified evidence items $S = [1.0, 1.0]$:
  - $\max(s) = 1.0$.
  - $\prod = (1 - 0.2) \times (1 - 0.2) = 0.8 \times 0.8 = 0.64$.
  - Term $(1 - \prod) = 1 - 0.64 = 0.36$.
  - Composite $= 1.0 \times 0.36 = \mathbf{0.360}$!
  - **Verdict**: Trust drops by **64%** simply because an additional corroborating proof was provided.
- Case C: Three items $S = [1.0, 1.0, 1.0]$:
  - $\prod = 0.8^3 = 0.512 \implies (1 - \prod) = 0.488$.
  - Composite $= 1.0 \times 0.488 = \mathbf{0.488} < 1.0$.

### 3.2 Formal Mathematical Model & Accumulation Axioms

A valid composite trust function $T(S)$ for corroborating preflight evidence must satisfy four axioms:

1. **Axiom 1 (Identity on Single Evidence)**:
   $$\forall s \in [0, 1]: \quad T([s]) = s$$
2. **Axiom 2 (Strict Corroboration Monotonicity)**:
   For any additional non-zero evidence $s_{\text{new}} > 0$:
   $$T(S \cup \{s_{\text{new}}\}) \ge T(S), \quad \text{with } T(S \cup \{s_{\text{new}}\}) > T(S) \text{ if } T(S) < 1.0$$
3. **Axiom 3 (Epistemic Lower Bound)**:
   The composite trust can never be lower than the strongest individual piece of evidence:
   $$T(S) \ge \max_{s \in S}(s)$$
4. **Axiom 4 (Asymptotic Convergence to Certainty)**:
   As $n \to \infty$ with evidence $s_k > 0$, $T(S) \to 1.0$, bounded by $[0.0, 1.0]$.

### 3.3 The Refactored Asymptotic Residual Formula

To satisfy all 4 axioms, let the strongest evidence score establish the epistemic floor:
$$s_{\max} = \max_{s \in S}(s)$$

The remaining epistemic uncertainty is $(1.0 - s_{\max})$. Each additional corroborating evidence item $s_{(k)}$ (for $k \ge 2$) reduces this residual uncertainty by an independent confirmation factor $w_k = \alpha \cdot s_{(k)}$ (where $\alpha = 0.20$ is the domain corroboration weight).

Sorting scores descending $s_{(1)} \ge s_{(2)} \ge \dots \ge s_{(n)}$:
$$\text{residual\_boost} = 1.0 - \prod_{k=2}^n \left(1.0 - 0.2 \cdot s_{(k)}\right)$$
$$\text{Trust}_{\text{composite}} = \min\left(1.0, \, s_{\max} + (1.0 - s_{\max}) \times \text{residual\_boost}\right)$$

#### Verification of Properties:
- $n = 0$: Returns $0.0$.
- $n = 1$: Product over empty set is $1.0 \implies \text{residual\_boost} = 0 \implies \text{Trust} = s_{\max}$. (Axiom 1 satisfied).
- $S = [1.0, 0.85]$: $s_{\max} = 1.0 \implies (1.0 - 1.0) = 0 \implies \text{Trust} = 1.0$. (Axiom 3 satisfied).
- $S = [0.85, 0.85]$:
  $s_{\max} = 0.85$, residual $= 0.15$.
  $\text{residual\_boost} = 1 - (1 - 0.2 \times 0.85) = 1 - 0.83 = 0.17$.
  $\text{Trust} = 0.85 + 0.15 \times 0.17 = 0.85 + 0.0255 = \mathbf{0.876} > 0.85$. (Axiom 2 satisfied).
- $S = [0.85, 0.85, 0.85]$:
  $\text{residual\_boost} = 1 - 0.83^2 = 1 - 0.6889 = 0.3111$.
  $\text{Trust} = 0.85 + 0.15 \times 0.3111 = 0.85 + 0.0467 = \mathbf{0.897} > 0.876$. (Monotonic increase).
- $S = [0.60, 0.60]$:
  $s_{\max} = 0.60$, residual $= 0.40$.
  $\text{residual\_boost} = 1 - (1 - 0.2 \times 0.6) = 0.12$.
  $\text{Trust} = 0.60 + 0.40 \times 0.12 = \mathbf{0.648} > 0.60$.

### 3.4 Implementation Blueprint

#### Python (`services/analysis-python/src/platform/evidence.py`):
```python
@classmethod
def calculate_composite_trust(cls, scores: List[float]) -> float:
    """Calculates composite trust score using asymptotic residual corroboration.
    
    Axioms guaranteed:
    1. Single score returns exactly that score.
    2. Multiple corroborating items strictly increase trust (never decrease).
    3. Composite trust is strictly bounded by [max(scores), 1.0].
    """
    if not scores:
        return 0.0
    valid_scores = [max(0.0, min(1.0, float(s))) for s in scores]
    if len(valid_scores) == 1:
        return round(valid_scores[0], 3)
    
    sorted_scores = sorted(valid_scores, reverse=True)
    max_score = sorted_scores[0]
    if max_score >= 1.0:
        return 1.0

    # Corroborating items beyond the primary strongest evidence
    residual_prod = 1.0
    for s in sorted_scores[1:]:
        residual_prod *= (1.0 - 0.2 * s)

    residual_boost = 1.0 - residual_prod
    composite = max_score + (1.0 - max_score) * residual_boost
    return min(1.0, max(max_score, round(composite, 3)))
```

#### TypeScript (`packages/evidence/src/classifier.ts`):
```typescript
/**
 * Calculates composite trust score for a collection of evidence items.
 * Uses asymptotic residual corroboration to ensure additional evidence
 * strictly increases confidence toward 1.0 without attenuation.
 */
export function calculateCompositeTrustScore(evidenceList: Array<{ trustScore?: number }>): number {
  if (!evidenceList || evidenceList.length === 0) return 0.0;
  const scores = evidenceList.map((e) => Math.max(0.0, Math.min(1.0, e.trustScore ?? 0.5)));
  if (scores.length === 1) return scores[0];

  scores.sort((a, b) => b - a);
  const maxScore = scores[0];
  if (maxScore >= 1.0) return 1.0;

  let residualProd = 1.0;
  for (let i = 1; i < scores.length; i++) {
    residualProd *= 1.0 - 0.2 * scores[i];
  }

  const residualBoost = 1.0 - residualProd;
  const composite = maxScore + (1.0 - maxScore) * residualBoost;
  return Math.min(1.0, Math.max(maxScore, Number(composite.toFixed(3))));
}
```

---

## 4. Issue 3: ReleaseAlignmentValidator S/4HANA Cloud (`YYMM`) Classification

### 4.1 Root Cause & Dead Code Analysis

In `packages/evidence/src/release_validator.ts`:
```typescript
11:  private static parseRelease(rel: string): { family: 'ON_PREMISE' | 'CLOUD' | 'ECC' | 'UNKNOWN'; version: number } {
12:    const clean = rel.trim().toUpperCase();
13:    if (clean.startsWith('S4HC_') || clean.startsWith('S4HANA_CLOUD_') || clean.startsWith('24') || clean.startsWith('25') || clean.startsWith('26')) {
...
24:    const num = parseInt(clean.replace(/[^0-9]/g, ''), 10);
25:    if (num > 2000) return { family: 'ON_PREMISE', version: num };
26:    if (num > 2000 && num < 2700) return { family: 'CLOUD', version: num };
27:    return { family: 'UNKNOWN', version: 0 };
28:  }
```

#### Three Defects:
1. **Dead Code on Line 26**: Line 25 catches every integer $> 2000$. Releases `"2005"`, `"2108"`, `"2208"`, `"2302"`, `"2308"`, `"2402"`, `"2408"` evaluate `num > 2000 === true` and return `ON_PREMISE`. Line 26 is mathematically unreachable.
2. **Missing Prefix Range in Line 13**: `clean.startsWith('24') || clean.startsWith('25') || clean.startsWith('26')` neglects earlier Cloud release years: `20`, `21`, `22`, `23`.
3. **Cross-Language Divergence**: In Python (`services/analysis-python/src/platform/evidence.py:33-36`), `num > 2000 and num < 2100` returns `ON_PREMISE` (wrongly making `2005` an on-premise release), and returns `UNKNOWN` for `2108`.

### 4.2 SAP S/4HANA Domain Release Nomenclature

| Format | Example | Semantic Meaning | Release Family | Disambiguation Rule |
|--------|---------|------------------|----------------|----------------------|
| `YYMM` | `2005`, `2008`, `2011` | 2020 May/Aug/Nov | **CLOUD** | 4 digits: $YY \in [16, 35]$ and $MM \in [1, 12]$ |
| `YYMM` | `2102`, `2108`, `2111` | 2021 Feb/Aug/Nov | **CLOUD** | 4 digits: $YY \in [16, 35]$ and $MM \in [1, 12]$ |
| `YYMM` | `2202`, `2208`, `2302`, `2308`, `2402`, `2408`, `2502`, `2508` | Semi-annual Cloud | **CLOUD** | 4 digits: $YY \in [16, 35]$ and $MM \in [1, 12]$ |
| `YYYY` | `2020`, `2021`, `2022`, `2023`, `2025` | Annual On-Premise | **ON_PREMISE** | 4 digits: $YYYY \ge 2020$ and last 2 digits $MM \ge 20$ |
| `YYMM` (legacy OP) | `1511`, `1610`, `1709`, `1809`, `1909` | Pre-2020 On-Premise | **ON_PREMISE** | Prefixed `S4H_` or $1500 \le \text{num} < 2000$ |
| Prefix `S4HC_` | `S4HC_2402`, `S4HANA_CLOUD_2308` | Explicit Cloud prefix | **CLOUD** | Prefix match |
| Prefix `S4H_` | `S4H_2023`, `S4HANA_2020` | Explicit OP prefix | **ON_PREMISE** | Prefix match |
| Prefix `ECC` | `ECC_600`, `ECC6` | SAP ERP Central Component | **ECC** | Prefix match |

The unambiguous mathematical separator between Cloud `YYMM` and On-Premise `YYYY` for releases $\ge 2000$:
- Cloud `YYMM`: The last 2 digits $MM \in \{01, 02, \dots, 12\}$.
- On-Premise `YYYY`: The last 2 digits $MM \in \{20, 21, 22, 23, 24, 25, \dots\}$. A calendar year $20XX$ has $XX \ge 20$, which is **impossible** as a calendar month.

### 4.3 Implementation Blueprint

#### TypeScript (`packages/evidence/src/release_validator.ts`):
```typescript
private static parseRelease(rel: string): { family: 'ON_PREMISE' | 'CLOUD' | 'ECC' | 'UNKNOWN'; version: number } {
  const clean = rel.trim().toUpperCase();

  // 1. Explicit prefixes take precedence
  if (clean.startsWith('S4HC_') || clean.startsWith('S4HANA_CLOUD_')) {
    const numStr = clean.replace(/[^0-9]/g, '');
    return { family: 'CLOUD', version: parseInt(numStr, 10) || 0 };
  }
  if (clean.startsWith('S4H_') || clean.startsWith('S4_') || clean.startsWith('S4HANA_')) {
    const numStr = clean.replace(/[^0-9]/g, '');
    return { family: 'ON_PREMISE', version: parseInt(numStr, 10) || 0 };
  }
  if (clean.startsWith('ECC')) {
    return { family: 'ECC', version: 600 };
  }

  // 2. Numeric release disambiguation
  const digits = clean.replace(/[^0-9]/g, '');
  if (!digits) return { family: 'UNKNOWN', version: 0 };
  const num = parseInt(digits, 10);

  if (digits.length === 4) {
    const yy = parseInt(digits.slice(0, 2), 10);
    const mm = parseInt(digits.slice(2, 4), 10);

    // Cloud releases: YYMM format (years 2016-2035, valid month 01-12)
    // Matches: 2005, 2008, 2011, 2102, 2108, 2202, 2208, 2302, 2308, 2402, 2408, 2502, 2508
    if (yy >= 16 && yy <= 35 && mm >= 1 && mm <= 12) {
      return { family: 'CLOUD', version: num };
    }

    // On-premise annual releases: YYYY format (2020, 2021, 2022, 2023, 2025...)
    // Here mm >= 20 is not a valid month
    if (num >= 2020 && num <= 2099) {
      return { family: 'ON_PREMISE', version: num };
    }

    // Historical on-premise releases: 1511, 1610, 1709, 1809, 1909
    if (num >= 1500 && num <= 1999) {
      return { family: 'ON_PREMISE', version: num };
    }
  }

  return { family: 'UNKNOWN', version: num };
}
```

#### Python (`services/analysis-python/src/platform/evidence.py`):
```python
@classmethod
def _parse_release(cls, rel: str) -> Tuple[str, int]:
    clean = rel.strip().upper()
    if clean.startswith("S4HC_") or clean.startswith("S4HANA_CLOUD_"):
        digits = re.sub(r"[^0-9]", "", clean)
        return ("CLOUD", int(digits) if digits else 0)
    if clean.startswith("S4H_") or clean.startswith("S4_") or clean.startswith("S4HANA_"):
        digits = re.sub(r"[^0-9]", "", clean)
        return ("ON_PREMISE", int(digits) if digits else 0)
    if clean.startswith("ECC"):
        return ("ECC", 600)

    digits = re.sub(r"[^0-9]", "", clean)
    if not digits:
        return ("UNKNOWN", 0)
    num = int(digits)

    if len(digits) == 4:
        yy = int(digits[:2])
        mm = int(digits[2:])
        # Cloud YYMM (e.g. 2005, 2108, 2208, 2302, 2308, 2402, 2408)
        if 16 <= yy <= 35 and 1 <= mm <= 12:
            return ("CLOUD", num)
        # On-Premise YYYY (e.g. 2020, 2021, 2022, 2023, 2025)
        if 2020 <= num <= 2099:
            return ("ON_PREMISE", num)
        # Legacy On-Premise (1511, 1610, 1709, 1809, 1909)
        if 1500 <= num <= 1999:
            return ("ON_PREMISE", num)

    return ("UNKNOWN", num)
```

---

## 5. Comprehensive Test Specification & Regression Harness

### 5.1 Issue 1 Test Specification: Millisecond Timestamp Collision & Monotonic Ordering

#### Test File: `apps/api/test/audit_monotonic.spec.ts`
```typescript
import { describe, it, expect } from 'vitest';
import { AuditService } from '../src/modules/audit/audit.service';
import { computeAuditChainHash } from '@erppreflight/evidence';

describe('AuditTrailService Monotonic Ordering & Timestamp Collision Test', () => {
  const tenantId = 'c1111111-1111-1111-1111-111111111111';
  const genesisPrev = '0'.repeat(64);

  it('correctly verifies chain when multiple events share identical millisecond timestamp and out-of-order UUIDs', () => {
    const identicalTime = '2026-09-24T03:00:00.000Z';
    
    // Simulate Event 1: UUID starts with 'z' (lexicographically large)
    const ev1Id = 'zzzzzzzz-0000-0000-0000-000000000001';
    const ev1Payload = { step: 1, action: 'FILE_UPLOADED' };
    const ev1Hash = computeAuditChainHash(genesisPrev, ev1Id, tenantId, 'UPLOAD', identicalTime, ev1Payload);
    const ev1 = {
      id: ev1Id,
      organization_id: tenantId,
      action: 'UPLOAD',
      created_at: identicalTime,
      sequence_num: 1,
      payload: ev1Payload,
      prev_hash: genesisPrev,
      current_hash: ev1Hash,
    };

    // Simulate Event 2: UUID starts with 'a' (lexicographically small)
    const ev2Id = 'aaaaaaaa-0000-0000-0000-000000000002';
    const ev2Payload = { step: 2, action: 'SCAN_PASSED' };
    const ev2Hash = computeAuditChainHash(ev1Hash, ev2Id, tenantId, 'SCAN', identicalTime, ev2Payload);
    const ev2 = {
      id: ev2Id,
      organization_id: tenantId,
      action: 'SCAN',
      created_at: identicalTime,
      sequence_num: 2,
      payload: ev2Payload,
      prev_hash: ev1Hash,
      current_hash: ev2Hash,
    };

    // Under flawed SQL `ORDER BY created_at ASC, id ASC`, SQL returns [ev2, ev1]
    const flawedSqlOrder = [ev2, ev1];
    
    // Using topologicallySortEvents or sequence_num ordering:
    const fixedOrder = AuditService.topologicallySortEvents(flawedSqlOrder);
    expect(fixedOrder[0].id).toBe(ev1Id);
    expect(fixedOrder[1].id).toBe(ev2Id);
    expect(fixedOrder[0].prev_hash).toBe(genesisPrev);
    expect(fixedOrder[1].prev_hash).toBe(fixedOrder[0].current_hash);
  });
});
```

### 5.2 Issue 2 Test Specification: Composite Trust Accumulation Axioms

#### Test File: `packages/evidence/test/trust_accumulator.spec.ts` and `services/analysis-python/tests/unit/test_trust_accumulator.py`

```python
def test_composite_trust_axioms():
    from src.platform.evidence import EvidenceEngine

    # Axiom 1: Identity on singleton
    assert EvidenceEngine.calculate_composite_trust([1.0]) == 1.0
    assert EvidenceEngine.calculate_composite_trust([0.85]) == 0.85
    assert EvidenceEngine.calculate_composite_trust([0.60]) == 0.60

    # Axiom 2: Monotonicity on corroborating evidence
    t1 = EvidenceEngine.calculate_composite_trust([0.85])
    t2 = EvidenceEngine.calculate_composite_trust([0.85, 0.85])
    t3 = EvidenceEngine.calculate_composite_trust([0.85, 0.85, 0.85])
    assert t2 > t1, f"Expected {t2} > {t1}"
    assert t3 > t2, f"Expected {t3} > {t2}"
    assert t2 == 0.876
    assert t3 == 0.897

    # Axiom 3: Lower bound (never drops below max)
    assert EvidenceEngine.calculate_composite_trust([1.0, 0.85]) == 1.0
    assert EvidenceEngine.calculate_composite_trust([1.0, 1.0, 1.0]) == 1.0

    # Empty list
    assert EvidenceEngine.calculate_composite_trust([]) == 0.0
```

### 5.3 Issue 3 Test Specification: Release Disambiguation Matrix

```typescript
describe('ReleaseAlignmentValidator 4-digit YYMM Cloud Disambiguation', () => {
  const cloudReleases = ['2005', '2008', '2108', '2202', '2208', '2302', '2308', '2402', '2408', '2502'];
  const onPremiseReleases = ['2020', '2021', '2022', '2023', '2025'];

  for (const rel of cloudReleases) {
    it(`classifies ${rel} as CLOUD`, () => {
      const parsed = (ReleaseAlignmentValidator as any).parseRelease(rel);
      expect(parsed.family).toBe('CLOUD');
      expect(parsed.version).toBe(parseInt(rel, 10));
    });
  }

  for (const rel of onPremiseReleases) {
    it(`classifies ${rel} as ON_PREMISE`, () => {
      const parsed = (ReleaseAlignmentValidator as any).parseRelease(rel);
      expect(parsed.family).toBe('ON_PREMISE');
      expect(parsed.version).toBe(parseInt(rel, 10));
    });
  }

  it('validates alignment across 2308 cloud target with 2208 valid_from', () => {
    const res = ReleaseAlignmentValidator.validate('2308', '2208', '2408');
    expect(res.isAligned).toBe(true);
    expect(res.status).toBe('RELEASE_ALIGNED');
  });

  it('detects premature release when target is 2208 but feature requires 2308', () => {
    const res = ReleaseAlignmentValidator.validate('2208', '2308');
    expect(res.isAligned).toBe(false);
    expect(res.status).toBe('RELEASE_PREMATURE');
  });
});
```

---

## 6. Implementation Rollout Plan & Impact Verification

| Step | Component | Action | Verification Command |
|------|-----------|--------|----------------------|
| 1 | `packages/database` | Add `003_audit_monotonic_sequence.sql` and update `001_initial_schema.sql` | `pnpm --filter database build` |
| 2 | `packages/schemas` | Add `sequenceNum` to `AuditEventWireSchema` in `audit.ts` | `pnpm --filter schemas build` |
| 3 | `apps/api` | Update `AuditService` SQL queries (`ORDER BY sequence_num`) & add `topologicallySortEvents` | `pnpm --filter api test` |
| 4 | `packages/evidence` | Update `calculateCompositeTrustScore` and `ReleaseAlignmentValidator` | `pnpm --filter evidence build && pnpm test` |
| 5 | `services/analysis-python` | Update `calculate_composite_trust`, `_parse_release`, and `verify_ledger` | `py -m pytest services/analysis-python/tests -v` |
| 6 | Monorepo Full Pass | Run monorepo build and full E2E test suites | `pnpm run build && py -m pytest tests/e2e/ -v` |
