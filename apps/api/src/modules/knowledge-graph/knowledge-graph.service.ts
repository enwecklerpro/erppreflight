import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EffectiveState, TRUST_RANK_SQL, effectiveStatesAt, latestSnapshot } from './knowledge-state.queries';
import {
  ClassifyRequest,
  KnowledgeObjectType,
  REVIEW_TRANSITIONS,
  RelationshipType,
} from './knowledge-graph.types';

export interface ResolvedRelease {
  releaseId: string;
  productCode: string;
  editionCode: string;
  releaseCode: string;
  label: string;
  /** false when the requested release has no dedicated source file and a rolling/latest list was used. */
  exactMatch: boolean;
  note?: string;
}

export interface ClassifiedObject {
  name: string;
  sapObjectType: string;
  tadirObject: string | null;
  objectType: string;
  state: string | null;
  supportState: string | null;
  cleanCoreLevel: string | null;
  classicApiState: string | null;
  successorClassification: string | null;
  successorConcept: string | null;
  successors: Array<{ objectType: string; name: string }>;
  applicationComponent: string | null;
  softwareComponent: string | null;
  trustLevel: string | null;
}

export interface ClassificationResult {
  snapshotId: string;
  snapshotSeq: number;
  contentSha256: string;
  source: string;
  release: ResolvedRelease;
  objects: ClassifiedObject[];
  notFound: string[];
}

const ROLLING = 'LATEST';

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Knowledge graph read/write service: lookup (exact + prefix + trigram fuzzy +
 * full text), object detail with release states and provenance, depth-limited
 * graph neighborhood, snapshot-pinned classification for engines, and tenant
 * (customer) objects/edges (Part 04 §4.5 — never global).
 *
 * Tenant-facing reads run inside the tenant RLS transaction, so a tenant sees
 * global rows plus only its own customer rows. Public reads (no tenant) filter
 * explicitly to GLOBAL + PUBLISHED knowledge.
 */
@Injectable()
export class KnowledgeGraphService {
  constructor(private readonly db: DatabaseService) {}

  // ---------------------------------------------------------------------------
  // Lookup
  // ---------------------------------------------------------------------------
  async lookup(
    query: { q: string; type?: KnowledgeObjectType; limit: number },
    options: { publicOnly: boolean }
  ) {
    const term = query.q.trim().toUpperCase();
    const like = `${escapeLike(term)}%`;
    const res = await this.db.query(
      `WITH candidates AS (
         SELECT o.id,
                CASE WHEN o.object_key = $1 THEN 1.0
                     WHEN o.object_key LIKE $2 ESCAPE '\\' THEN 0.9
                     ELSE similarity(o.object_key, $1) END AS score,
                CASE WHEN o.object_key = $1 THEN 'EXACT'
                     WHEN o.object_key LIKE $2 ESCAPE '\\' THEN 'PREFIX'
                     ELSE 'FUZZY' END AS match_type
           FROM knowledge_objects o
          WHERE (o.object_key = $1 OR o.object_key LIKE $2 ESCAPE '\\' OR o.object_key % $1)
            AND ($3::text IS NULL OR o.object_type = $3)
            AND (NOT $5 OR (o.organization_id IS NULL AND o.review_status = 'PUBLISHED'))
         UNION ALL
         SELECT a.object_id, 0.85, 'ALIAS'
           FROM knowledge_object_aliases a JOIN knowledge_objects o ON o.id = a.object_id
          WHERE upper(a.alias) = $1 AND ($3::text IS NULL OR o.object_type = $3)
            AND (NOT $5 OR (o.organization_id IS NULL AND o.review_status = 'PUBLISHED'))
         UNION ALL
         SELECT o.id, 0.5, 'TEXT'
           FROM knowledge_objects o
          WHERE length($1) >= 4
            AND to_tsvector('simple', coalesce(o.object_key, '') || ' ' || coalesce(o.display_name, '') || ' ' || coalesce(o.description, ''))
                @@ plainto_tsquery('simple', $1)
            AND ($3::text IS NULL OR o.object_type = $3)
            AND (NOT $5 OR (o.organization_id IS NULL AND o.review_status = 'PUBLISHED'))
       ), best AS (
         SELECT DISTINCT ON (id) id, score, match_type FROM candidates ORDER BY id, score DESC
       )
       SELECT o.id, o.object_type, o.sap_object_type, o.object_key, o.display_name, o.description,
              o.application_component, o.software_component, o.scope, o.review_status,
              b.score::float AS score, b.match_type
         FROM best b JOIN knowledge_objects o ON o.id = b.id
        ORDER BY b.score DESC, length(o.object_key), o.object_key, o.sap_object_type
        LIMIT $4`,
      [term, like, query.type ?? null, query.limit, options.publicOnly],
      options.publicOnly ? { bypassRls: true } : {}
    );

    const snapshot = await latestSnapshot(this.db);
    const ids = res.rows.map((r: any) => r.id);
    const headline = snapshot ? await this.headlineStates(ids, snapshot.seq, options.publicOnly) : new Map();
    return {
      query: query.q,
      snapshot,
      results: res.rows.map((r: any) => ({
        id: r.id,
        objectType: r.object_type,
        sapObjectType: r.sap_object_type,
        objectKey: r.object_key,
        displayName: r.display_name,
        description: r.description,
        applicationComponent: r.application_component,
        softwareComponent: r.software_component,
        scope: r.scope,
        reviewStatus: r.review_status,
        score: Math.round(Number(r.score) * 1000) / 1000,
        matchType: r.match_type,
        states: headline.get(r.id) ?? [],
      })),
    };
  }

