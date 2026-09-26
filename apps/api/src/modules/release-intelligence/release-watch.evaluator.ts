import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { EffectiveState, effectiveStatesAt } from '../knowledge-graph/knowledge-state.queries';

export type WatchEventType =
  | 'GAP_CLOSED'
  | 'GAP_OPENED'
  | 'NEW_DEPRECATION'
  | 'SUCCESSOR_CHANGED'
  | 'STATE_CHANGED'
  | 'OBJECT_REMOVED';

/** Snapshot of the watched facts: key `${objectId}|${releaseId}|${scheme}`. */
export interface WatchFact {
  supportState: string;
  state: string;
  successors: string[];
  successorConcept: string | null;
}
export type WatchState = Record<string, WatchFact>;

export interface WatchChange {
  eventType: WatchEventType;
  objectId: string;
  releaseId: string;
  scheme: string;
  previous: WatchFact | null;
  current: WatchFact | null;
}

export function buildWatchState(states: EffectiveState[]): WatchState {
  const out: WatchState = {};
  for (const s of states) {
    out[`${s.objectId}|${s.releaseId}|${s.scheme}`] = {
      supportState: s.supportState,
      state: s.state,
      successors: s.successors.map((x) => `${x.sapObjectType}:${x.objectKey}`).sort(),
      successorConcept: s.successorConcept ?? null,
    };
  }
  return out;
}

const AVAILABLE = new Set(['RELEASED', 'DEPRECATED', 'CLASSIC_API', 'SUPPORTED']);

/**
 * Pure comparison of two watch states (Part 04 §4.9): produces the
 * user-facing change types "gap closed", "new deprecation", "successor
 * changed", ... Deterministic ordering.
 */
export function diffWatchState(previous: WatchState, current: WatchState): WatchChange[] {
  const keys = [...new Set([...Object.keys(previous), ...Object.keys(current)])].sort();
  const changes: WatchChange[] = [];
  for (const key of keys) {
    const [objectId, releaseId, scheme] = key.split('|');
    const p = previous[key] ?? null;
    const c = current[key] ?? null;
    let eventType: WatchEventType | null = null;
    if (p && !c) {
      eventType = 'OBJECT_REMOVED';
    } else if (c && (!p || p.supportState !== c.supportState)) {
      const wasAvailable = p ? AVAILABLE.has(p.supportState) : false;
      if (c.supportState === 'RELEASED' && (!p || p.supportState !== 'DEPRECATED')) {
        eventType = wasAvailable ? 'STATE_CHANGED' : 'GAP_CLOSED';
      } else if (c.supportState === 'CLASSIC_API' && !wasAvailable) {
        eventType = 'GAP_CLOSED';
      } else if (c.supportState === 'DEPRECATED') {
        eventType = 'NEW_DEPRECATION';
      } else if (wasAvailable && !AVAILABLE.has(c.supportState)) {
        eventType = 'GAP_OPENED';
      } else {
        eventType = 'STATE_CHANGED';
      }
    } else if (p && c) {
      if (
        p.successors.join(',') !== c.successors.join(',') ||
        (p.successorConcept ?? null) !== (c.successorConcept ?? null)
      ) {
        eventType = 'SUCCESSOR_CHANGED';
      } else if (p.state !== c.state) {
        eventType = 'STATE_CHANGED';
      }
    }
    if (eventType) {
      changes.push({ eventType, objectId, releaseId, scheme, previous: p, current: c });
    }
  }
  return changes;
}

export interface EvaluationLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface EvaluationSummary {
  snapshotId: string;
  snapshotSeq: number;
  watchesEvaluated: number;
  watchesChanged: number;
  events: number;
  tenants: number;
}

/**
 * Runs a callback in a tenant-scoped transaction with the same guarantees as
 * DatabaseService.withTenantTransaction (RLS runtime role + app.current_tenant_id).
 */
export async function withTenantClient<T>(
  pool: Pool,
  tenantId: string,
  runtimeRole: string | null,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (runtimeRole) {
      if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) throw new Error('Invalid runtime role');
      await client.query(`SET LOCAL ROLE "${runtimeRole}"`);
    }
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Re-evaluates release watches after a knowledge snapshot is published
 * (Part 05 §5.3, C §31). For each affected watch it stores watch events,
 * updates the watch baseline and records a `release_watch.changed` domain
 * event in the transactional outbox; the outbox dispatcher then fans it out
 * to in-app notifications, e-mail (if configured) and signed webhooks.
 */
export class ReleaseWatchEvaluator {
  constructor(
    private readonly pool: Pool,
    private readonly logger: EvaluationLogger,
    private readonly runtimeRole: string | null
  ) {}

