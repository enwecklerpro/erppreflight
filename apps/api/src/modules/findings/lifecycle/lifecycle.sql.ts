import type { PoolClient } from 'pg';

/** Minimal query surface shared by pg PoolClient and test doubles. */
export type Queryable = Pick<PoolClient, 'query'>;

export interface HistoryEntry {
  organizationId: string;
  projectId: string;
  lifecycleId: string;
  findingId?: string | null;
  analysisId?: string | null;
  event: string;
  fromStatus: string | null;
  toStatus: string;
  reason?: string | null;
  actorId?: string | null;
  actorKind: 'USER' | 'SYSTEM';
  metadata?: Record<string, unknown>;
}

/** Appends one immutable status-history row (the table rejects UPDATE/DELETE). */
export async function insertHistory(client: Queryable, e: HistoryEntry): Promise<void> {
  await client.query(
    `INSERT INTO finding_status_history (
       organization_id, project_id, lifecycle_id, finding_id, analysis_id, event,
       from_status, to_status, reason, actor_id, actor_kind, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      e.organizationId,
      e.projectId,
      e.lifecycleId,
      e.findingId ?? null,
      e.analysisId ?? null,
      e.event,
      e.fromStatus,
      e.toStatus,
      e.reason ?? null,
      e.actorId ?? null,
      e.actorKind,
      JSON.stringify(e.metadata ?? {}),
    ]
  );
}

/** Columns of finding_lifecycles exposed to callers (snake_case row). */
export const LIFECYCLE_COLUMNS = `id, organization_id, project_id, lifecycle_key, engine, rule_id, artifact_name, status,
  status_reason, status_changed_by, status_changed_at, suppression_mode, suppressed_until, suppressed_release,
  suppressed_object_hash, assignee_id, due_date, first_detected_at, first_analysis_id, last_detected_at,
  last_evaluated_at, last_analysis_id, latest_finding_id, last_object_hash, last_target_release,
  detection_count, revision, created_at, updated_at`;
