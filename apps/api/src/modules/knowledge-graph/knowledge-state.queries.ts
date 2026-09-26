import type { PoolClient, QueryResult } from 'pg';

/** Minimal query surface shared by pg.Pool, pg.PoolClient and DatabaseService. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<QueryResult<any>>;
}

/** SQL rank of an evidence trust level (1 = strongest). Used to pick the best fact among several sources. */
export const TRUST_RANK_SQL = `CASE es.trust_level
    WHEN 'OFFICIAL_REPOSITORY' THEN 1 WHEN 'OFFICIAL_DOCUMENTATION' THEN 2 WHEN 'OFFICIAL_SUPPORT' THEN 3
    WHEN 'OFFICIAL_COMMUNITY' THEN 4 WHEN 'CURATED_RULE' THEN 5 WHEN 'THIRD_PARTY' THEN 6
    WHEN 'CUSTOMER_EVIDENCE' THEN 7 ELSE 8 END`;

export interface EffectiveState {
  objectId: string;
  releaseId: string;
  scheme: string;
  state: string;
  supportState: string;
  cleanCoreLevel: string | null;
  successors: Array<{ sapObjectType: string; objectKey: string }>;
  successorConcept: string | null;
  successorClassification: string | null;
  trustLevel: string;
  sourceId: string;
}

/** Highest published snapshot sequence (0 when no snapshot exists yet). */
export async function latestSnapshot(db: Queryable): Promise<{ id: string; seq: number } | null> {
  const res = await db.query(
    `SELECT id, seq FROM knowledge_snapshots WHERE status = 'PUBLISHED' ORDER BY seq DESC LIMIT 1`
  );
  const row = res.rows[0];
  return row ? { id: row.id, seq: Number(row.seq) } : null;
}

/**
 * Effective (best-trust) state of each object per (release, scheme) as of
 * snapshot `seq` (validity-range lookup, Part 17.3 reproducibility).
 */
export async function effectiveStatesAt(
  db: Queryable | PoolClient,
  objectIds: string[],
  seq: number,
  releaseId: string | null = null
): Promise<EffectiveState[]> {
  if (objectIds.length === 0) return [];
  const res = await db.query(
    `SELECT DISTINCT ON (s.object_id, s.release_id, s.scheme)
            s.object_id, s.release_id, s.scheme, s.state, s.support_state, s.clean_core_level, s.successors,
            s.successor_concept, s.successor_classification, es.trust_level, s.source_id
       FROM knowledge_object_release_states s
       JOIN knowledge_evidence_sources es ON es.id = s.source_id
      WHERE s.object_id = ANY($1::uuid[])
        AND s.valid_from_seq <= $2 AND (s.valid_to_seq IS NULL OR s.valid_to_seq > $2)
        AND ($3::uuid IS NULL OR s.release_id = $3::uuid)
      ORDER BY s.object_id, s.release_id, s.scheme, ${TRUST_RANK_SQL}, s.valid_from_seq DESC`,
    [objectIds, seq, releaseId]
  );
  return res.rows.map((r: any) => ({
    objectId: r.object_id,
    releaseId: r.release_id,
    scheme: r.scheme,
    state: r.state,
    supportState: r.support_state,
    cleanCoreLevel: r.clean_core_level,
    successors: Array.isArray(r.successors) ? r.successors : [],
    successorConcept: r.successor_concept,
    successorClassification: r.successor_classification,
    trustLevel: r.trust_level,
    sourceId: r.source_id,
  }));
}
