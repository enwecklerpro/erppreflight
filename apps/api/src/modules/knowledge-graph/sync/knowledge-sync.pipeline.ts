import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { canonicalObjectType } from '../sources/cloudification-normalizer';
import type {
  NormalizedObjectState,
  ReleaseContext,
  ReleasedObjectSource,
  SourceDocument,
} from '../knowledge-graph.types';
import { batchInsert } from './batch-insert';

export type SyncTrigger = 'SCHEDULED' | 'ADMIN' | 'CLI' | 'FILE_IMPORT';

export interface SyncLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface DiffSummary {
  initialSnapshot: boolean;
  statesAdded: number;
  statesRemoved: number;
  statesChanged: number;
  edgesAdded: number;
  edgesRemoved: number;
  objectsCreated: number;
  byChangeType: Record<string, number>;
}

export interface SyncResult {
  runId: string;
  adapterId: string;
  status: 'NOOP' | 'PUBLISHED' | 'FAILED';
  contentSha256: string | null;
  snapshotId: string | null;
  snapshotSeq: number | null;
  previousSnapshotId: string | null;
  previousSnapshotSeq: number | null;
  documents: Array<{ sourceKey: string; sha256: string; bytes: number; records: number; rejected: number; etag: string | null }>;
  diff: DiffSummary | null;
  durationMs: number;
  error?: string;
}

/** Stable advisory-lock key: only one knowledge sync may write at a time. */
const SYNC_LOCK_KEY = 734_001_014;