  /** Best-trust state in each rolling (LATEST) release — the summary shown in search results. */
  private async headlineStates(ids: string[], seq: number, publicOnly: boolean) {
    const out = new Map<string, any[]>();
    if (ids.length === 0) return out;
    const res = await this.db.query(
      `SELECT DISTINCT ON (s.object_id, s.release_id, s.scheme)
              s.object_id, s.scheme, s.state, s.support_state, s.clean_core_level, s.successors,
              r.code AS release_code, r.label AS release_label, e.code AS edition_code, p.code AS product_code
         FROM knowledge_object_release_states s
         JOIN knowledge_releases r ON r.id = s.release_id
         JOIN knowledge_editions e ON e.id = r.edition_id
         JOIN knowledge_products p ON p.id = e.product_id
         JOIN knowledge_evidence_sources es ON es.id = s.source_id
        WHERE s.object_id = ANY($1::uuid[]) AND r.is_rolling
          AND s.valid_from_seq <= $2 AND (s.valid_to_seq IS NULL OR s.valid_to_seq > $2)
          AND (NOT $3 OR s.organization_id IS NULL)
        ORDER BY s.object_id, s.release_id, s.scheme, ${TRUST_RANK_SQL}`,
      [ids, seq, publicOnly],
      publicOnly ? { bypassRls: true } : {}
    );
    for (const r of res.rows) {
      const list = out.get(r.object_id) ?? [];
      list.push({
        productCode: r.product_code,
        editionCode: r.edition_code,
        releaseCode: r.release_code,
        releaseLabel: r.release_label,
        scheme: r.scheme,
        state: r.state,
        supportState: r.support_state,
        cleanCoreLevel: r.clean_core_level,
        successors: r.successors,
      });
      out.set(r.object_id, list);
    }
    for (const list of out.values()) {
      list.sort((a, b) => `${a.productCode}${a.editionCode}${a.scheme}`.localeCompare(`${b.productCode}${b.editionCode}${b.scheme}`));
    }
    return out;
  }

  async resolveByKey(sapObjectType: string, objectKey: string, publicOnly: boolean): Promise<string> {
    const res = await this.db.query(
      `SELECT id FROM knowledge_objects
        WHERE sap_object_type = upper($1) AND object_key = upper($2)
          AND (NOT $3 OR (organization_id IS NULL AND review_status = 'PUBLISHED'))
        ORDER BY (organization_id IS NULL) DESC LIMIT 1`,
      [sapObjectType, objectKey, publicOnly],
      publicOnly ? { bypassRls: true } : {}
    );
    if (!res.rows[0]) throw new NotFoundException(`Object ${sapObjectType} ${objectKey} is not in the knowledge graph`);
    return res.rows[0].id;
  }

