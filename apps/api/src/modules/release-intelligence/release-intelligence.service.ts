import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { TRUST_RANK_SQL, effectiveStatesAt, latestSnapshot } from '../knowledge-graph/knowledge-state.queries';
import { buildWatchState } from './release-watch.evaluator';
import type { CreateWatch } from './release-intelligence.types';

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Maps a support-state transition to the change taxonomy used by the diff views. */
const CHANGE_CASE = (prev: string, next: string, prevSucc: string, nextSucc: string) => `CASE
    WHEN ${prev} IS NULL THEN 'ADDED'
    WHEN ${next} IS NULL THEN 'REMOVED'
    WHEN ${prev} IS DISTINCT FROM ${next} AND ${next} = 'RELEASED' THEN 'NEWLY_RELEASED'
    WHEN ${prev} IS DISTINCT FROM ${next} AND ${next} = 'DEPRECATED' THEN 'NEWLY_DEPRECATED'
    WHEN ${prev} IN ('RELEASED', 'DEPRECATED') AND ${next} NOT IN ('RELEASED', 'DEPRECATED') THEN 'RELEASE_WITHDRAWN'
    WHEN ${prev} IS DISTINCT FROM ${next} THEN 'STATE_CHANGED'
    WHEN ${prevSucc} IS DISTINCT FROM ${nextSucc} THEN 'SUCCESSOR_CHANGED'
    ELSE 'ATTRIBUTES_CHANGED' END`;

/**
 * Release Intelligence (Part 04 §4.9, Part 05 §5.3, C §31): release catalog,
 * reusable release comparison service (snapshot-vs-snapshot and
 * release-vs-release), and tenant-scoped release watches.
 */
@Injectable()
export class ReleaseIntelligenceService {
  constructor(private readonly db: DatabaseService) {}

  async catalog() {
    const snapshot = await latestSnapshot(this.db);
    const rel = await this.db.query(
      `SELECT p.code AS product_code, p.name AS product_name, e.code AS edition_code, e.name AS edition_name,
              e.deployment, r.id, r.code, r.label, r.feature_pack, r.sort_order, r.is_rolling, r.description
         FROM knowledge_releases r JOIN knowledge_editions e ON e.id = r.edition_id
         JOIN knowledge_products p ON p.id = e.product_id
        ORDER BY p.code, e.code, r.sort_order DESC`
    );
    const counts = await this.db.query(
      `SELECT s.release_id, s.scheme, s.support_state, COUNT(*)::int AS n
         FROM knowledge_object_release_states s
         JOIN knowledge_evidence_sources es ON es.id = s.source_id
        WHERE s.valid_to_seq IS NULL AND s.organization_id IS NULL AND es.trust_level LIKE 'OFFICIAL_%'
        GROUP BY s.release_id, s.scheme, s.support_state`
    );
    const byRelease = new Map<string, Record<string, Record<string, number>>>();
    for (const c of counts.rows) {
      const m = byRelease.get(c.release_id) ?? {};
      m[c.scheme] = { ...(m[c.scheme] ?? {}), [c.support_state]: c.n };
      byRelease.set(c.release_id, m);
    }
    const sources = await this.db.query(
      `SELECT target_release_id, source_key, title, trust_level, url, last_retrieved_at
         FROM knowledge_evidence_sources WHERE organization_id IS NULL AND target_release_id IS NOT NULL`
    );
    const sourcesByRelease = new Map<string, any[]>();
    for (const s of sources.rows) {
      const list = sourcesByRelease.get(s.target_release_id) ?? [];
      list.push({ sourceKey: s.source_key, title: s.title, trustLevel: s.trust_level, url: s.url, lastRetrievedAt: s.last_retrieved_at });
      sourcesByRelease.set(s.target_release_id, list);
    }

    const products = new Map<string, any>();
    for (const r of rel.rows) {
      const p = products.get(r.product_code) ?? { code: r.product_code, name: r.product_name, editions: new Map() };
      const e = p.editions.get(r.edition_code) ?? { code: r.edition_code, name: r.edition_name, deployment: r.deployment, releases: [] };
      e.releases.push({
        id: r.id,
        code: r.code,
        label: r.label,
        featurePack: r.feature_pack,
        sortOrder: r.sort_order,
        isRolling: r.is_rolling,
        description: r.description,
        counts: byRelease.get(r.id) ?? {},
        sources: sourcesByRelease.get(r.id) ?? [],
      });
      p.editions.set(r.edition_code, e);
      products.set(r.product_code, p);
    }
    return {
      snapshot,
      products: [...products.values()].map((p) => ({ ...p, editions: [...p.editions.values()] })),
    };
  }