export function stateContentHash(r: NormalizedObjectState): string {
  const canonical = JSON.stringify([
    r.state,
    r.supportState,
    r.cleanCoreLevel,
    r.successorClassification,
    r.successorConcept,
    r.successors.map((s) => [s.sapObjectType, s.objectKey]),
    r.labels,
    r.softwareComponent,
    r.applicationComponent,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** Composite content hash of a sync: parser version + every document checksum (order independent). */
export function compositeContentHash(parserVersion: string, docs: SourceDocument[]): string {
  const parts = docs
    .map((d) => `${d.sourceKey}|${d.scheme}|${d.release.productCode}/${d.release.editionCode}/${d.release.releaseCode}|${d.sha256}`)
    .sort();
  return createHash('sha256').update([parserVersion, ...parts].join('\n')).digest('hex');
}

function releaseKey(r: ReleaseContext): string {
  return `${r.productCode}|${r.editionCode}|${r.releaseCode}`;
}

/**
 * Knowledge source sync pipeline (Part 14.14, C §27):
 *   retrieve -> checksum -> idempotency check -> version (snapshot) -> normalize
 *   -> diff against the current facts -> persist in batches -> change events.
 *
 * Runs with a plain pg Pool so it works identically from the BullMQ worker and
 * the CLI. The pool MUST connect as the schema owner (DATABASE_URL): global
 * knowledge is writable only outside the RLS runtime role (migration 014).
 * Everything after retrieval happens in ONE transaction: a failure never leaves
 * a partial snapshot behind.
 */
export class KnowledgeSyncPipeline {
  constructor(
    private readonly pool: Pool,
    private readonly logger: SyncLogger
  ) {}

  async run(
    source: ReleasedObjectSource,
    options: { trigger: SyncTrigger; triggeredBy?: string | null }
  ): Promise<SyncResult> {
    const started = Date.now();
    const runRes = await this.pool.query(
      `INSERT INTO knowledge_sync_runs (adapter_id, trigger, triggered_by, status)
       VALUES ($1, $2, $3, 'RUNNING') RETURNING id`,
      [source.adapterId, options.trigger, options.triggeredBy ?? null]
    );
    const runId: string = runRes.rows[0].id;
    const base: SyncResult = {
      runId,
      adapterId: source.adapterId,
      status: 'FAILED',
      contentSha256: null,
      snapshotId: null,
      snapshotSeq: null,
      previousSnapshotId: null,
      previousSnapshotSeq: null,
      documents: [],
      diff: null,
      durationMs: 0,
    };

    let docs: SourceDocument[];
    try {
      docs = await source.retrieve();
      if (docs.length === 0) throw new Error('Source returned no documents');
    } catch (err: any) {
      return this.fail(base, started, `Retrieval failed: ${err?.message ?? err}`);
    }

    base.documents = docs.map((d) => ({
      sourceKey: d.sourceKey,
      sha256: d.sha256,
      bytes: d.bytes,
      records: d.records.length,
      rejected: d.rejectedRecords,
      etag: d.etag,
    }));
    const contentSha256 = compositeContentHash(source.parserVersion, docs);
    base.contentSha256 = contentSha256;
    this.logger.log(
      `Knowledge sync ${runId} [${source.adapterId}]: retrieved ${docs.length} documents, ` +
        `${docs.reduce((n, d) => n + d.records.length, 0)} records, content ${contentSha256.slice(0, 12)}`
    );

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [SYNC_LOCK_KEY]);

      const prev = await client.query(
        `SELECT id, seq, content_sha256 FROM knowledge_snapshots
          WHERE adapter_id = $1 AND status = 'PUBLISHED' ORDER BY seq DESC LIMIT 1`,
        [source.adapterId]
      );
      const previous = prev.rows[0] as { id: string; seq: string; content_sha256: string } | undefined;
      base.previousSnapshotId = previous?.id ?? null;
      base.previousSnapshotSeq = previous ? Number(previous.seq) : null;

      if (previous && previous.content_sha256 === contentSha256) {
        await client.query('ROLLBACK');
        await this.pool.query(
          `UPDATE knowledge_sync_runs SET status = 'NOOP', content_sha256 = $2, snapshot_id = $3,
                  source_results = $4, finished_at = NOW() WHERE id = $1`,
          [runId, contentSha256, previous.id, JSON.stringify(base.documents)]
        );
        this.logger.log(`Knowledge sync ${runId}: content unchanged (snapshot seq ${previous.seq}) — no new snapshot`);
        return {
          ...base,
          status: 'NOOP',
          snapshotId: previous.id,
          snapshotSeq: Number(previous.seq),
          durationMs: Date.now() - started,
        };
      }

      const releaseIds = await this.upsertCatalog(client, docs);
      const sourceIds = await this.upsertEvidenceSources(client, docs, releaseIds);

      const snap = await client.query(
        `INSERT INTO knowledge_snapshots (adapter_id, status, content_sha256, parser_version, source_versions,
                                          previous_snapshot_id, triggered_by)
         VALUES ($1, 'BUILDING', $2, $3, $4, $5, $6) RETURNING id, seq`,
        [
          source.adapterId,
          contentSha256,
          source.parserVersion,
          JSON.stringify(
            docs.map((d) => ({
              sourceKey: d.sourceKey,
              url: d.url,
              sha256: d.sha256,
              bytes: d.bytes,
              etag: d.etag,
              lastModified: d.lastModified,
              sourceVersion: d.sourceVersion,
              formatVersion: d.formatVersion,
              retrievedAt: d.retrievedAt,
              records: d.records.length,
              rejectedRecords: d.rejectedRecords,
              trustLevel: d.trustLevel,
              scheme: d.scheme,
              release: releaseKey(d.release),
            }))
          ),
          previous?.id ?? null,
          `${options.trigger}${options.triggeredBy ? `:${options.triggeredBy}` : ''}`,
        ]
      );
      const snapshotId: string = snap.rows[0].id;
      const seq = Number(snap.rows[0].seq);

      const diff = await this.persistAndDiff(client, source, docs, releaseIds, sourceIds, snapshotId, seq, !previous);

      await client.query(
        `UPDATE knowledge_snapshots SET status = 'PUBLISHED', published_at = NOW(), stats = $2, diff_summary = $3
          WHERE id = $1`,
        [
          snapshotId,
          JSON.stringify({
            documents: docs.length,
            records: docs.reduce((n, d) => n + d.records.length, 0),
            rejectedRecords: docs.reduce((n, d) => n + d.rejectedRecords, 0),
            bytes: docs.reduce((n, d) => n + d.bytes, 0),
          }),
          JSON.stringify(diff),
        ]
      );
      await client.query('COMMIT');

      await this.pool.query(
        `UPDATE knowledge_sync_runs SET status = 'PUBLISHED', snapshot_id = $2, content_sha256 = $3,
                source_results = $4, stats = $5, finished_at = NOW() WHERE id = $1`,
        [runId, snapshotId, contentSha256, JSON.stringify(base.documents), JSON.stringify(diff)]
      );
      this.logger.log(
        `Knowledge sync ${runId}: published snapshot seq ${seq} (+${diff.statesAdded} / ~${diff.statesChanged} / -${diff.statesRemoved} states, ` +
          `+${diff.edgesAdded} / -${diff.edgesRemoved} edges, ${diff.objectsCreated} new objects) in ${Date.now() - started} ms`
      );
      return {
        ...base,
        status: 'PUBLISHED',
        snapshotId,
        snapshotSeq: seq,
        diff,
        durationMs: Date.now() - started,
      };
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      return this.fail(base, started, err?.message ?? String(err));
    } finally {
      client.release();
    }
  }

  private async fail(base: SyncResult, started: number, message: string): Promise<SyncResult> {
    this.logger.error(`Knowledge sync ${base.runId} failed: ${message}`);
    await this.pool
      .query(
        `UPDATE knowledge_sync_runs SET status = 'FAILED', error_message = $2, content_sha256 = $3,
                source_results = $4, finished_at = NOW() WHERE id = $1`,
        [base.runId, message.slice(0, 4000), base.contentSha256, JSON.stringify(base.documents)]
      )
      .catch(() => undefined);
    return { ...base, status: 'FAILED', error: message, durationMs: Date.now() - started };
  }

  private async upsertCatalog(client: PoolClient, docs: SourceDocument[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const d of docs) {
      const r = d.release;
      const key = releaseKey(r);
      if (out.has(key)) continue;
      const p = await client.query(
        `INSERT INTO knowledge_products (code, name) VALUES ($1, $2)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [r.productCode, r.productName]
      );
      const e = await client.query(
        `INSERT INTO knowledge_editions (product_id, code, name, deployment) VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id, code) DO UPDATE SET name = EXCLUDED.name, deployment = EXCLUDED.deployment
         RETURNING id`,
        [p.rows[0].id, r.editionCode, r.editionName, r.deployment]
      );
      const rel = await client.query(
        `INSERT INTO knowledge_releases (edition_id, code, label, feature_pack, sort_order, is_rolling, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (edition_id, code) DO UPDATE SET label = EXCLUDED.label, feature_pack = EXCLUDED.feature_pack,
           sort_order = EXCLUDED.sort_order, is_rolling = EXCLUDED.is_rolling,
           description = COALESCE(EXCLUDED.description, knowledge_releases.description)
         RETURNING id`,
        [e.rows[0].id, r.releaseCode, r.releaseLabel, r.featurePack, r.sortOrder, r.isRolling, r.description ?? null]
      );
      out.set(key, rel.rows[0].id);
    }
    return out;
  }

  private async upsertEvidenceSources(
    client: PoolClient,
    docs: SourceDocument[],
    releaseIds: Map<string, string>
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const d of docs) {
      const res = await client.query(
        `INSERT INTO knowledge_evidence_sources (organization_id, source_key, trust_level, title, publisher, url,
                                                 target_release_id, reviewer, last_retrieved_at, publication_date)
         VALUES (NULL, $1, $2, $3, $4, $5, $6, 'system:source-sync', $7, $8)
         ON CONFLICT (source_key) WHERE organization_id IS NULL DO UPDATE SET
           trust_level = EXCLUDED.trust_level, title = EXCLUDED.title, publisher = EXCLUDED.publisher,
           url = EXCLUDED.url, target_release_id = EXCLUDED.target_release_id,
           last_retrieved_at = EXCLUDED.last_retrieved_at,
           publication_date = COALESCE(EXCLUDED.publication_date, knowledge_evidence_sources.publication_date),
           updated_at = NOW()
         RETURNING id`,
        [
          d.sourceKey,
          d.trustLevel,
          d.title,
          d.publisher,
          d.url,
          releaseIds.get(releaseKey(d.release)) ?? null,
          d.retrievedAt,
          d.lastModified ? new Date(d.lastModified).toISOString() : null,
        ]
      );
      out.set(d.sourceKey, res.rows[0].id);
    }
    return out;
  }

  private async persistAndDiff(
    client: PoolClient,
    source: ReleasedObjectSource,
    docs: SourceDocument[],
    releaseIds: Map<string, string>,
    sourceIds: Map<string, string>,
    snapshotId: string,
    seq: number,
    initialSnapshot: boolean
  ): Promise<DiffSummary> {
    // ---- 1. Objects referenced by this sync (records + successors), deduplicated.
    const objects = new Map<string, unknown[]>();
    const addObject = (
      sapType: string,
      key: string,
      tadirObject: string | null,
      tadirName: string | null,
      appComp: string | null,
      swComp: string | null,
      sourceId: string,
      referencedOnly: boolean
    ) => {
      const k = `${sapType}|${key}`;
      const existing = objects.get(k);
      if (existing && !(existing[8] === 'true' && !referencedOnly)) return;
      objects.set(k, [
        canonicalObjectType(sapType, key, tadirObject),
        sapType,
        key,
        tadirObject,
        tadirName,
        appComp,
        swComp,
        sourceId,
        referencedOnly ? 'true' : 'false',
      ]);
    };
    for (const d of docs) {
      const sid = sourceIds.get(d.sourceKey)!;
      for (const r of d.records) {
        addObject(r.sapObjectType, r.objectKey, r.tadirObject, r.tadirObjName, r.applicationComponent, r.softwareComponent, sid, false);
        for (const s of r.successors) {
          addObject(s.sapObjectType, s.objectKey, s.tadirObject ?? null, s.tadirObjName ?? null, null, null, sid, true);
        }
      }
    }

    await client.query(`CREATE TEMP TABLE kg_stage_objects (
        object_type text, sap_object_type text, object_key text, tadir_object text, tadir_obj_name text,
        application_component text, software_component text, source_id uuid, referenced_only boolean
      ) ON COMMIT DROP`);
    await batchInsert(
      client,
      'kg_stage_objects',
      [
        { name: 'object_type', arrayType: 'text' },
        { name: 'sap_object_type', arrayType: 'text' },
        { name: 'object_key', arrayType: 'text' },
        { name: 'tadir_object', arrayType: 'text' },
        { name: 'tadir_obj_name', arrayType: 'text' },
        { name: 'application_component', arrayType: 'text' },
        { name: 'software_component', arrayType: 'text' },
        { name: 'source_id', arrayType: 'uuid' },
        { name: 'referenced_only', arrayType: 'boolean' },
      ],
      [...objects.values()].map((o) => [...o.slice(0, 8), o[8] === 'true'])
    );

    const created = await client.query(
      `INSERT INTO knowledge_objects (organization_id, scope, object_type, sap_object_type, object_key, tadir_object,
                                      tadir_obj_name, application_component, software_component, attributes,
                                      review_status, reviewed_by, reviewed_at, primary_source_id, first_seen_snapshot_id)
       SELECT NULL, 'GLOBAL', s.object_type, s.sap_object_type, s.object_key, s.tadir_object, s.tadir_obj_name,
              s.application_component, s.software_component,
              CASE WHEN s.referenced_only THEN '{"referencedOnly": true}'::jsonb ELSE '{}'::jsonb END,
              'PUBLISHED', $1, NOW(), s.source_id, $2
         FROM kg_stage_objects s
       ON CONFLICT (sap_object_type, object_key) WHERE organization_id IS NULL DO NOTHING`,
      [`system:${source.adapterId}`, snapshotId]
    );
    // Objects first seen only as a successor reference gain their own attributes once a record appears.
    await client.query(
      `UPDATE knowledge_objects o
          SET tadir_object = s.tadir_object, tadir_obj_name = s.tadir_obj_name,
              application_component = s.application_component, software_component = s.software_component,
              attributes = o.attributes - 'referencedOnly', updated_at = NOW()
         FROM kg_stage_objects s
        WHERE o.organization_id IS NULL AND o.sap_object_type = s.sap_object_type AND o.object_key = s.object_key
          AND NOT s.referenced_only AND (o.attributes ? 'referencedOnly')`
    );
    await client.query(
      `INSERT INTO knowledge_object_aliases (object_id, organization_id, alias, alias_type, source_id)
       SELECT o.id, NULL, s.tadir_obj_name, 'TADIR_CONTAINER', s.source_id
         FROM kg_stage_objects s
         JOIN knowledge_objects o ON o.organization_id IS NULL AND o.sap_object_type = s.sap_object_type
                                 AND o.object_key = s.object_key
        WHERE s.tadir_obj_name IS NOT NULL AND s.tadir_obj_name <> s.object_key
       ON CONFLICT (object_id, alias, alias_type) DO NOTHING`
    );

    // ---- 2. Stage all states of this sync.
    await client.query(`CREATE TEMP TABLE kg_stage_states (
        source_id uuid, release_id uuid, scheme text, sap_object_type text, object_key text, state text,
        support_state text, clean_core_level text, successor_classification text, successor_concept text,
        successors jsonb, labels jsonb, software_component text, application_component text, content_hash text,
        object_id uuid
      ) ON COMMIT DROP`);
    const stateRows: unknown[][] = [];
    for (const d of docs) {
      const sid = sourceIds.get(d.sourceKey)!;
      const rid = releaseIds.get(releaseKey(d.release))!;
      for (const r of d.records) {
        stateRows.push([
          sid,
          rid,
          r.scheme,
          r.sapObjectType,
          r.objectKey,
          r.state,
          r.supportState,
          r.cleanCoreLevel,
          r.successorClassification,
          r.successorConcept,
          JSON.stringify(r.successors),
          JSON.stringify(r.labels),
          r.softwareComponent,
          r.applicationComponent,
          stateContentHash(r),
        ]);
      }
    }
    await batchInsert(
      client,
      'kg_stage_states',
      [
        { name: 'source_id', arrayType: 'uuid' },
        { name: 'release_id', arrayType: 'uuid' },
        { name: 'scheme', arrayType: 'text' },
        { name: 'sap_object_type', arrayType: 'text' },
        { name: 'object_key', arrayType: 'text' },
        { name: 'state', arrayType: 'text' },
        { name: 'support_state', arrayType: 'text' },
        { name: 'clean_core_level', arrayType: 'text' },
        { name: 'successor_classification', arrayType: 'text' },
        { name: 'successor_concept', arrayType: 'text' },
        { name: 'successors', arrayType: 'text', cast: 'jsonb' },
        { name: 'labels', arrayType: 'text', cast: 'jsonb' },
        { name: 'software_component', arrayType: 'text' },
        { name: 'application_component', arrayType: 'text' },
        { name: 'content_hash', arrayType: 'text' },
      ],
      stateRows
    );
    await client.query(
      `UPDATE kg_stage_states s SET object_id = o.id
         FROM knowledge_objects o
        WHERE o.organization_id IS NULL AND o.sap_object_type = s.sap_object_type AND o.object_key = s.object_key`
    );
    await client.query('CREATE INDEX ON kg_stage_states (object_id, release_id, scheme, source_id)');
    await client.query('ANALYZE kg_stage_states');

    const sourceIdList = [...new Set(sourceIds.values())];
    await client.query(
      `CREATE TEMP TABLE kg_cur_states ON COMMIT DROP AS
       SELECT id, object_id, release_id, scheme, source_id, content_hash, state, support_state,
              successors, successor_classification, successor_concept
         FROM knowledge_object_release_states
        WHERE valid_to_seq IS NULL AND organization_id IS NULL AND source_id = ANY($1::uuid[])`,
      [sourceIdList]
    );
    await client.query('CREATE INDEX ON kg_cur_states (object_id, release_id, scheme, source_id)');
    await client.query('ANALYZE kg_cur_states');

    // ---- 3. Diff: classify every change, then close / open validity ranges.
    await client.query(`CREATE TEMP TABLE kg_diff ON COMMIT DROP AS
       SELECT c.id AS cur_id, s.object_id AS new_object_id, c.object_id AS cur_object_id,
              COALESCE(s.release_id, c.release_id) AS release_id, COALESCE(s.scheme, c.scheme) AS scheme,
              CASE
                WHEN c.id IS NULL THEN 'ADDED'
                WHEN s.object_id IS NULL THEN 'REMOVED'
                WHEN c.content_hash <> s.content_hash THEN 'CHANGED'
                ELSE 'SAME'
              END AS kind,
              c.support_state AS prev_support, s.support_state AS new_support,
              c.state AS prev_state, s.state AS new_state,
              c.successors AS prev_successors, s.successors AS new_successors,
              c.successor_concept AS prev_concept, s.successor_concept AS new_concept
         FROM kg_stage_states s
         FULL OUTER JOIN kg_cur_states c
           ON c.object_id = s.object_id AND c.release_id = s.release_id AND c.scheme = s.scheme
          AND c.source_id = s.source_id`);

    const counts = await client.query(`SELECT kind, COUNT(*)::int AS n FROM kg_diff GROUP BY kind`);
    const byKind: Record<string, number> = {};
    for (const row of counts.rows) byKind[row.kind] = row.n;

    const changeTypeSql = `CASE
        WHEN d.kind = 'ADDED' AND d.new_support = 'RELEASED' THEN 'NEWLY_RELEASED'
        WHEN d.kind = 'ADDED' THEN 'STATE_ADDED'
        WHEN d.kind = 'REMOVED' THEN 'STATE_REMOVED'
        WHEN d.prev_support IS DISTINCT FROM d.new_support AND d.new_support = 'RELEASED' THEN 'NEWLY_RELEASED'
        WHEN d.prev_support IS DISTINCT FROM d.new_support AND d.new_support = 'DEPRECATED' THEN 'NEWLY_DEPRECATED'
        WHEN d.prev_support IN ('RELEASED', 'DEPRECATED') AND d.new_support NOT IN ('RELEASED', 'DEPRECATED') THEN 'RELEASE_WITHDRAWN'
        WHEN d.prev_support IS DISTINCT FROM d.new_support OR d.prev_state IS DISTINCT FROM d.new_state THEN 'STATE_CHANGED'
        WHEN d.prev_successors IS DISTINCT FROM d.new_successors OR d.prev_concept IS DISTINCT FROM d.new_concept THEN 'SUCCESSOR_CHANGED'
        ELSE 'ATTRIBUTES_CHANGED'
      END`;

    // Per-object change events are recorded for every non-initial snapshot (the
    // initial load is summarised by counts only — it would be 100k+ "added" rows).
    const byChangeType: Record<string, number> = {};
    const evCounts = await client.query(
      `SELECT ${changeTypeSql} AS change_type, COUNT(*)::int AS n FROM kg_diff d WHERE d.kind <> 'SAME' GROUP BY 1`
    );
    for (const row of evCounts.rows) byChangeType[row.change_type] = row.n;
    if (!initialSnapshot) {
      await client.query(
        `INSERT INTO knowledge_change_events (snapshot_id, snapshot_seq, change_type, object_id, release_id, scheme,
                                              previous, current, requires_review)
         SELECT $1, $2, ${changeTypeSql}, COALESCE(d.new_object_id, d.cur_object_id), d.release_id, d.scheme,
                CASE WHEN d.cur_id IS NULL THEN NULL ELSE jsonb_build_object(
                  'state', d.prev_state, 'supportState', d.prev_support, 'successors', d.prev_successors,
                  'successorConcept', d.prev_concept) END,
                CASE WHEN d.new_object_id IS NULL THEN NULL ELSE jsonb_build_object(
                  'state', d.new_state, 'supportState', d.new_support, 'successors', d.new_successors,
                  'successorConcept', d.new_concept) END,
                COALESCE(d.kind = 'REMOVED' OR (d.prev_support IN ('RELEASED', 'DEPRECATED')
                                        AND d.new_support NOT IN ('RELEASED', 'DEPRECATED')), false)
           FROM kg_diff d WHERE d.kind <> 'SAME'`,
        [snapshotId, seq]
      );
    }

    await client.query(
      `UPDATE knowledge_object_release_states SET valid_to_seq = $1
        WHERE id IN (SELECT cur_id FROM kg_diff WHERE kind IN ('REMOVED', 'CHANGED'))`,
      [seq]
    );
    await client.query(
      `INSERT INTO knowledge_object_release_states (
          object_id, organization_id, release_id, scheme, state, support_state, clean_core_level,
          successor_classification, successor_concept, successors, labels, software_component,
          application_component, source_id, confidence_class, confidence_score, content_hash, valid_from_seq)
       SELECT s.object_id, NULL, s.release_id, s.scheme, s.state, s.support_state, s.clean_core_level,
              s.successor_classification, s.successor_concept, s.successors, s.labels, s.software_component,
              s.application_component, s.source_id,
              CASE WHEN es.trust_level LIKE 'OFFICIAL_%' THEN 'VERIFIED' ELSE 'RULE_DERIVED' END,
              CASE WHEN es.trust_level LIKE 'OFFICIAL_%' THEN 1.000 ELSE 0.850 END,
              s.content_hash, $1
         FROM kg_stage_states s
         JOIN knowledge_evidence_sources es ON es.id = s.source_id
         LEFT JOIN kg_cur_states c
           ON c.object_id = s.object_id AND c.release_id = s.release_id AND c.scheme = s.scheme
          AND c.source_id = s.source_id
        WHERE c.id IS NULL OR c.content_hash <> s.content_hash`,
      [seq]
    );

    // ---- 4. Successor edges: successor SUCCESSOR_OF predecessor, per release context.
    await client.query(`CREATE TEMP TABLE kg_stage_edges ON COMMIT DROP AS
       SELECT DISTINCT so.id AS source_object_id, s.object_id AS target_object_id, s.release_id, s.source_id
         FROM kg_stage_states s
         CROSS JOIN LATERAL jsonb_array_elements(s.successors) e
         JOIN knowledge_objects so ON so.organization_id IS NULL
                                  AND so.sap_object_type = e->>'sapObjectType' AND so.object_key = e->>'objectKey'
        WHERE so.id <> s.object_id`);
    const edgesRemoved = await client.query(
      `UPDATE knowledge_relationships r SET valid_to_seq = $1, updated_at = NOW()
        WHERE r.valid_to_seq IS NULL AND r.organization_id IS NULL AND r.relationship_type = 'SUCCESSOR_OF'
          AND r.evidence_source_id = ANY($2::uuid[])
          AND NOT EXISTS (SELECT 1 FROM kg_stage_edges e
                           WHERE e.source_object_id = r.source_object_id AND e.target_object_id = r.target_object_id
                             AND e.release_id = r.release_id AND e.source_id = r.evidence_source_id)`,
      [seq, sourceIdList]
    );
    const edgesAdded = await client.query(
      `INSERT INTO knowledge_relationships (organization_id, scope, source_object_id, target_object_id,
                                            relationship_type, release_id, valid_from_release_id, confidence_class,
                                            confidence_score, evidence_source_id, review_status, valid_from_seq)
       SELECT NULL, 'GLOBAL', e.source_object_id, e.target_object_id, 'SUCCESSOR_OF', e.release_id, e.release_id,
              CASE WHEN es.trust_level LIKE 'OFFICIAL_%' THEN 'VERIFIED' ELSE 'RULE_DERIVED' END,
              CASE WHEN es.trust_level LIKE 'OFFICIAL_%' THEN 1.000 ELSE 0.850 END,
              e.source_id, 'PUBLISHED', $1
         FROM kg_stage_edges e
         JOIN knowledge_evidence_sources es ON es.id = e.source_id
        WHERE NOT EXISTS (SELECT 1 FROM knowledge_relationships r
                           WHERE r.valid_to_seq IS NULL AND r.organization_id IS NULL
                             AND r.relationship_type = 'SUCCESSOR_OF'
                             AND r.source_object_id = e.source_object_id AND r.target_object_id = e.target_object_id
                             AND r.release_id = e.release_id AND r.evidence_source_id = e.source_id)`,
      [seq]
    );

    return {
      initialSnapshot,
      statesAdded: byKind.ADDED ?? 0,
      statesRemoved: byKind.REMOVED ?? 0,
      statesChanged: byKind.CHANGED ?? 0,
      edgesAdded: edgesAdded.rowCount ?? 0,
      edgesRemoved: edgesRemoved.rowCount ?? 0,
      objectsCreated: created.rowCount ?? 0,
      byChangeType,
    };
  }
}