  // ---------------------------------------------------------------------------
  // Detail
  // ---------------------------------------------------------------------------
  async getObjectDetail(id: string, options: { publicOnly: boolean }) {
    const opts = options.publicOnly ? { bypassRls: true } : {};
    const objRes = await this.db.query(
      `SELECT o.*, es.title AS primary_source_title, es.trust_level AS primary_source_trust
         FROM knowledge_objects o LEFT JOIN knowledge_evidence_sources es ON es.id = o.primary_source_id
        WHERE o.id = $1 AND (NOT $2 OR (o.organization_id IS NULL AND o.review_status = 'PUBLISHED'))`,
      [id, options.publicOnly],
      opts
    );
    const o = objRes.rows[0];
    if (!o) throw new NotFoundException('Knowledge object not found');

    const snapshot = await latestSnapshot(this.db);
    const seq = snapshot?.seq ?? 0;

    const [aliases, states, predecessors, relationships, history] = await Promise.all([
      this.db.query(
        `SELECT alias, alias_type FROM knowledge_object_aliases WHERE object_id = $1 ORDER BY alias_type, alias`,
        [id],
        opts
      ),
      this.db.query(
        `SELECT s.scheme, s.state, s.support_state, s.clean_core_level, s.successor_classification, s.successor_concept,
                s.successors, s.labels, s.software_component, s.application_component, s.confidence_class,
                s.confidence_score::float AS confidence_score, s.valid_from_seq, s.organization_id,
                r.id AS release_id, r.code AS release_code, r.label AS release_label, r.sort_order, r.is_rolling,
                e.code AS edition_code, e.name AS edition_name, p.code AS product_code, p.name AS product_name,
                es.id AS source_id, es.title AS source_title, es.trust_level, es.url AS source_url,
                es.publisher, es.last_retrieved_at, ${TRUST_RANK_SQL} AS trust_rank
           FROM knowledge_object_release_states s
           JOIN knowledge_releases r ON r.id = s.release_id
           JOIN knowledge_editions e ON e.id = r.edition_id
           JOIN knowledge_products p ON p.id = e.product_id
           JOIN knowledge_evidence_sources es ON es.id = s.source_id
          WHERE s.object_id = $1 AND s.valid_from_seq <= $2 AND (s.valid_to_seq IS NULL OR s.valid_to_seq > $2)
            AND (NOT $3 OR s.organization_id IS NULL)
          ORDER BY p.code, e.code, r.sort_order DESC, s.scheme, trust_rank`,
        [id, seq, options.publicOnly],
        opts
      ),
      this.db.query(
        `SELECT DISTINCT o2.id, o2.sap_object_type, o2.object_key, o2.object_type
           FROM knowledge_relationships rel JOIN knowledge_objects o2 ON o2.id = rel.target_object_id
          WHERE rel.source_object_id = $1 AND rel.relationship_type = 'SUCCESSOR_OF' AND rel.valid_to_seq IS NULL
            AND (NOT $2 OR rel.organization_id IS NULL)
          ORDER BY o2.object_key LIMIT 200`,
        [id, options.publicOnly],
        opts
      ),
      this.db.query(
        `SELECT rel.id, rel.relationship_type, rel.scope, rel.confidence_class, rel.review_status,
                rel.source_object_id, rel.target_object_id,
                src.object_key AS source_key, src.sap_object_type AS source_type,
                tgt.object_key AS target_key, tgt.sap_object_type AS target_type,
                r.label AS release_label, es.trust_level, es.title AS evidence_title
           FROM knowledge_relationships rel
           JOIN knowledge_objects src ON src.id = rel.source_object_id
           JOIN knowledge_objects tgt ON tgt.id = rel.target_object_id
           LEFT JOIN knowledge_releases r ON r.id = rel.release_id
           LEFT JOIN knowledge_evidence_sources es ON es.id = rel.evidence_source_id
          WHERE (rel.source_object_id = $1 OR rel.target_object_id = $1) AND rel.valid_to_seq IS NULL
            AND (NOT $2 OR rel.organization_id IS NULL)
          ORDER BY rel.relationship_type, src.object_key, tgt.object_key
          LIMIT 500`,
        [id, options.publicOnly],
        opts
      ),
      this.db.query(
        `SELECT ce.change_type, ce.previous, ce.current, ce.requires_review, ce.created_at, ce.snapshot_seq,
                r.label AS release_label
           FROM knowledge_change_events ce JOIN knowledge_releases r ON r.id = ce.release_id
          WHERE ce.object_id = $1 ORDER BY ce.snapshot_seq DESC, ce.id DESC LIMIT 50`,
        [id],
        opts
      ),
    ]);

    // Resolve successor references to object ids for navigation.
    const successorKeys = new Set<string>();
    for (const s of states.rows) {
      for (const x of Array.isArray(s.successors) ? s.successors : []) successorKeys.add(`${x.sapObjectType}|${x.objectKey}`);
    }
    const succList = [...successorKeys].map((k) => k.split('|'));
    const succRes = succList.length
      ? await this.db.query(
          `SELECT id, sap_object_type, object_key, object_type FROM knowledge_objects
            WHERE organization_id IS NULL AND (sap_object_type, object_key) IN (
              SELECT * FROM unnest($1::text[], $2::text[]))`,
          [succList.map((s) => s[0]), succList.map((s) => s[1])],
          opts
        )
      : { rows: [] as any[] };
    const succById = new Map(succRes.rows.map((r: any) => [`${r.sap_object_type}|${r.object_key}`, r]));

    const evidenceSources = new Map<string, any>();
    for (const s of states.rows) {
      evidenceSources.set(s.source_id, {
        id: s.source_id,
        title: s.source_title,
        trustLevel: s.trust_level,
        url: s.source_url,
        publisher: s.publisher,
        lastRetrievedAt: s.last_retrieved_at,
      });
    }

    let snapshotInfo: any = null;
    if (snapshot) {
      const snapRes = await this.db.query(
        `SELECT id, seq, adapter_id, content_sha256, parser_version, source_versions, published_at
           FROM knowledge_snapshots WHERE id = $1`,
        [snapshot.id],
        opts
      );
      const sr = snapRes.rows[0];
      snapshotInfo = sr && {
        id: sr.id,
        seq: Number(sr.seq),
        adapterId: sr.adapter_id,
        contentSha256: sr.content_sha256,
        parserVersion: sr.parser_version,
        publishedAt: sr.published_at,
      };
      // Attach per-source provenance (sha256, etag, retrieval date) from the snapshot manifest.
      const manifest: any[] = Array.isArray(sr?.source_versions) ? sr.source_versions : [];
      for (const ev of evidenceSources.values()) {
        const m = manifest.find((x) => x.url && x.url === ev.url);
        if (m) {
          ev.sha256 = m.sha256;
          ev.etag = m.etag;
          ev.retrievedAt = m.retrievedAt;
        }
      }
    }

    const mappedStates = states.rows.map((s: any) => ({
      productCode: s.product_code,
      productName: s.product_name,
      editionCode: s.edition_code,
      editionName: s.edition_name,
      releaseId: s.release_id,
      releaseCode: s.release_code,
      releaseLabel: s.release_label,
      isRolling: s.is_rolling,
      scheme: s.scheme,
      state: s.state,
      supportState: s.support_state,
      cleanCoreLevel: s.clean_core_level,
      successorClassification: s.successor_classification,
      successorConcept: s.successor_concept,
      successors: (Array.isArray(s.successors) ? s.successors : []).map((x: any) => ({
        sapObjectType: x.sapObjectType,
        objectKey: x.objectKey,
        objectId: succById.get(`${x.sapObjectType}|${x.objectKey}`)?.id ?? null,
      })),
      labels: s.labels,
      softwareComponent: s.software_component,
      applicationComponent: s.application_component,
      confidenceClass: s.confidence_class,
      confidenceScore: s.confidence_score,
      scope: s.organization_id ? 'TENANT' : 'GLOBAL',
      evidence: {
        sourceId: s.source_id,
        title: s.source_title,
        trustLevel: s.trust_level,
        url: s.source_url,
      },
      validFromSnapshotSeq: Number(s.valid_from_seq),
    }));

    return {
      object: {
        id: o.id,
        objectType: o.object_type,
        sapObjectType: o.sap_object_type,
        objectKey: o.object_key,
        tadirObject: o.tadir_object,
        tadirObjName: o.tadir_obj_name,
        displayName: o.display_name,
        description: o.description,
        applicationComponent: o.application_component,
        softwareComponent: o.software_component,
        scope: o.scope,
        reviewStatus: o.review_status,
        reviewedBy: o.reviewed_by,
        reviewedAt: o.reviewed_at,
        attributes: o.attributes,
        createdAt: o.created_at,
        updatedAt: o.updated_at,
      },
      aliases: aliases.rows.map((a: any) => ({ alias: a.alias, aliasType: a.alias_type })),
      states: mappedStates,
      replaces: predecessors.rows.map((p: any) => ({
        id: p.id,
        sapObjectType: p.sap_object_type,
        objectKey: p.object_key,
        objectType: p.object_type,
      })),
      relationships: relationships.rows.map((r: any) => ({
        id: r.id,
        relationshipType: r.relationship_type,
        scope: r.scope,
        confidenceClass: r.confidence_class,
        reviewStatus: r.review_status,
        direction: r.source_object_id === id ? 'OUTGOING' : 'INCOMING',
        source: { id: r.source_object_id, objectKey: r.source_key, sapObjectType: r.source_type },
        target: { id: r.target_object_id, objectKey: r.target_key, sapObjectType: r.target_type },
        releaseLabel: r.release_label,
        trustLevel: r.trust_level,
        evidenceTitle: r.evidence_title,
      })),
      evidenceSources: [...evidenceSources.values()],
      history: history.rows.map((h: any) => ({
        changeType: h.change_type,
        previous: h.previous,
        current: h.current,
        requiresReview: h.requires_review,
        releaseLabel: h.release_label,
        snapshotSeq: Number(h.snapshot_seq),
        createdAt: h.created_at,
      })),
      snapshot: snapshotInfo,
      seo: this.seoAssessment(o, mappedStates),
    };
  }

