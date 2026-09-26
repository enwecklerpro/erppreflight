import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService } from '../database/database.service';

export const KgObjectListQuerySchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    status: z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'DEPRECATED', 'SUPERSEDED']).optional(),
    conflictsOnly: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();
export type KgObjectListQuery = z.infer<typeof KgObjectListQuerySchema>;

/** Current facts of the same (object, release, scheme) from several sources that disagree on the support state. */
const CONFLICTS_CTE = `conflicts AS (
  SELECT s.object_id, s.release_id, s.scheme
    FROM knowledge_object_release_states s
   WHERE s.valid_to_seq IS NULL AND s.organization_id IS NULL
   GROUP BY s.object_id, s.release_id, s.scheme
  HAVING COUNT(DISTINCT s.support_state) > 1
)`;

function iso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

/**
 * Knowledge Admin graph view (spec 10.9): global object records with their evidence
 * sources, release validity, last verification and source conflicts. Read-only view on
 * the global catalog (organization_id IS NULL) for SUPER_ADMIN; curation transitions keep
 * using the existing knowledge-graph admin API.
 */
@Injectable()
export class KnowledgeGraphAdminViewService {
  constructor(private readonly db: DatabaseService) {}

  async summary() {
    const [objects, sources, snapshot, conflicts, releases] = await Promise.all([
      this.db.query(
        `SELECT review_status, COUNT(*)::int AS n FROM knowledge_objects WHERE organization_id IS NULL GROUP BY review_status`,
        [],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT es.id, es.source_key, es.title, es.trust_level, es.publisher, es.url, es.status, es.last_retrieved_at,
                (SELECT COUNT(*)::int FROM knowledge_object_release_states s WHERE s.source_id = es.id AND s.valid_to_seq IS NULL) AS facts
           FROM knowledge_evidence_sources es WHERE es.organization_id IS NULL
          ORDER BY es.trust_level, es.source_key`,
        [],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT id, seq, adapter_id, published_at FROM knowledge_snapshots WHERE status = 'PUBLISHED' ORDER BY seq DESC LIMIT 1`,
        [],
        { bypassRls: true }
      ),
      this.db.query(`WITH ${CONFLICTS_CTE} SELECT COUNT(*)::int AS facts, COUNT(DISTINCT object_id)::int AS objects FROM conflicts`, [], {
        bypassRls: true,
      }),
      this.db.query(`SELECT COUNT(*)::int AS n FROM knowledge_releases`, [], { bypassRls: true }),
    ]);
    const byStatus: Record<string, number> = {};
    for (const r of objects.rows ?? []) byStatus[r.review_status] = Number(r.n);
    const snap = snapshot.rows?.[0];
    return {
      objects: { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byReviewStatus: byStatus },
      releases: Number(releases.rows?.[0]?.n ?? 0),
      conflicts: { facts: Number(conflicts.rows?.[0]?.facts ?? 0), objects: Number(conflicts.rows?.[0]?.objects ?? 0) },
      latestSnapshot: snap ? { id: snap.id, seq: Number(snap.seq), adapterId: snap.adapter_id, publishedAt: iso(snap.published_at) } : null,
      sources: (sources.rows ?? []).map((s: any) => ({
        id: s.id,
        sourceKey: s.source_key,
        title: s.title,
        trustLevel: s.trust_level,
        publisher: s.publisher,
        url: s.url,
        status: s.status,
        lastRetrievedAt: iso(s.last_retrieved_at),
        facts: Number(s.facts ?? 0),
      })),
    };
  }