  async snapshotChanges(q: {
    from: number;
    to: number;
    changeType?: string;
    releaseId?: string;
    q?: string;
    limit: number;
    offset: number;
  }) {
    const params: unknown[] = [q.from, q.to];
    const base = `
      WITH changed AS (
        SELECT DISTINCT object_id, release_id, scheme, source_id FROM knowledge_object_release_states
         WHERE organization_id IS NULL
           AND ((valid_from_seq > $1 AND valid_from_seq <= $2) OR (valid_to_seq > $1 AND valid_to_seq <= $2))
      ), at_a AS (
        SELECT s.object_id, s.release_id, s.scheme, s.source_id, s.support_state, s.state, s.successors, s.content_hash
          FROM knowledge_object_release_states s
          JOIN changed c ON c.object_id = s.object_id AND c.release_id = s.release_id AND c.scheme = s.scheme
                        AND c.source_id = s.source_id
         WHERE s.valid_from_seq <= $1 AND (s.valid_to_seq IS NULL OR s.valid_to_seq > $1)
      ), at_b AS (
        SELECT s.object_id, s.release_id, s.scheme, s.source_id, s.support_state, s.state, s.successors, s.content_hash
          FROM knowledge_object_release_states s
          JOIN changed c ON c.object_id = s.object_id AND c.release_id = s.release_id AND c.scheme = s.scheme
                        AND c.source_id = s.source_id
         WHERE s.valid_from_seq <= $2 AND (s.valid_to_seq IS NULL OR s.valid_to_seq > $2)
      ), diff AS (
        SELECT COALESCE(b.object_id, a.object_id) AS object_id, COALESCE(b.release_id, a.release_id) AS release_id,
               COALESCE(b.scheme, a.scheme) AS scheme, COALESCE(b.source_id, a.source_id) AS source_id,
               a.support_state AS prev_support, b.support_state AS new_support, a.state AS prev_state, b.state AS new_state,
               a.successors AS prev_successors, b.successors AS new_successors,
               ${CHANGE_CASE('a.support_state', 'b.support_state', 'a.successors', 'b.successors')} AS change_type
          FROM at_a a FULL OUTER JOIN at_b b
            ON a.object_id = b.object_id AND a.release_id = b.release_id AND a.scheme = b.scheme AND a.source_id = b.source_id
         WHERE a.content_hash IS DISTINCT FROM b.content_hash
      )`;
    const filters: string[] = [];
    if (q.releaseId) {
      params.push(q.releaseId);
      filters.push(`d.release_id = $${params.length}`);
    }
    if (q.q) {
      params.push(`${escapeLike(q.q.toUpperCase())}%`);
      filters.push(`o.object_key LIKE $${params.length} ESCAPE '\\'`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const summary = await this.db.query(
      `${base} SELECT d.change_type, COUNT(*)::int AS n FROM diff d JOIN knowledge_objects o ON o.id = d.object_id
       ${where} GROUP BY d.change_type ORDER BY d.change_type`,
      params
    );
    const pageParams = [...params];
    const typeFilter = q.changeType ? (pageParams.push(q.changeType), `d.change_type = $${pageParams.length}`) : null;
    pageParams.push(q.limit, q.offset);
    const pageWhere = [...filters, ...(typeFilter ? [typeFilter] : [])];
    const page = await this.db.query(
      `${base}
       SELECT d.*, o.sap_object_type, o.object_key, o.object_type, r.label AS release_label, r.code AS release_code,
              e.code AS edition_code, es.trust_level
         FROM diff d JOIN knowledge_objects o ON o.id = d.object_id
         JOIN knowledge_releases r ON r.id = d.release_id JOIN knowledge_editions e ON e.id = r.edition_id
         JOIN knowledge_evidence_sources es ON es.id = d.source_id
         ${pageWhere.length ? `WHERE ${pageWhere.join(' AND ')}` : ''}
        ORDER BY d.change_type, o.object_key, r.sort_order DESC
        LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams
    );
    const byType: Record<string, number> = {};
    for (const r of summary.rows) byType[r.change_type] = r.n;
    return {
      from: q.from,
      to: q.to,
      summary: byType,
      total: q.changeType ? byType[q.changeType] ?? 0 : Object.values(byType).reduce((a, b) => a + b, 0),
      items: page.rows.map((r: any) => this.mapDiffRow(r)),
    };
  }

  async releaseDiff(q: {
    fromRelease: string;
    toRelease: string;
    snapshotSeq?: number;
    changeType?: string;
    q?: string;
    limit: number;
    offset: number;
    /** Public free tool: restrict to global, published objects (Part 04 §4.14). */
    publicOnly?: boolean;
  }) {
    const latest = await latestSnapshot(this.db);
    if (!latest) return { summary: {}, total: 0, items: [], snapshot: null };
    const seq = q.snapshotSeq ?? latest.seq;
    const rels = await this.db.query(
      `SELECT r.id, r.label, r.code, e.code AS edition_code FROM knowledge_releases r
         JOIN knowledge_editions e ON e.id = r.edition_id WHERE r.id = ANY($1::uuid[])`,
      [[q.fromRelease, q.toRelease]]
    );
    if (rels.rows.length !== 2) throw new NotFoundException('Release not found');

    const params: unknown[] = [q.fromRelease, q.toRelease, seq];
    const base = `
      WITH x AS (
        SELECT DISTINCT ON (s.object_id) s.object_id, s.support_state, s.state, s.successors
          FROM knowledge_object_release_states s JOIN knowledge_evidence_sources es ON es.id = s.source_id
         WHERE s.release_id = $1 AND s.scheme = 'RELEASE_CONTRACT' AND s.organization_id IS NULL
           AND s.valid_from_seq <= $3 AND (s.valid_to_seq IS NULL OR s.valid_to_seq > $3)
         ORDER BY s.object_id, ${TRUST_RANK_SQL}
      ), y AS (
        SELECT DISTINCT ON (s.object_id) s.object_id, s.support_state, s.state, s.successors
          FROM knowledge_object_release_states s JOIN knowledge_evidence_sources es ON es.id = s.source_id
         WHERE s.release_id = $2 AND s.scheme = 'RELEASE_CONTRACT' AND s.organization_id IS NULL
           AND s.valid_from_seq <= $3 AND (s.valid_to_seq IS NULL OR s.valid_to_seq > $3)
         ORDER BY s.object_id, ${TRUST_RANK_SQL}
      ), diff AS (
        SELECT COALESCE(y.object_id, x.object_id) AS object_id,
               x.support_state AS prev_support, y.support_state AS new_support, x.state AS prev_state, y.state AS new_state,
               x.successors AS prev_successors, y.successors AS new_successors,
               ${CHANGE_CASE('x.support_state', 'y.support_state', 'x.successors', 'y.successors')} AS change_type
          FROM x FULL OUTER JOIN y ON x.object_id = y.object_id
         WHERE x.object_id IS NULL OR y.object_id IS NULL OR x.support_state IS DISTINCT FROM y.support_state
            OR x.successors IS DISTINCT FROM y.successors
      )`;
    const filters: string[] = [];
    if (q.publicOnly) filters.push(`o.organization_id IS NULL AND o.review_status = 'PUBLISHED'`);
    if (q.q) {
      params.push(`${escapeLike(q.q.toUpperCase())}%`);
      filters.push(`o.object_key LIKE $${params.length} ESCAPE '\\'`);
    }
    const summary = await this.db.query(
      `${base} SELECT d.change_type, COUNT(*)::int AS n FROM diff d JOIN knowledge_objects o ON o.id = d.object_id
       ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} GROUP BY d.change_type`,
      params
    );
    const pageParams = [...params];
    const pageFilters = [...filters];
    if (q.changeType) {
      pageParams.push(q.changeType);
      pageFilters.push(`d.change_type = $${pageParams.length}`);
    }
    pageParams.push(q.limit, q.offset);
    const page = await this.db.query(
      `${base}
       SELECT d.*, o.sap_object_type, o.object_key, o.object_type
         FROM diff d JOIN knowledge_objects o ON o.id = d.object_id
         ${pageFilters.length ? `WHERE ${pageFilters.join(' AND ')}` : ''}
        ORDER BY d.change_type, o.object_key, o.sap_object_type
        LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams
    );
    const byType: Record<string, number> = {};
    for (const r of summary.rows) byType[r.change_type] = r.n;
    const relMap = new Map(rels.rows.map((r: any) => [r.id, r]));
    return {
      snapshotSeq: seq,
      fromRelease: relMap.get(q.fromRelease),
      toRelease: relMap.get(q.toRelease),
      summary: byType,
      total: q.changeType ? byType[q.changeType] ?? 0 : Object.values(byType).reduce((a, b) => a + b, 0),
      items: page.rows.map((r: any) => this.mapDiffRow(r)),
    };
  }

  private mapDiffRow(r: any) {
    return {
      objectId: r.object_id,
      sapObjectType: r.sap_object_type,
      objectKey: r.object_key,
      objectType: r.object_type,
      changeType: r.change_type,
      releaseId: r.release_id ?? null,
      releaseLabel: r.release_label ?? null,
      scheme: r.scheme ?? 'RELEASE_CONTRACT',
      trustLevel: r.trust_level ?? null,
      previous: r.prev_support ? { supportState: r.prev_support, state: r.prev_state, successors: r.prev_successors } : null,
      current: r.new_support ? { supportState: r.new_support, state: r.new_state, successors: r.new_successors } : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Watches (tenant-scoped, RLS)
  // ---------------------------------------------------------------------------
  async createWatch(organizationId: string, userId: string, dto: CreateWatch) {
    const snapshot = await latestSnapshot(this.db);
    let targetIds: string[] = [];
    let label = dto.label;
    let findingId: string | null = null;

    if (dto.watchType === 'FINDING') {
      const f = await this.db.query(
        `SELECT id, title, affected_objects FROM findings WHERE id = $1 AND organization_id = $2`,
        [dto.findingId, organizationId]
      );
      if (!f.rows[0]) throw new NotFoundException('Finding not found');
      findingId = f.rows[0].id;
      const affected: any[] = Array.isArray(f.rows[0].affected_objects) ? f.rows[0].affected_objects : [];
      const names = [...new Set(affected.map((a) => String(a?.name ?? '').toUpperCase()).filter(Boolean))];
      if (names.length > 0) {
        const objs = await this.db.query(
          `SELECT id FROM knowledge_objects WHERE object_key = ANY($1::text[]) ORDER BY object_key LIMIT 100`,
          [names]
        );
        targetIds = objs.rows.map((o: any) => o.id);
      }
      if (targetIds.length === 0) {
        throw new UnprocessableEntityException(
          'None of the objects affected by this finding exist in the knowledge graph, so there is nothing to watch'
        );
      }
      label = label ?? `Finding: ${f.rows[0].title}`.slice(0, 300);
    } else {
      const o = await this.db.query(`SELECT id, sap_object_type, object_key FROM knowledge_objects WHERE id = $1`, [dto.objectId]);
      if (!o.rows[0]) throw new NotFoundException('Knowledge object not found');
      targetIds = [o.rows[0].id];
      label = label ?? `${dto.watchType === 'GAP' ? 'Gap' : 'Object'}: ${o.rows[0].object_key} (${o.rows[0].sap_object_type})`;
    }

    if (dto.releaseId) {
      const r = await this.db.query(`SELECT id FROM knowledge_releases WHERE id = $1`, [dto.releaseId]);
      if (!r.rows[0]) throw new NotFoundException('Release not found');
    }

    const states = snapshot ? await effectiveStatesAt(this.db, targetIds, snapshot.seq, dto.releaseId ?? null) : [];
    const baseline = buildWatchState(states);
    const res = await this.db.query(
      `INSERT INTO release_watches (organization_id, created_by, watch_type, label, notes, target_object_ids, finding_id,
                                    release_id, last_state, last_snapshot_id, last_evaluated_at)
       VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7, $8, $9, $10, NOW())
       RETURNING id`,
      [
        organizationId,
        userId,
        dto.watchType,
        label,
        dto.notes ?? null,
        targetIds,
        findingId,
        dto.releaseId ?? null,
        JSON.stringify(baseline),
        snapshot?.id ?? null,
      ]
    );
    return this.getWatch(organizationId, res.rows[0].id);
  }

  async listWatches(organizationId: string, limit: number) {
    const res = await this.db.query(
      `SELECT w.*, (SELECT COUNT(*)::int FROM release_watch_events ev WHERE ev.watch_id = w.id) AS event_count,
              r.label AS release_label
         FROM release_watches w LEFT JOIN knowledge_releases r ON r.id = w.release_id
        WHERE w.organization_id = $1 ORDER BY w.created_at DESC LIMIT $2`,
      [organizationId, limit]
    );
    const allIds = [...new Set(res.rows.flatMap((w: any) => w.target_object_ids as string[]))];
    const objs = allIds.length
      ? await this.db.query(`SELECT id, sap_object_type, object_key, object_type FROM knowledge_objects WHERE id = ANY($1::uuid[])`, [allIds])
      : { rows: [] as any[] };
    const objMap = new Map(objs.rows.map((o: any) => [o.id, o]));
    return res.rows.map((w: any) => this.mapWatch(w, objMap));
  }

  async getWatch(organizationId: string, id: string) {
    const res = await this.db.query(
      `SELECT w.*, (SELECT COUNT(*)::int FROM release_watch_events ev WHERE ev.watch_id = w.id) AS event_count,
              r.label AS release_label
         FROM release_watches w LEFT JOIN knowledge_releases r ON r.id = w.release_id
        WHERE w.organization_id = $1 AND w.id = $2`,
      [organizationId, id]
    );
    if (!res.rows[0]) throw new NotFoundException('Release watch not found');
    const w = res.rows[0];
    const objs = await this.db.query(
      `SELECT id, sap_object_type, object_key, object_type FROM knowledge_objects WHERE id = ANY($1::uuid[])`,
      [w.target_object_ids]
    );
    return this.mapWatch(w, new Map(objs.rows.map((o: any) => [o.id, o])));
  }

  private mapWatch(w: any, objMap: Map<string, any>) {
    const lastState = (w.last_state ?? {}) as Record<string, { supportState: string }>;
    return {
      id: w.id,
      watchType: w.watch_type,
      label: w.label,
      notes: w.notes,
      status: w.status,
      findingId: w.finding_id,
      releaseId: w.release_id,
      releaseLabel: w.release_label ?? null,
      targets: (w.target_object_ids as string[]).map((id) => {
        const o = objMap.get(id);
        return { id, sapObjectType: o?.sap_object_type ?? null, objectKey: o?.object_key ?? null, objectType: o?.object_type ?? null };
      }),
      baselineFacts: Object.keys(lastState).length,
      baselineSupportStates: [...new Set(Object.values(lastState).map((f) => f.supportState))].sort(),
      lastSnapshotId: w.last_snapshot_id,
      lastEvaluatedAt: w.last_evaluated_at,
      lastChangeAt: w.last_change_at,
      eventCount: w.event_count ?? 0,
      createdAt: w.created_at,
    };
  }

  async updateWatch(organizationId: string, id: string, dto: { status?: string; label?: string; notes?: string | null }) {
    const res = await this.db.query(
      `UPDATE release_watches SET status = COALESCE($3, status), label = COALESCE($4, label),
              notes = CASE WHEN $5::boolean THEN $6 ELSE notes END, updated_at = NOW()
        WHERE organization_id = $1 AND id = $2 RETURNING id`,
      [organizationId, id, dto.status ?? null, dto.label ?? null, dto.notes !== undefined, dto.notes ?? null]
    );
    if (!res.rows[0]) throw new NotFoundException('Release watch not found');
    return this.getWatch(organizationId, id);
  }

  async deleteWatch(organizationId: string, id: string) {
    const res = await this.db.query(`DELETE FROM release_watches WHERE organization_id = $1 AND id = $2 RETURNING id`, [
      organizationId,
      id,
    ]);
    if (!res.rows[0]) throw new NotFoundException('Release watch not found');
    return { deleted: true, id };
  }

  async watchEvents(organizationId: string, id: string) {
    await this.getWatch(organizationId, id);
    const res = await this.db.query(
      `SELECT ev.id, ev.event_type, ev.previous, ev.current, ev.created_at, o.object_key, o.sap_object_type,
              r.label AS release_label, s.seq AS snapshot_seq
         FROM release_watch_events ev
         LEFT JOIN knowledge_objects o ON o.id = ev.object_id
         LEFT JOIN knowledge_releases r ON r.id = ev.release_id
         JOIN knowledge_snapshots s ON s.id = ev.snapshot_id
        WHERE ev.organization_id = $1 AND ev.watch_id = $2 ORDER BY ev.created_at DESC LIMIT 200`,
      [organizationId, id]
    );
    return res.rows.map((e: any) => ({
      id: e.id,
      eventType: e.event_type,
      objectKey: e.object_key,
      sapObjectType: e.sap_object_type,
      releaseLabel: e.release_label,
      snapshotSeq: Number(e.snapshot_seq),
      previous: e.previous,
      current: e.current,
      createdAt: e.created_at,
    }));
  }
}