  /**
   * Programmatic SEO quality gate (Part 02 §2.9): a public page is indexable
   * only with enough verified information; otherwise it is served `noindex`.
   */
  private seoAssessment(o: any, states: any[]) {
    const official = states.filter((s) => String(s.evidence.trustLevel).startsWith('OFFICIAL_'));
    const hasStatus = official.length > 0;
    const hasReleaseSpread = new Set(official.map((s) => s.releaseId)).size >= 2;
    const needsSuccessor = official.some((s) => ['NOT_RELEASED', 'DEPRECATED', 'NO_API'].includes(s.supportState));
    const hasSuccessor = official.some((s) => s.successors.length > 0 || s.successorConcept);
    const reasons: string[] = [];
    if (o.organization_id || o.review_status !== 'PUBLISHED') reasons.push('not global published knowledge');
    if (!hasStatus) reasons.push('no official release status');
    if (!hasReleaseSpread) reasons.push('status known for fewer than two releases');
    if (needsSuccessor && !hasSuccessor) reasons.push('not released and no successor/alternative known');
    return { indexable: reasons.length === 0, reasons };
  }

  // ---------------------------------------------------------------------------
  // Neighborhood (depth-limited graph for React Flow / table fallback)
  // ---------------------------------------------------------------------------
  async getNeighborhood(id: string, depth: number, limit: number) {
    const root = await this.db.query(`SELECT id FROM knowledge_objects WHERE id = $1`, [id]);
    if (!root.rows[0]) throw new NotFoundException('Knowledge object not found');

    const nodeIds = new Set<string>([id]);
    const edges = new Map<string, any>();
    let frontier = [id];
    let truncated = false;
    for (let level = 0; level < depth && frontier.length > 0; level++) {
      const res = await this.db.query(
        `SELECT rel.source_object_id, rel.target_object_id, rel.relationship_type,
                array_agg(DISTINCT r.label ORDER BY r.label) FILTER (WHERE r.label IS NOT NULL) AS releases,
                min(${TRUST_RANK_SQL}) AS trust_rank, bool_or(rel.organization_id IS NOT NULL) AS tenant_edge,
                max(rel.confidence_class) AS confidence_class
           FROM knowledge_relationships rel
           LEFT JOIN knowledge_releases r ON r.id = rel.release_id
           LEFT JOIN knowledge_evidence_sources es ON es.id = rel.evidence_source_id
          WHERE rel.valid_to_seq IS NULL
            AND (rel.source_object_id = ANY($1::uuid[]) OR rel.target_object_id = ANY($1::uuid[]))
          GROUP BY rel.source_object_id, rel.target_object_id, rel.relationship_type
          ORDER BY rel.relationship_type
          LIMIT $2`,
        [frontier, limit * 2]
      );
      const next: string[] = [];
      for (const e of res.rows) {
        const key = `${e.source_object_id}|${e.target_object_id}|${e.relationship_type}`;
        if (edges.has(key)) continue;
        for (const n of [e.source_object_id, e.target_object_id]) {
          if (!nodeIds.has(n)) {
            if (nodeIds.size >= limit) {
              truncated = true;
              continue;
            }
            nodeIds.add(n);
            next.push(n);
          }
        }
        if (nodeIds.has(e.source_object_id) && nodeIds.has(e.target_object_id)) {
          edges.set(key, {
            id: key,
            source: e.source_object_id,
            target: e.target_object_id,
            relationshipType: e.relationship_type,
            releases: e.releases ?? [],
            trustRank: Number(e.trust_rank),
            scope: e.tenant_edge ? 'TENANT' : 'GLOBAL',
            confidenceClass: e.confidence_class,
          });
        }
      }
      frontier = next;
    }

    const nodesRes = await this.db.query(
      `SELECT id, object_type, sap_object_type, object_key, scope FROM knowledge_objects WHERE id = ANY($1::uuid[])`,
      [[...nodeIds]]
    );
    const snapshot = await latestSnapshot(this.db);
    const headline = snapshot ? await this.headlineStates([...nodeIds], snapshot.seq, false) : new Map();

    const nodes: any[] = nodesRes.rows.map((n: any) => ({
      id: n.id,
      kind: 'OBJECT',
      objectType: n.object_type,
      sapObjectType: n.sap_object_type,
      objectKey: n.object_key,
      scope: n.scope,
      isRoot: n.id === id,
      states: headline.get(n.id) ?? [],
    }));

    // Release-availability edges of the root (Part 04 §4.4 AVAILABLE_IN_RELEASE / DEPRECATED_IN_RELEASE),
    // derived from the release-state facts rather than stored twice.
    if (snapshot) {
      const rootStates: EffectiveState[] = await effectiveStatesAt(this.db, [id], snapshot.seq);
      const relIds = [...new Set(rootStates.map((s) => s.releaseId))];
      const rels = relIds.length
        ? await this.db.query(
            `SELECT r.id, r.label, r.code, e.code AS edition_code FROM knowledge_releases r
               JOIN knowledge_editions e ON e.id = r.edition_id WHERE r.id = ANY($1::uuid[])`,
            [relIds]
          )
        : { rows: [] as any[] };
      const relMap = new Map(rels.rows.map((r: any) => [r.id, r]));
      for (const s of rootStates) {
        if (s.scheme !== 'RELEASE_CONTRACT') continue;
        const type =
          s.supportState === 'RELEASED' ? 'AVAILABLE_IN_RELEASE' : s.supportState === 'DEPRECATED' ? 'DEPRECATED_IN_RELEASE' : null;
        if (!type) continue;
        const r: any = relMap.get(s.releaseId);
        const nodeId = `release:${s.releaseId}`;
        if (!nodes.some((n) => n.id === nodeId)) {
          nodes.push({ id: nodeId, kind: 'RELEASE', objectKey: r?.label ?? s.releaseId, editionCode: r?.edition_code, states: [] });
        }
        edges.set(`${id}|${nodeId}|${type}`, {
          id: `${id}|${nodeId}|${type}`,
          source: id,
          target: nodeId,
          relationshipType: type,
          releases: [r?.label].filter(Boolean),
          trustRank: 1,
          scope: 'GLOBAL',
          confidenceClass: 'VERIFIED',
        });
      }
    }

    return { rootId: id, depth, nodes, edges: [...edges.values()], truncated, snapshot };
  }