  async objects(query: KgObjectListQuery) {
    const q = query.q ? query.q.toUpperCase() : null;
    const conflictsOnly = query.conflictsOnly === 'true';
    const params = [q, query.status ?? null, conflictsOnly, query.limit, query.offset];
    const where = `o.organization_id IS NULL
        AND ($1::text IS NULL OR o.object_key LIKE '%' || $1 || '%' OR upper(coalesce(o.display_name, '')) LIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR o.review_status = $2)
        AND (NOT $3::boolean OR o.id IN (SELECT object_id FROM conflicts))`;
    const [page, total] = await Promise.all([
      this.db.query(
        `WITH ${CONFLICTS_CTE}
         SELECT o.id, o.object_type, o.sap_object_type, o.object_key, o.display_name, o.review_status, o.reviewed_by, o.reviewed_at,
                o.updated_at, es.title AS primary_source_title, es.trust_level AS primary_source_trust
           FROM knowledge_objects o LEFT JOIN knowledge_evidence_sources es ON es.id = o.primary_source_id
          WHERE ${where}
          ORDER BY o.sap_object_type, o.object_key
          LIMIT $4 OFFSET $5`,
        params,
        { bypassRls: true }
      ),
      this.db.query(`WITH ${CONFLICTS_CTE} SELECT COUNT(*)::int AS n FROM knowledge_objects o WHERE ${where}`, params.slice(0, 3), {
        bypassRls: true,
      }),
    ]);
    const ids: string[] = (page.rows ?? []).map((r: any) => r.id);
    const facts = ids.length
      ? await this.db.query(
          `WITH ${CONFLICTS_CTE}
           SELECT s.object_id,
                  COUNT(DISTINCT s.source_id)::int AS sources,
                  COUNT(DISTINCT s.release_id)::int AS releases,
                  MIN(r.label) FILTER (WHERE r.sort_order = mm.min_sort) AS first_release,
                  MAX(r.label) FILTER (WHERE r.sort_order = mm.max_sort) AS last_release,
                  MAX(es.last_retrieved_at) AS last_verified_at,
                  (SELECT COUNT(*)::int FROM conflicts c WHERE c.object_id = s.object_id) AS conflicts
             FROM knowledge_object_release_states s
             JOIN knowledge_releases r ON r.id = s.release_id
             JOIN knowledge_evidence_sources es ON es.id = s.source_id
             JOIN (SELECT s2.object_id, MIN(r2.sort_order) AS min_sort, MAX(r2.sort_order) AS max_sort
                     FROM knowledge_object_release_states s2 JOIN knowledge_releases r2 ON r2.id = s2.release_id
                    WHERE s2.object_id = ANY($1::uuid[]) AND s2.valid_to_seq IS NULL
                    GROUP BY s2.object_id) mm ON mm.object_id = s.object_id
            WHERE s.object_id = ANY($1::uuid[]) AND s.valid_to_seq IS NULL AND s.organization_id IS NULL
            GROUP BY s.object_id`,
          [ids],
          { bypassRls: true }
        )
      : { rows: [] as any[] };
    const factsBy = new Map<string, any>((facts.rows ?? []).map((f: any) => [f.object_id, f]));
    return {
      total: Number(total.rows?.[0]?.n ?? 0),
      limit: query.limit,
      offset: query.offset,
      items: (page.rows ?? []).map((o: any) => {
        const f = factsBy.get(o.id);
        return {
          id: o.id,
          objectType: o.object_type,
          sapObjectType: o.sap_object_type,
          objectKey: o.object_key,
          displayName: o.display_name,
          reviewStatus: o.review_status,
          reviewedBy: o.reviewed_by,
          reviewedAt: iso(o.reviewed_at),
          primarySource: o.primary_source_title ? { title: o.primary_source_title, trustLevel: o.primary_source_trust } : null,
          sources: Number(f?.sources ?? 0),
          releaseValidity: { releases: Number(f?.releases ?? 0), first: f?.first_release ?? null, last: f?.last_release ?? null },
          // Last verification: the newest retrieval of an evidence source asserting a current fact, or the curation review.
          lastVerifiedAt: iso(f?.last_verified_at ?? o.reviewed_at ?? null),
          conflicts: Number(f?.conflicts ?? 0),
          updatedAt: iso(o.updated_at),
        };
      }),
    };
  }

  async conflicts(limit = 100) {
    const res = await this.db.query(
      `WITH ${CONFLICTS_CTE}
       SELECT o.id AS object_id, o.sap_object_type, o.object_key, r.label AS release_label, c.scheme,
              jsonb_agg(jsonb_build_object('source', es.title, 'trustLevel', es.trust_level, 'supportState', s.support_state,
                                           'state', s.state) ORDER BY es.trust_level) AS assertions
         FROM conflicts c
         JOIN knowledge_objects o ON o.id = c.object_id
         JOIN knowledge_releases r ON r.id = c.release_id
         JOIN knowledge_object_release_states s
           ON s.object_id = c.object_id AND s.release_id = c.release_id AND s.scheme = c.scheme AND s.valid_to_seq IS NULL
         JOIN knowledge_evidence_sources es ON es.id = s.source_id
        GROUP BY o.id, o.sap_object_type, o.object_key, r.label, c.scheme
        ORDER BY o.object_key, r.label
        LIMIT $1`,
      [limit],
      { bypassRls: true }
    );
    return (res.rows ?? []).map((r: any) => ({
      objectId: r.object_id,
      sapObjectType: r.sap_object_type,
      objectKey: r.object_key,
      release: r.release_label,
      scheme: r.scheme,
      assertions: Array.isArray(r.assertions) ? r.assertions : [],
    }));
  }
}
