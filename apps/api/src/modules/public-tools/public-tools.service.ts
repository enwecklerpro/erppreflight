import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SEO_MIN_RELATED_OBJECTS,
  SEO_SITEMAP_OBJECTS_PER_PAGE,
  evaluateSeoGate,
  objectKeyToSlug,
  slugToObjectKey,
} from '@erppreflight/schemas';
import { DatabaseService } from '../database/database.service';
import { KnowledgeGraphService } from '../knowledge-graph/knowledge-graph.service';
import { TRUST_RANK_SQL, latestSnapshot } from '../knowledge-graph/knowledge-state.queries';
import { ReleaseIntelligenceService } from '../release-intelligence/release-intelligence.service';
import {
  API_OBJECT_TYPES,
  ApiLifecycleQuery,
  EngineCatalog,
  EngineCatalogSchema,
  SuccessorLookupQuery,
  XmlFieldCheckInput,
  XmlFieldCheckResult,
  XmlFieldCheckResultSchema,
} from './public-tools.types';

/**
 * Every statement in this service reads GLOBAL, PUBLISHED knowledge only
 * (Part 04 §4.14: tenant/customer objects are never public). Public requests
 * carry no tenant context, so the explicit `organization_id IS NULL` and
 * `review_status = 'PUBLISHED'` predicates below are the isolation boundary;
 * `public-tools.spec.ts` asserts them on every statement.
 */
export const GLOBAL_OBJECT_SQL = `o.organization_id IS NULL AND o.review_status = 'PUBLISHED'`;

const LEGACY_STATES = ['NOT_RELEASED', 'DEPRECATED', 'NOT_TO_BE_RELEASED_STABLE'];

export interface ReleaseFact {
  productCode: string;
  editionCode: string;
  editionName: string;
  releaseId: string;
  releaseCode: string;
  releaseLabel: string;
  sortOrder: number;
  isRolling: boolean;
  scheme: string;
  state: string;
  supportState: string;
  cleanCoreLevel: string | null;
  successorClassification: string | null;
  successorConcept: string | null;
  successors: Array<{ sapObjectType: string; objectKey: string; slug: string | null; supportState: string | null }>;
  evidence: { title: string; url: string | null; trustLevel: string; retrievedAt: string | null };
}

export interface ObjectRef {
  id: string;
  objectKey: string;
  sapObjectType: string;
  objectType: string;
  applicationComponent: string | null;
  softwareComponent: string | null;
  slug: string | null;
}

export type Verdict =
  | 'RELEASED'
  | 'RELEASED_ELSEWHERE'
  | 'SUCCESSOR_AVAILABLE'
  | 'CONCEPT_AVAILABLE'
  | 'NOT_RELEASED_NO_SUCCESSOR'
  | 'CLASSIC_API_ONLY'
  | 'NO_OFFICIAL_STATE';

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function iso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Tiny per-instance TTL cache for expensive, identical public reads. */
class TtlCache<T> {
  private readonly entries = new Map<string, { at: number; value: Promise<T> }>();
  constructor(private readonly ttlMs: number, private readonly max = 200) {}
  get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    const value = load();
    value.catch(() => this.entries.delete(key));
    if (this.entries.size >= this.max) this.entries.delete(this.entries.keys().next().value as string);
    this.entries.set(key, { at: Date.now(), value });
    return value;
  }
}

/**
 * Public free tools and programmatic SEO data (Part 01 §1.11, Part 02 §2.8–2.13).
 */
@Injectable()
export class PublicToolsService {
  private readonly logger = new Logger(PublicToolsService.name);
  private readonly analysisUrl: string;
  private readonly metaCache = new TtlCache<any>(60_000, 4);
  private readonly engineCache = new TtlCache<EngineCatalog>(300_000, 2);
  private readonly sitemapCache = new TtlCache<any>(600_000, 20);

  constructor(
    private readonly db: DatabaseService,
    private readonly knowledge: KnowledgeGraphService,
    private readonly releases: ReleaseIntelligenceService,
    config: ConfigService
  ) {
    this.analysisUrl = (config.get<string>('ANALYSIS_SERVICE_URL') || 'http://localhost:8000').replace(/\/+$/, '');
  }