  // ---------------------------------------------------------------------------
  // Classification for engines (Clean Core integration point)
  // ---------------------------------------------------------------------------
  async resolveRelease(req: {
    productCode?: string;
    editionCode?: string;
    releaseCode?: string;
    targetRelease?: string;
  }): Promise<ResolvedRelease> {
    const find = async (productCode: string, editionCode: string, releaseCodePattern: string, exact: boolean) => {
      const res = await this.db.query(
        `SELECT r.id, r.code, r.label, e.code AS edition_code, p.code AS product_code
           FROM knowledge_releases r JOIN knowledge_editions e ON e.id = r.edition_id
           JOIN knowledge_products p ON p.id = e.product_id
          WHERE p.code = $1 AND e.code = $2 AND r.code LIKE $3
          ORDER BY r.sort_order DESC LIMIT 1`,
        [productCode, editionCode, releaseCodePattern]
      );
      const r = res.rows[0];
      return r
        ? {
            releaseId: r.id,
            productCode: r.product_code,
            editionCode: r.edition_code,
            releaseCode: r.code,
            label: r.label,
            exactMatch: exact,
          }
        : null;
    };

    if (req.productCode && req.editionCode && req.releaseCode) {
      const r = await find(req.productCode, req.editionCode, req.releaseCode, true);
      if (!r) throw new NotFoundException('Release not found in the knowledge catalog');
      return r;
    }

    const t = (req.targetRelease ?? '').toUpperCase();
    const privateYear = /^S4H_(\d{4})$/.exec(t);
    if (privateYear) {
      const year = privateYear[1];
      const r = await find('SAP_S4HANA', 'CLOUD_PRIVATE', `${year}%`, true);
      if (r) return r;
      const latest = await find('SAP_S4HANA', 'CLOUD_PRIVATE', ROLLING, false);
      if (latest) {
        return {
          ...latest,
          note: `No release-specific Cloudification Repository file exists for S/4HANA ${year}; the latest SAP Cloud ERP Private list is used (SAP recommends it for all releases).`,
        };
      }
    }
    if (/^S4HC_/.test(t)) {
      const r = await find('SAP_S4HANA', 'CLOUD_PUBLIC', ROLLING, false);
      if (r) {
        return {
          ...r,
          note: `SAP publishes only a rolling list for SAP Cloud ERP (public); ${t} is evaluated against the current list.`,
        };
      }
    }
    const fallback = await find('SAP_S4HANA', 'CLOUD_PRIVATE', ROLLING, false);
    if (!fallback) {
      throw new ConflictException('The knowledge graph has no published snapshot yet — run the knowledge sync first');
    }
    return { ...fallback, note: 'No target release given; the latest SAP Cloud ERP Private list is used.' };
  }