  async evaluateAfterSnapshot(snapshot: { id: string; seq: number }): Promise<EvaluationSummary> {
    // Objects whose facts changed in this snapshot (states or successor edges).
    const changed = await this.pool.query(
      `SELECT DISTINCT object_id FROM knowledge_object_release_states
        WHERE valid_from_seq = $1 OR valid_to_seq = $1`,
      [snapshot.seq]
    );
    const changedIds: string[] = changed.rows.map((r: any) => r.object_id);
    const summary: EvaluationSummary = {
      snapshotId: snapshot.id,
      snapshotSeq: snapshot.seq,
      watchesEvaluated: 0,
      watchesChanged: 0,
      events: 0,
      tenants: 0,
    };
    if (changedIds.length === 0) return summary;

    // Cross-tenant maintenance read (same pattern as the outbox/webhook dispatcher:
    // runs as the schema owner outside any tenant context). All writes below are
    // performed inside per-tenant RLS transactions.
    const watchesRes = await this.pool.query(
      `SELECT id, organization_id, watch_type, label, target_object_ids, release_id, last_state, finding_id
         FROM release_watches
        WHERE status = 'ACTIVE' AND target_object_ids && $1::uuid[]
          AND (last_snapshot_id IS NULL OR last_snapshot_id <> $2)`,
      [changedIds, snapshot.id]
    );
    const byTenant = new Map<string, any[]>();
    for (const w of watchesRes.rows) {
      const list = byTenant.get(w.organization_id) ?? [];
      list.push(w);
      byTenant.set(w.organization_id, list);
    }
    summary.tenants = byTenant.size;

    for (const [tenantId, watches] of byTenant) {
      try {
        await withTenantClient(this.pool, tenantId, this.runtimeRole, async (client) => {
          for (const w of watches) {
            summary.watchesEvaluated++;
            const states = await effectiveStatesAt(client, w.target_object_ids, snapshot.seq, w.release_id);
            const current = buildWatchState(states);
            const changes = diffWatchState((w.last_state ?? {}) as WatchState, current);
            await client.query(
              `UPDATE release_watches SET last_state = $2, last_snapshot_id = $3, last_evaluated_at = NOW(),
                      last_change_at = CASE WHEN $4 THEN NOW() ELSE last_change_at END, updated_at = NOW()
                WHERE id = $1`,
              [w.id, JSON.stringify(current), snapshot.id, changes.length > 0]
            );
            if (changes.length === 0) continue;
            summary.watchesChanged++;
            summary.events += changes.length;
            await this.recordChanges(client, tenantId, w, snapshot, changes);
          }
        });
      } catch (err: any) {
        this.logger.error(`Release watch evaluation failed for tenant ${tenantId}: ${err?.message ?? err}`);
      }
    }
    this.logger.log(
      `Release watches after snapshot seq ${snapshot.seq}: ${summary.watchesEvaluated} evaluated, ` +
        `${summary.watchesChanged} changed, ${summary.events} events across ${summary.tenants} tenants`
    );
    return summary;
  }

  private async recordChanges(
    client: PoolClient,
    tenantId: string,
    watch: any,
    snapshot: { id: string; seq: number },
    changes: WatchChange[]
  ): Promise<void> {
    const objectIds = [...new Set(changes.map((c) => c.objectId))];
    const releaseIds = [...new Set(changes.map((c) => c.releaseId))];
    const objRes = await client.query(
      `SELECT id, sap_object_type, object_key, object_type FROM knowledge_objects WHERE id = ANY($1::uuid[])`,
      [objectIds]
    );
    const relRes = await client.query(
      `SELECT r.id, r.code, r.label, e.code AS edition_code, p.code AS product_code
         FROM knowledge_releases r JOIN knowledge_editions e ON e.id = r.edition_id
         JOIN knowledge_products p ON p.id = e.product_id WHERE r.id = ANY($1::uuid[])`,
      [releaseIds]
    );
    const objects = new Map(objRes.rows.map((o: any) => [o.id, o]));
    const releases = new Map(relRes.rows.map((r: any) => [r.id, r]));

    for (const c of changes) {
      await client.query(
        `INSERT INTO release_watch_events (organization_id, watch_id, snapshot_id, event_type, object_id, release_id,
                                           previous, current)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (watch_id, snapshot_id, event_type, object_id, release_id) DO NOTHING`,
        [
          tenantId,
          watch.id,
          snapshot.id,
          c.eventType,
          c.objectId,
          c.releaseId,
          c.previous ? JSON.stringify(c.previous) : null,
          c.current ? JSON.stringify(c.current) : null,
        ]
      );
    }

    const payload = {
      watchId: watch.id,
      watchType: watch.watch_type,
      label: watch.label,
      findingId: watch.finding_id ?? null,
      snapshotId: snapshot.id,
      snapshotSeq: snapshot.seq,
      changes: changes.map((c) => {
        const o: any = objects.get(c.objectId);
        const r: any = releases.get(c.releaseId);
        return {
          eventType: c.eventType,
          objectId: c.objectId,
          sapObjectType: o?.sap_object_type ?? null,
          objectKey: o?.object_key ?? null,
          releaseId: c.releaseId,
          release: r ? `${r.product_code}/${r.edition_code}/${r.code}` : null,
          releaseLabel: r?.label ?? null,
          scheme: c.scheme,
          previous: c.previous,
          current: c.current,
        };
      }),
    };
    await client.query(
      `INSERT INTO domain_events_outbox (id, organization_id, event_type, aggregate_type, aggregate_id, payload,
                                         status, attempts, created_at)
       VALUES ($1, $2, 'release_watch.changed', 'RELEASE_WATCH', $3, $4, 'PENDING', 0, NOW())`,
      [randomUUID(), tenantId, watch.id, JSON.stringify(payload)]
    );
  }
}