  // ---------------------------------------------------------------------------
  // Data source / snapshot / trust metadata shown by every tool
  // ---------------------------------------------------------------------------
  meta() {
    return this.metaCache.get('meta', async () => {
      const [snap, sources, coverage] = await Promise.all([
        this.db.query(
          `SELECT id, seq, adapter_id, content_sha256, parser_version, published_at
             FROM knowledge_snapshots WHERE status = 'PUBLISHED' ORDER BY seq DESC LIMIT 1`,
          [],
          { bypassRls: true }
        ),
        this.db.query(
          `SELECT source_key, title, trust_level, publisher, url, last_retrieved_at
             FROM knowledge_evidence_sources es
            WHERE es.organization_id IS NULL AND es.status = 'ACTIVE'
            ORDER BY ${TRUST_RANK_SQL}, source_key`,
          [],
          { bypassRls: true }
        ),
        this.db.query(
          `SELECT o.object_type, COUNT(*)::int AS n FROM knowledge_objects o
            WHERE ${GLOBAL_OBJECT_SQL} GROUP BY o.object_type ORDER BY o.object_type`,
          [],
          { bypassRls: true }
        ),
      ]);
      const s = snap.rows[0];
      const objectTypes: Record<string, number> = {};
      for (const r of coverage.rows) objectTypes[r.object_type] = Number(r.n);
      const retrieved = sources.rows.map((r: any) => iso(r.last_retrieved_at)).filter(Boolean) as string[];
      return {
        snapshot: s
          ? {
              seq: Number(s.seq),
              adapterId: s.adapter_id,
              contentSha256: s.content_sha256,
              parserVersion: s.parser_version,
              publishedAt: iso(s.published_at),
            }
          : null,
        lastRetrievedAt: retrieved.sort().at(-1) ?? null,
        sources: sources.rows.map((r: any) => ({
          sourceKey: r.source_key,
          title: r.title,
          trustLevel: r.trust_level,
          publisher: r.publisher,
          url: r.url,
          lastRetrievedAt: iso(r.last_retrieved_at),
        })),
        coverage: {
          objectTypes,
          totalObjects: Object.values(objectTypes).reduce((a, b) => a + b, 0),
          transactionCodes: objectTypes.TRANSACTION_CODE ?? 0,
        },
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Shared loaders
  // ---------------------------------------------------------------------------
  /** Candidate global objects for a user query: exact key, alias, then prefix. */
  private async findObjects(term: string, limit: number, types?: readonly string[]): Promise<ObjectRef[]> {
    const q = term.trim().toUpperCase();
    const res = await this.db.query(
      `WITH c AS (
         SELECT o.id, 3 AS rank FROM knowledge_objects o
          WHERE o.object_key = $1 AND ${GLOBAL_OBJECT_SQL} AND ($3::text[] IS NULL OR o.object_type = ANY($3::text[]))
         UNION ALL
         SELECT o.id, 2 FROM knowledge_object_aliases a JOIN knowledge_objects o ON o.id = a.object_id
          WHERE upper(a.alias) = $1 AND a.organization_id IS NULL AND ${GLOBAL_OBJECT_SQL}
            AND ($3::text[] IS NULL OR o.object_type = ANY($3::text[]))
         UNION ALL
         SELECT o.id, 1 FROM knowledge_objects o
          WHERE o.object_key LIKE $2 ESCAPE '\\' AND ${GLOBAL_OBJECT_SQL}
            AND ($3::text[] IS NULL OR o.object_type = ANY($3::text[]))
       ), best AS (SELECT id, max(rank) AS rank FROM c GROUP BY id)
       SELECT o.id, o.object_key, o.sap_object_type, o.object_type, o.application_component, o.software_component
         FROM best b JOIN knowledge_objects o ON o.id = b.id
        ORDER BY b.rank DESC, length(o.object_key), o.object_key, o.sap_object_type
        LIMIT $4`,
      [q, `${escapeLike(q)}%`, types ? [...types] : null, limit],
      { bypassRls: true }
    );
    return res.rows.map((r: any) => this.ref(r));
  }

  private ref(r: any): ObjectRef {
    return {
      id: r.id,
      objectKey: r.object_key,
      sapObjectType: r.sap_object_type,
      objectType: r.object_type,
      applicationComponent: r.application_component ?? null,
      softwareComponent: r.software_component ?? null,
      slug: objectKeyToSlug(r.object_key),
    };
  }

  /**
   * Best-trust global state of each object per (release, scheme) in the latest
   * snapshot, with successors resolved to their own state in the same release.
   */
  async loadFacts(ids: string[]): Promise<Map<string, ReleaseFact[]>> {
    const out = new Map<string, ReleaseFact[]>();
    if (ids.length === 0) return out;
    const snapshot = await latestSnapshot(this.db);
    if (!snapshot) return out;
    const res = await this.db.query(
      `SELECT DISTINCT ON (s.object_id, s.release_id, s.scheme)
              s.object_id, s.scheme, s.state, s.support_state, s.clean_core_level, s.successor_classification,
              s.successor_concept, s.successors, r.id AS release_id, r.code AS release_code, r.label AS release_label,
              r.sort_order, r.is_rolling, e.code AS edition_code, e.name AS edition_name, p.code AS product_code,
              es.title AS source_title, es.url AS source_url, es.trust_level, es.last_retrieved_at
         FROM knowledge_object_release_states s
         JOIN knowledge_releases r ON r.id = s.release_id
         JOIN knowledge_editions e ON e.id = r.edition_id
         JOIN knowledge_products p ON p.id = e.product_id
         JOIN knowledge_evidence_sources es ON es.id = s.source_id
        WHERE s.object_id = ANY($1::uuid[]) AND s.organization_id IS NULL AND es.organization_id IS NULL
          AND s.valid_from_seq <= $2 AND (s.valid_to_seq IS NULL OR s.valid_to_seq > $2)
        ORDER BY s.object_id, s.release_id, s.scheme, ${TRUST_RANK_SQL}`,
      [ids, snapshot.seq],
      { bypassRls: true }
    );

    // Successor states in the same release (e.g. is I_PRODUCT released where MARA is not?).
    const succKeys = new Set<string>();
    for (const r of res.rows) {
      for (const x of Array.isArray(r.successors) ? r.successors : []) succKeys.add(`${x.sapObjectType}|${x.objectKey}`);
    }
    const succState = new Map<string, string>();
    if (succKeys.size > 0) {
      const pairs = [...succKeys].map((k) => k.split('|'));
      const sres = await this.db.query(
        `SELECT DISTINCT ON (o.id, s.release_id) o.sap_object_type, o.object_key, s.release_id, s.support_state
           FROM knowledge_objects o
           JOIN knowledge_object_release_states s ON s.object_id = o.id AND s.scheme = 'RELEASE_CONTRACT'
           JOIN knowledge_evidence_sources es ON es.id = s.source_id
          WHERE ${GLOBAL_OBJECT_SQL} AND s.organization_id IS NULL
            AND (o.sap_object_type, o.object_key) IN (SELECT * FROM unnest($1::text[], $2::text[]))
            AND s.valid_from_seq <= $3 AND (s.valid_to_seq IS NULL OR s.valid_to_seq > $3)
          ORDER BY o.id, s.release_id, ${TRUST_RANK_SQL}`,
        [pairs.map((p) => p[0]), pairs.map((p) => p[1]), snapshot.seq],
        { bypassRls: true }
      );
      for (const r of sres.rows) succState.set(`${r.sap_object_type}|${r.object_key}|${r.release_id}`, r.support_state);
    }

    for (const r of res.rows) {
      const list = out.get(r.object_id) ?? [];
      list.push({
        productCode: r.product_code,
        editionCode: r.edition_code,
        editionName: r.edition_name,
        releaseId: r.release_id,
        releaseCode: r.release_code,
        releaseLabel: r.release_label,
        sortOrder: Number(r.sort_order),
        isRolling: r.is_rolling,
        scheme: r.scheme,
        state: r.state,
        supportState: r.support_state,
        cleanCoreLevel: r.clean_core_level,
        successorClassification: r.successor_classification || null,
        successorConcept: r.successor_concept || null,
        successors: (Array.isArray(r.successors) ? r.successors : [])
          .map((x: any) => ({
            sapObjectType: String(x.sapObjectType),
            objectKey: String(x.objectKey),
            slug: objectKeyToSlug(String(x.objectKey)),
            supportState: succState.get(`${x.sapObjectType}|${x.objectKey}|${r.release_id}`) ?? null,
          }))
          .sort((a: any, b: any) => a.objectKey.localeCompare(b.objectKey)),
        evidence: {
          title: r.source_title,
          url: r.source_url,
          trustLevel: r.trust_level,
          retrievedAt: iso(r.last_retrieved_at),
        },
      });
      out.set(r.object_id, list);
    }
    for (const list of out.values()) {
      list.sort(
        (a, b) =>
          a.productCode.localeCompare(b.productCode) ||
          a.editionCode.localeCompare(b.editionCode) ||
          b.sortOrder - a.sortOrder ||
          a.scheme.localeCompare(b.scheme)
      );
    }
    return out;
  }

  /** The release a verdict is based on: latest SAP Cloud ERP Private, else the most recent release with a state. */
  static headlineFact(facts: ReleaseFact[]): ReleaseFact | null {
    const contract = facts.filter((f) => f.scheme === 'RELEASE_CONTRACT' && f.evidence.trustLevel.startsWith('OFFICIAL_'));
    return (
      contract.find((f) => f.editionCode === 'CLOUD_PRIVATE' && f.isRolling) ??
      [...contract].sort((a, b) => b.sortOrder - a.sortOrder || a.editionCode.localeCompare(b.editionCode))[0] ??
      null
    );
  }

  static verdict(facts: ReleaseFact[]): Verdict {
    const head = PublicToolsService.headlineFact(facts);
    const classic = facts.find((f) => f.scheme === 'CLASSIC_API_CLASSIFICATION');
    if (!head) return classic ? 'CLASSIC_API_ONLY' : 'NO_OFFICIAL_STATE';
    if (head.supportState === 'RELEASED') return 'RELEASED';
    if (head.successors.length > 0) return 'SUCCESSOR_AVAILABLE';
    if (head.successorConcept) return 'CONCEPT_AVAILABLE';
    const releasedElsewhere = facts.some((f) => f.scheme === 'RELEASE_CONTRACT' && f.supportState === 'RELEASED');
    return releasedElsewhere ? 'RELEASED_ELSEWHERE' : 'NOT_RELEASED_NO_SUCCESSOR';
  }

  private describe(o: ObjectRef, facts: ReleaseFact[]) {
    const contract = facts.filter((f) => f.scheme === 'RELEASE_CONTRACT');
    const classic = facts.find((f) => f.scheme === 'CLASSIC_API_CLASSIFICATION') ?? null;
    return {
      ...o,
      id: undefined,
      verdict: PublicToolsService.verdict(facts),
      headline: PublicToolsService.headlineFact(facts),
      releases: contract,
      classicApi: classic
        ? { state: classic.state, supportState: classic.supportState, cleanCoreLevel: classic.cleanCoreLevel, evidence: classic.evidence }
        : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Tool: legacy object / T-code → cloud successor
  // ---------------------------------------------------------------------------
  async successorLookup(q: SuccessorLookupQuery) {
    const meta = await this.meta();
    const objects = await this.findObjects(q.q, q.limit);
    const facts = await this.loadFacts(objects.map((o) => o.id));
    return {
      query: q.q,
      snapshot: meta.snapshot,
      lastRetrievedAt: meta.lastRetrievedAt,
      // Honest coverage statement: the tool never guesses a successor for object kinds the sources do not list.
      coverage: { transactionCodes: meta.coverage.transactionCodes },
      results: objects.map((o) => this.describe(o, facts.get(o.id) ?? [])),
    };
  }

  // ---------------------------------------------------------------------------
  // Tool: API deprecation lookup
  // ---------------------------------------------------------------------------
  async apiLifecycle(q: ApiLifecycleQuery) {
    const meta = await this.meta();
    const types = q.type ? [q.type] : API_OBJECT_TYPES;
    let objects: ObjectRef[];
    let total: number | null = null;
    if (q.q) {
      objects = await this.findObjects(q.q, q.limit, types);
    } else {
      // Browse: APIs deprecated in the latest release of SAP Cloud ERP Private (official source only).
      const snapshot = await latestSnapshot(this.db);
      const params = [types, snapshot?.seq ?? 0, q.limit, q.offset];
      const where = `FROM knowledge_objects o
          JOIN knowledge_object_release_states s ON s.object_id = o.id AND s.scheme = 'RELEASE_CONTRACT'
          JOIN knowledge_releases r ON r.id = s.release_id AND r.is_rolling
          JOIN knowledge_editions e ON e.id = r.edition_id AND e.code = 'CLOUD_PRIVATE'
          JOIN knowledge_evidence_sources es ON es.id = s.source_id AND es.trust_level LIKE 'OFFICIAL_%'
         WHERE ${GLOBAL_OBJECT_SQL} AND s.organization_id IS NULL AND o.object_type = ANY($1::text[])
           AND s.support_state = 'DEPRECATED'
           AND s.valid_from_seq <= $2 AND (s.valid_to_seq IS NULL OR s.valid_to_seq > $2)`;
      const [page, count] = await Promise.all([
        this.db.query(
          `SELECT DISTINCT o.id, o.object_key, o.sap_object_type, o.object_type, o.application_component, o.software_component
             ${where} ORDER BY o.object_key, o.sap_object_type LIMIT $3 OFFSET $4`,
          params,
          { bypassRls: true }
        ),
        this.db.query(`SELECT COUNT(DISTINCT o.id)::int AS n ${where}`, params.slice(0, 2), { bypassRls: true }),
      ]);
      objects = page.rows.map((r: any) => this.ref(r));
      total = Number(count.rows[0]?.n ?? 0);
    }
    const facts = await this.loadFacts(objects.map((o) => o.id));
    return {
      query: q.q ?? null,
      mode: q.q ? 'SEARCH' : 'DEPRECATED_BROWSE',
      snapshot: meta.snapshot,
      lastRetrievedAt: meta.lastRetrievedAt,
      total,
      offset: q.offset,
      results: objects.map((o) => {
        const f = facts.get(o.id) ?? [];
        return { ...this.describe(o, f), lifecycle: PublicToolsService.lifecycle(f) };
      }),
    };
  }

  /** Per edition: first release with RELEASED, first with DEPRECATED, current state. */
  static lifecycle(facts: ReleaseFact[]) {
    const byEdition = new Map<string, ReleaseFact[]>();
    for (const f of facts.filter((x) => x.scheme === 'RELEASE_CONTRACT')) {
      const list = byEdition.get(f.editionCode) ?? [];
      list.push(f);
      byEdition.set(f.editionCode, list);
    }
    return [...byEdition.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([editionCode, list]) => {
        const asc = [...list].sort((a, b) => a.sortOrder - b.sortOrder);
        const current = asc[asc.length - 1];
        return {
          editionCode,
          editionName: current.editionName,
          currentState: current.supportState,
          currentRelease: current.releaseLabel,
          firstReleasedIn: asc.find((f) => f.supportState === 'RELEASED')?.releaseLabel ?? null,
          firstDeprecatedIn: asc.find((f) => f.supportState === 'DEPRECATED')?.releaseLabel ?? null,
          releaseCount: asc.length,
        };
      });
  }

  async releaseCatalog() {
    const res = await this.db.query(
      `SELECT r.id, r.code, r.label, r.sort_order, r.is_rolling, e.code AS edition_code, e.name AS edition_name,
              p.code AS product_code, p.name AS product_name
         FROM knowledge_releases r JOIN knowledge_editions e ON e.id = r.edition_id
         JOIN knowledge_products p ON p.id = e.product_id
        WHERE EXISTS (SELECT 1 FROM knowledge_object_release_states s
                       WHERE s.release_id = r.id AND s.organization_id IS NULL AND s.valid_to_seq IS NULL)
        ORDER BY p.code, e.code, r.sort_order`,
      [],
      { bypassRls: true }
    );
    return {
      releases: res.rows.map((r: any) => ({
        id: r.id,
        code: r.code,
        label: r.label,
        sortOrder: Number(r.sort_order),
        isRolling: r.is_rolling,
        editionCode: r.edition_code,
        editionName: r.edition_name,
        productCode: r.product_code,
        productName: r.product_name,
      })),
    };
  }

  async releaseDiff(q: { fromRelease: string; toRelease: string; changeType?: string; q?: string; limit: number; offset: number }) {
    if (q.fromRelease === q.toRelease) throw new BadRequestException('Choose two different releases');
    const diff: any = await this.releases.releaseDiff({ ...q, publicOnly: true });
    return {
      ...diff,
      items: (diff.items ?? []).map((i: any) => ({ ...i, objectId: undefined, slug: objectKeyToSlug(i.objectKey) })),
    };
  }

  // ---------------------------------------------------------------------------
  // Tool: public knowledge / error search
  // ---------------------------------------------------------------------------
  async search(q: { q: string; locale: 'en' | 'de' }) {
    const term = q.q.trim();
    const like = `%${escapeLike(term)}%`;
    const [articles, objects, engines] = await Promise.all([
      this.db.query(
        `SELECT a.slug, a.title, a.summary, a.status, a.reviewed_at, a.target_releases, a.related_engine_types,
                ts_rank(to_tsvector('simple', a.title || ' ' || a.summary || ' ' || a.body_markdown),
                        plainto_tsquery('simple', $2)) AS rank,
                ts_headline('simple', a.body_markdown, plainto_tsquery('simple', $2),
                            'StartSel=[[,StopSel=]],MaxWords=30,MinWords=12,MaxFragments=1') AS snippet
           FROM knowledge_articles a
          WHERE a.locale = $1 AND a.status IN ('PUBLISHED', 'UPDATE_REQUIRED')
            AND (to_tsvector('simple', a.title || ' ' || a.summary || ' ' || a.body_markdown) @@ plainto_tsquery('simple', $2)
                 OR a.title ILIKE $3 ESCAPE '\\' OR a.summary ILIKE $3 ESCAPE '\\')
          ORDER BY rank DESC, a.title
          LIMIT 10`,
        [q.locale, term, like],
        { bypassRls: true }
      ),
      this.knowledge.lookup({ q: term, limit: 10 }, { publicOnly: true }),
      this.engineCatalog().catch(() => null),
    ]);
    const needle = term.toUpperCase();
    const rules: any[] = [];
    for (const e of engines ?? []) {
      for (const r of e.rules) {
        // Generic input-validation codes exist for every engine and are not diagnostic knowledge.
        if (r.category === 'INPUT_VALIDATION') continue;
        const hay = `${r.code} ${r.title} ${r.category}`.toUpperCase();
        if (needle.split(/\s+/).every((w) => hay.includes(w))) {
          rules.push({ engineType: e.engine_type, engineName: e.name, code: r.code, title: r.title, severity: r.defaultSeverity });
        }
      }
    }
    return {
      query: term,
      locale: q.locale,
      articles: articles.rows.map((r: any) => ({
        slug: r.slug,
        title: r.title,
        summary: r.summary,
        updateRequired: r.status === 'UPDATE_REQUIRED',
        reviewedAt: iso(r.reviewed_at),
        targetReleases: r.target_releases ?? [],
        relatedEngineTypes: r.related_engine_types ?? [],
        // Plain text with [[ ]] highlight markers (rendered as <mark> by the web app, never as HTML).
        snippet: String(r.snippet ?? '')
          .replace(/[<>]/g, '')
          .replace(/[*#`]{1,3}/g, '')
          .replace(/\s+/g, ' ')
          .trim(),
      })),
      objects: objects.results.map((o: any) => ({
        objectKey: o.objectKey,
        sapObjectType: o.sapObjectType,
        objectType: o.objectType,
        matchType: o.matchType,
        slug: objectKeyToSlug(o.objectKey),
        states: o.states,
      })),
      rules: rules.slice(0, 15),
      engineCatalogAvailable: engines !== null,
      snapshot: objects.snapshot,
    };
  }

  // ---------------------------------------------------------------------------
  // Programmatic SEO object pages (Part 02 §2.8/§2.9/§2.12)
  // ---------------------------------------------------------------------------
  /** Graph-derived related objects: successors, predecessors and their 2nd-hop neighbours. */
  async relatedObjects(id: string) {
    const res = await this.db.query(
      `WITH e AS (
         SELECT DISTINCT rel.source_object_id AS s, rel.target_object_id AS t
           FROM knowledge_relationships rel
          WHERE rel.relationship_type = 'SUCCESSOR_OF' AND rel.valid_to_seq IS NULL AND rel.organization_id IS NULL
            AND (rel.source_object_id = $1 OR rel.target_object_id = $1
                 OR rel.source_object_id IN (SELECT source_object_id FROM knowledge_relationships
                                              WHERE target_object_id = $1 AND relationship_type = 'SUCCESSOR_OF' AND valid_to_seq IS NULL AND organization_id IS NULL)
                 OR rel.target_object_id IN (SELECT target_object_id FROM knowledge_relationships
                                              WHERE source_object_id = $1 AND relationship_type = 'SUCCESSOR_OF' AND valid_to_seq IS NULL AND organization_id IS NULL))
       ), rel AS (
         SELECT s AS other, 'SUCCESSOR' AS relation, 1 AS ord FROM e WHERE t = $1
         UNION SELECT t, 'REPLACES', 2 FROM e WHERE s = $1
         UNION SELECT e2.t, 'SHARES_SUCCESSOR', 3 FROM e e1 JOIN e e2 ON e2.s = e1.s WHERE e1.t = $1 AND e2.t <> $1
         UNION SELECT e2.s, 'CO_SUCCESSOR', 4 FROM e e1 JOIN e e2 ON e2.t = e1.t WHERE e1.s = $1 AND e2.s <> $1
       ), best AS (SELECT DISTINCT ON (other) other, relation, ord FROM rel ORDER BY other, ord)
       SELECT o.id, o.object_key, o.sap_object_type, o.object_type, o.application_component, o.software_component,
              b.relation, b.ord
         FROM best b JOIN knowledge_objects o ON o.id = b.other
        WHERE ${GLOBAL_OBJECT_SQL}
        ORDER BY b.ord, o.object_key, o.sap_object_type`,
      [id],
      { bypassRls: true }
    );
    return res.rows.map((r: any) => ({ ...this.ref(r), relation: r.relation as string }));
  }

  async seoObject(slug: string) {
    const key = slugToObjectKey(slug);
    if (!key) throw new NotFoundException('Unknown object');
    const candidates = await this.db.query(
      `SELECT o.id, o.object_key, o.sap_object_type, o.object_type, o.application_component, o.software_component,
              o.description, o.display_name,
              (SELECT COUNT(*) FROM knowledge_object_release_states s
                WHERE s.object_id = o.id AND s.scheme = 'RELEASE_CONTRACT' AND s.organization_id IS NULL
                  AND s.valid_to_seq IS NULL) AS contract_states
         FROM knowledge_objects o
        WHERE o.object_key = $1 AND ${GLOBAL_OBJECT_SQL}
        ORDER BY contract_states DESC, o.sap_object_type`,
      [key],
      { bypassRls: true }
    );
    if (candidates.rows.length === 0) throw new NotFoundException(`${key} is not in the public knowledge graph`);
    const primaryRow = candidates.rows[0];
    const primary = this.ref(primaryRow);
    const [meta, related] = await Promise.all([this.meta(), this.relatedObjects(primary.id)]);
    const facts = await this.loadFacts([primary.id, ...candidates.rows.slice(1).map((r: any) => r.id), ...related.slice(0, 40).map((r) => r.id)]);
    const own = facts.get(primary.id) ?? [];
    const official = own.filter((f) => f.scheme === 'RELEASE_CONTRACT' && f.evidence.trustLevel.startsWith('OFFICIAL_'));
    const gate = evaluateSeoGate({
      isGlobalPublished: true,
      objectType: primary.objectType,
      states: official.map((f) => ({ supportState: f.supportState, successorCount: f.successors.length, successorConcept: f.successorConcept })),
      evidence: official.map((f) => ({ trustLevel: f.evidence.trustLevel, retrievedAt: f.evidence.retrievedAt })),
      relatedCount: related.length,
    });
    const successorMap = new Map<string, any>();
    for (const f of official) for (const s of f.successors) successorMap.set(`${s.sapObjectType}|${s.objectKey}`, s);
    const legacy = official.some((f) => LEGACY_STATES.includes(f.supportState));
    const migrationApplicable = legacy && official.some((f) => f.successors.length > 0 || Boolean(f.successorConcept));
    const evidence = new Map<string, ReleaseFact['evidence']>();
    for (const f of own) evidence.set(f.evidence.title, f.evidence);
    const retrieved = [...evidence.values()].map((e) => e.retrievedAt).filter(Boolean) as string[];

    return {
      slug,
      object: {
        objectKey: primary.objectKey,
        sapObjectType: primary.sapObjectType,
        objectType: primary.objectType,
        applicationComponent: primary.applicationComponent,
        softwareComponent: primary.softwareComponent,
        description: primaryRow.description ?? null,
        displayName: primaryRow.display_name ?? null,
      },
      verdict: PublicToolsService.verdict(own),
      headline: PublicToolsService.headlineFact(own),
      releases: own.filter((f) => f.scheme === 'RELEASE_CONTRACT'),
      classicApi: own.find((f) => f.scheme === 'CLASSIC_API_CLASSIFICATION') ?? null,
      lifecycle: PublicToolsService.lifecycle(own),
      successors: [...successorMap.values()].sort((a, b) => a.objectKey.localeCompare(b.objectKey)),
      related: related.slice(0, 40).map((r) => ({
        objectKey: r.objectKey,
        sapObjectType: r.sapObjectType,
        objectType: r.objectType,
        slug: r.slug,
        relation: r.relation,
        headline: PublicToolsService.headlineFact(facts.get(r.id) ?? []),
      })),
      relatedTotal: related.length,
      alternates: candidates.rows.slice(1).map((r: any) => ({
        objectKey: r.object_key,
        sapObjectType: r.sap_object_type,
        objectType: r.object_type,
        headline: PublicToolsService.headlineFact(facts.get(r.id) ?? []),
      })),
      evidence: [...evidence.values()].sort((a, b) => a.title.localeCompare(b.title)),
      lastVerifiedAt: retrieved.sort().at(-1) ?? null,
      snapshot: meta.snapshot,
      gate,
      migration: { applicable: migrationApplicable, indexable: migrationApplicable && gate.indexable },
    };
  }

  /**
   * Objects passing the SEO gate (same criteria as evaluateSeoGate, in SQL),
   * one per object key (the primary object the page renders), paginated.
   */
  seoSitemap(page: number) {
    return this.sitemapCache.get(`p${page}`, async () => {
      const snapshot = await latestSnapshot(this.db);
      if (!snapshot) return { page, pageSize: SEO_SITEMAP_OBJECTS_PER_PAGE, total: 0, totalPages: 0, items: [] };
      return this.sitemapPage(page, snapshot.seq);
    });
  }

  private async sitemapPage(page: number, seq: number) {
    const size = SEO_SITEMAP_OBJECTS_PER_PAGE;
    const res = await this.db.query(
      `WITH edges AS (
         SELECT DISTINCT source_object_id AS s, target_object_id AS t FROM knowledge_relationships
          WHERE relationship_type = 'SUCCESSOR_OF' AND valid_to_seq IS NULL AND organization_id IS NULL
       ), rel AS (
         SELECT t AS obj, s AS other FROM edges
         UNION SELECT s, t FROM edges
         UNION SELECT e1.t, e2.t FROM edges e1 JOIN edges e2 ON e2.s = e1.s AND e2.t <> e1.t
         UNION SELECT e1.s, e2.s FROM edges e1 JOIN edges e2 ON e2.t = e1.t AND e2.s <> e1.s
       ), relcount AS (
         SELECT r.obj, COUNT(*) AS n FROM rel r JOIN knowledge_objects o ON o.id = r.other
          WHERE ${GLOBAL_OBJECT_SQL} GROUP BY r.obj
       ), best AS (
         SELECT DISTINCT ON (s.object_id, s.release_id) s.object_id, s.support_state, s.successors, s.successor_concept,
                es.trust_level, es.last_retrieved_at
           FROM knowledge_object_release_states s JOIN knowledge_evidence_sources es ON es.id = s.source_id
          WHERE s.scheme = 'RELEASE_CONTRACT' AND s.organization_id IS NULL
            AND s.valid_from_seq <= $1 AND (s.valid_to_seq IS NULL OR s.valid_to_seq > $1)
          ORDER BY s.object_id, s.release_id, ${TRUST_RANK_SQL}
       ), st AS (
         SELECT b.object_id, COUNT(*) FILTER (WHERE b.trust_level LIKE 'OFFICIAL_%') AS n_official,
                COUNT(*) AS n_states,
                bool_and(b.support_state = 'RELEASED') FILTER (WHERE b.trust_level LIKE 'OFFICIAL_%') AS all_released,
                bool_or(jsonb_array_length(b.successors) > 0 OR coalesce(b.successor_concept, '') <> '')
                  FILTER (WHERE b.trust_level LIKE 'OFFICIAL_%') AS has_succ,
                bool_or(b.support_state IN ('NOT_RELEASED', 'DEPRECATED', 'NOT_TO_BE_RELEASED_STABLE'))
                  FILTER (WHERE b.trust_level LIKE 'OFFICIAL_%') AS legacy,
                bool_and(b.last_retrieved_at IS NOT NULL) FILTER (WHERE b.trust_level LIKE 'OFFICIAL_%') AS retrieved,
                max(b.last_retrieved_at) AS last_verified
           FROM best b GROUP BY b.object_id
       ), primaries AS (
         SELECT DISTINCT ON (o.object_key) o.id, o.object_key
           FROM knowledge_objects o LEFT JOIN st ON st.object_id = o.id
          WHERE ${GLOBAL_OBJECT_SQL}
          ORDER BY o.object_key, coalesce(st.n_states, 0) DESC, o.sap_object_type
       ), gated AS (
         SELECT p.object_key, st.legacy, st.has_succ, st.last_verified
           FROM primaries p JOIN st ON st.object_id = p.id JOIN relcount rc ON rc.obj = p.id
          WHERE p.object_key ~ '^[A-Z0-9_/]{1,200}$'
            AND st.n_official > 0 AND st.retrieved
            AND (st.all_released OR st.has_succ)
            AND rc.n >= $2
       )
       SELECT *, COUNT(*) OVER () AS total FROM gated ORDER BY object_key LIMIT $3 OFFSET $4`,
      [seq, SEO_MIN_RELATED_OBJECTS, size, (page - 1) * size],
      { bypassRls: true }
    );
    const total = Number(res.rows[0]?.total ?? 0);
    return {
      page,
      pageSize: size,
      total,
      totalPages: Math.ceil(total / size),
      items: res.rows.map((r: any) => ({
        slug: objectKeyToSlug(r.object_key),
        objectKey: r.object_key,
        lastVerifiedAt: iso(r.last_verified),
        migration: Boolean(r.legacy && r.has_succ),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Engine catalog (product documentation) — from the analysis service
  // ---------------------------------------------------------------------------
  engineCatalog(): Promise<EngineCatalog> {
    return this.engineCache.get('catalog', async () => {
      let res: Response;
      try {
        res = await fetch(`${this.analysisUrl}/api/v1/engines`, { signal: AbortSignal.timeout(5000) });
      } catch (err: any) {
        this.logger.warn(`Engine catalog unavailable: ${err?.message ?? err}`);
        throw new ServiceUnavailableException('The engine catalog is temporarily unavailable');
      }
      if (!res.ok) throw new ServiceUnavailableException('The engine catalog is temporarily unavailable');
      const parsed = EngineCatalogSchema.safeParse(await res.json());
      if (!parsed.success) {
        this.logger.error('Engine catalog response does not match the documented contract');
        throw new ServiceUnavailableException('The engine catalog is temporarily unavailable');
      }
      return parsed.data;
    });
  }

  // ---------------------------------------------------------------------------
  // Tool: basic form/XML field checker (stateless; nothing stored or logged)
  // ---------------------------------------------------------------------------
  async xmlFieldCheck(input: XmlFieldCheckInput): Promise<XmlFieldCheckResult> {
    let res: Response;
    try {
      res = await fetch(`${this.analysisUrl}/api/v1/tools/xml-field-check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new ServiceUnavailableException('The XML checker is temporarily unavailable');
    }
    if (res.status === 422) {
      const body: any = await res.json().catch(() => ({}));
      const detail = typeof body?.detail === 'string' ? body.detail : 'The field path or document was rejected';
      throw new BadRequestException(detail);
    }
    if (!res.ok) throw new ServiceUnavailableException('The XML checker is temporarily unavailable');
    const parsed = XmlFieldCheckResultSchema.safeParse(await res.json());
    if (!parsed.success) throw new ServiceUnavailableException('The XML checker returned an unexpected result');
    return parsed.data;
  }
}