  async classifyObjects(req: ClassifyRequest): Promise<ClassificationResult> {
    const snapshot = await latestSnapshot(this.db);
    if (!snapshot) {
      throw new ConflictException('The knowledge graph has no published snapshot yet — run the knowledge sync first');
    }
    const snapRow = await this.db.query(`SELECT content_sha256, adapter_id FROM knowledge_snapshots WHERE id = $1`, [snapshot.id]);
    const release = await this.resolveRelease(req);
    const names = [...new Set(req.names.map((n) => n.trim().toUpperCase()).filter(Boolean))];

    const objRes = await this.db.query(
      `SELECT id, object_type, sap_object_type, tadir_object, object_key
         FROM knowledge_objects WHERE organization_id IS NULL AND object_key = ANY($1::text[])`,
      [names]
    );
    const ids = objRes.rows.map((r: any) => r.id);
    const states = await effectiveStatesAt(this.db, ids, snapshot.seq, release.releaseId);
    // Classic API classification is published for SAP Cloud ERP Private (latest) only.
    let classic: EffectiveState[] = [];
    if (release.editionCode === 'CLOUD_PRIVATE') {
      const latestPrivate = await this.db.query(
        `SELECT r.id FROM knowledge_releases r JOIN knowledge_editions e ON e.id = r.edition_id
           JOIN knowledge_products p ON p.id = e.product_id
          WHERE p.code = 'SAP_S4HANA' AND e.code = 'CLOUD_PRIVATE' AND r.code = 'LATEST'`
      );
      if (latestPrivate.rows[0]) {
        classic = (await effectiveStatesAt(this.db, ids, snapshot.seq, latestPrivate.rows[0].id)).filter(
          (s) => s.scheme === 'CLASSIC_API_CLASSIFICATION'
        );
      }
    }
    const contract = new Map(states.filter((s) => s.scheme === 'RELEASE_CONTRACT').map((s) => [s.objectId, s]));
    const classicMap = new Map(classic.map((s) => [s.objectId, s]));
    const objectsOut: ClassifiedObject[] = [];
    for (const o of objRes.rows) {
      const s = contract.get(o.id);
      const c = classicMap.get(o.id);
      if (!s && !c) continue;
      objectsOut.push({
        name: o.object_key,
        sapObjectType: o.sap_object_type,
        tadirObject: o.tadir_object,
        objectType: o.object_type,
        state: s?.state ?? null,
        supportState: s?.supportState ?? null,
        cleanCoreLevel: s?.cleanCoreLevel ?? c?.cleanCoreLevel ?? null,
        classicApiState: c?.state ?? null,
        successorClassification: s?.successorClassification ?? null,
        successorConcept: s?.successorConcept ?? null,
        successors: (s?.successors ?? c?.successors ?? []).map((x) => ({ objectType: x.sapObjectType, name: x.objectKey })),
        applicationComponent: null,
        softwareComponent: null,
        trustLevel: s?.trustLevel ?? c?.trustLevel ?? null,
      });
    }
    objectsOut.sort((a, b) => a.name.localeCompare(b.name) || a.sapObjectType.localeCompare(b.sapObjectType));
    const found = new Set(objectsOut.map((o) => o.name));
    return {
      snapshotId: snapshot.id,
      snapshotSeq: snapshot.seq,
      contentSha256: snapRow.rows[0].content_sha256,
      source: snapRow.rows[0].adapter_id,
      release,
      objects: objectsOut,
      notFound: names.filter((n) => !found.has(n)).sort(),
    };
  }

  // ---------------------------------------------------------------------------
  // Tenant (customer) knowledge — Part 04 §4.5
  // ---------------------------------------------------------------------------
  async createTenantObject(
    organizationId: string,
    dto: { objectType: string; sapObjectType: string; objectKey: string; displayName?: string; description?: string }
  ) {
    try {
      const res = await this.db.query(
        `INSERT INTO knowledge_objects (organization_id, scope, object_type, sap_object_type, object_key,
                                        display_name, description, review_status)
         VALUES ($1, 'TENANT', $2, upper($3), upper($4), $5, $6, 'APPROVED')
         RETURNING id, object_type, sap_object_type, object_key, scope, review_status, created_at`,
        [organizationId, dto.objectType, dto.sapObjectType, dto.objectKey, dto.displayName ?? null, dto.description ?? null]
      );
      return res.rows[0];
    } catch (err: any) {
      if (err?.code === '23505') throw new ConflictException('This customer object already exists');
      throw err;
    }
  }

  async createTenantRelationship(
    organizationId: string,
    userId: string,
    dto: { sourceObjectId: string; targetObjectId: string; relationshipType: RelationshipType; confidenceClass: string; note?: string }
  ) {
    if (dto.sourceObjectId === dto.targetObjectId) throw new BadRequestException('An object cannot relate to itself');
    const ends = await this.db.query(
      `SELECT id, organization_id FROM knowledge_objects WHERE id = ANY($1::uuid[])`,
      [[dto.sourceObjectId, dto.targetObjectId]]
    );
    if (ends.rows.length !== 2) throw new NotFoundException('Source or target object not found');
    if (!ends.rows.some((r: any) => r.organization_id === organizationId)) {
      // Customer edges always touch at least one customer object; SAP-to-SAP facts are global knowledge.
      throw new BadRequestException('Tenant relationships must involve at least one customer object');
    }
    const score = { VERIFIED: 1, RULE_DERIVED: 0.85, INFERRED: 0.6, UNKNOWN: 0.3 }[dto.confidenceClass] ?? 0.3;
    try {
      const res = await this.db.query(
        `INSERT INTO knowledge_relationships (organization_id, scope, source_object_id, target_object_id,
                                              relationship_type, confidence_class, confidence_score, review_status,
                                              attributes, created_by)
         VALUES ($1, 'TENANT', $2, $3, $4, $5, $6, 'APPROVED', $7, $8)
         RETURNING id, relationship_type, scope, confidence_class, created_at`,
        [
          organizationId,
          dto.sourceObjectId,
          dto.targetObjectId,
          dto.relationshipType,
          dto.confidenceClass,
          score,
          JSON.stringify(dto.note ? { note: dto.note } : {}),
          userId,
        ]
      );
      return res.rows[0];
    } catch (err: any) {
      if (err?.code === '23505') throw new ConflictException('This relationship already exists');
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Snapshots, sync runs and curation (admin)
  // ---------------------------------------------------------------------------
  async listSnapshots(limit = 50) {
    const res = await this.db.query(
      `SELECT id, seq, adapter_id, status, content_sha256, parser_version, source_versions, stats, diff_summary,
              previous_snapshot_id, triggered_by, created_at, published_at
         FROM knowledge_snapshots WHERE status = 'PUBLISHED' ORDER BY seq DESC LIMIT $1`,
      [limit]
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      seq: Number(r.seq),
      adapterId: r.adapter_id,
      status: r.status,
      contentSha256: r.content_sha256,
      parserVersion: r.parser_version,
      sourceVersions: r.source_versions,
      stats: r.stats,
      diffSummary: r.diff_summary,
      previousSnapshotId: r.previous_snapshot_id,
      triggeredBy: r.triggered_by,
      createdAt: r.created_at,
      publishedAt: r.published_at,
    }));
  }

  async listSyncRuns(limit = 50) {
    const res = await this.db.query(
      `SELECT id, adapter_id, trigger, triggered_by, status, snapshot_id, content_sha256, source_results, stats,
              error_message, started_at, finished_at
         FROM knowledge_sync_runs ORDER BY started_at DESC LIMIT $1`,
      [limit],
      { bypassRls: true }
    );
    return res.rows;
  }

  async createCuratedObject(
    reviewer: string,
    dto: { objectType: string; sapObjectType: string; objectKey: string; displayName?: string; description: string; evidenceSourceKey: string }
  ) {
    const src = await this.db.query(
      `SELECT id FROM knowledge_evidence_sources WHERE organization_id IS NULL AND source_key = $1`,
      [dto.evidenceSourceKey],
      { bypassRls: true }
    );
    if (!src.rows[0]) throw new BadRequestException('Unknown evidence source key');
    try {
      const res = await this.db.query(
        `INSERT INTO knowledge_objects (organization_id, scope, object_type, sap_object_type, object_key, display_name,
                                        description, review_status, primary_source_id, attributes)
         VALUES (NULL, 'GLOBAL', $1, upper($2), upper($3), $4, $5, 'DRAFT', $6, $7)
         RETURNING id, review_status`,
        [dto.objectType, dto.sapObjectType, dto.objectKey, dto.displayName ?? null, dto.description, src.rows[0].id,
          JSON.stringify({ curatedBy: reviewer })],
        { bypassRls: true }
      );
      return res.rows[0];
    } catch (err: any) {
      if (err?.code === '23505') {
        // The object exists (e.g. from the official sync): curate its description as a draft note instead.
        throw new ConflictException('A global object with this type and key already exists');
      }
      throw err;
    }
  }

  async transitionReview(id: string, to: string, reviewer: string) {
    const cur = await this.db.query(
      `SELECT review_status FROM knowledge_objects WHERE id = $1 AND organization_id IS NULL`,
      [id],
      { bypassRls: true }
    );
    if (!cur.rows[0]) throw new NotFoundException('Global knowledge object not found');
    const from = cur.rows[0].review_status;
    if (!(REVIEW_TRANSITIONS[from] ?? []).includes(to)) {
      throw new BadRequestException(`Review transition ${from} -> ${to} is not allowed`);
    }
    const res = await this.db.query(
      `UPDATE knowledge_objects SET review_status = $2, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
        WHERE id = $1 RETURNING id, review_status, reviewed_by, reviewed_at`,
      [id, to, reviewer],
      { bypassRls: true }
    );
    return res.rows[0];
  }

  async listEvidenceSources() {
    const res = await this.db.query(
      `SELECT id, source_key, trust_level, title, publisher, url, status, last_retrieved_at, organization_id
         FROM knowledge_evidence_sources ORDER BY (organization_id IS NULL) DESC, trust_level, source_key`
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      sourceKey: r.source_key,
      trustLevel: r.trust_level,
      title: r.title,
      publisher: r.publisher,
      url: r.url,
      status: r.status,
      lastRetrievedAt: r.last_retrieved_at,
      scope: r.organization_id ? 'TENANT' : 'GLOBAL',
    }));
  }
}
