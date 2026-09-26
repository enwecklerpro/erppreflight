import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AnalysisRulesClient, type EngineCatalogEntry, type RuleCoverage } from './analysis-rules.client';
import {
  RULE_STATUSES,
  RULE_TRANSITIONS,
  canTransitionRule,
  publishBlocker,
  type LatestSelfTest,
  type PublishBlocker,
  type RuleStatus,
  type RuleTransitionInput,
  type UpdateRuleGovernanceInput,
} from './rule-governance.types';

export interface Actor {
  id: string | null;
  email: string | null;
}

interface GovernanceRow {
  rule_code: string;
  engine_type: string;
  status: RuleStatus;
  author: string | null;
  reviewer: string | null;
  notes: string | null;
  published_version: string | null;
  published_at: string | null;
  published_self_test_id: string | null;
  deprecated_at: string | null;
  updated_at: string | null;
}

interface CatalogRule {
  engineType: string;
  engineName: string;
  engineVersion: string;
  domain: string;
  code: string;
  title: string;
  defaultSeverity: string;
  category: string;
  version: string | null;
  inputValidationRule: boolean;
}

function asStatus(value: unknown): RuleStatus {
  return (RULE_STATUSES as readonly string[]).includes(String(value)) ? (value as RuleStatus) : 'DRAFT';
}

function toLatest(row: any): LatestSelfTest | null {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    ruleVersion: row.rule_version,
    resultDigest: row.result_digest ?? null,
    positiveCount: Number(row.positive_count ?? 0),
    negativeCount: Number(row.negative_count ?? 0),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

/**
 * Rule Admin (spec 10.10): inventory of every rule of every engine (from the analysis
 * service's declared rule catalogs), persisted governance state, deterministic self-test
 * runs and the publish gate. Platform data — read/written through the login pool, never
 * inside a tenant transaction. Governance state never alters engine output: findings keep
 * the rule version that produced them (Part 04 §4.10); a published rule whose declared
 * version changes is reported as drifted until it is re-tested and re-published.
 */
@Injectable()
export class RuleGovernanceService {
  private readonly logger = new Logger(RuleGovernanceService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly rules: AnalysisRulesClient
  ) {}

  private flattenCatalog(catalog: EngineCatalogEntry[]): Map<string, CatalogRule> {
    const out = new Map<string, CatalogRule>();
    for (const engine of catalog) {
      const inputCodes = new Set(engine.input_validation_rule_codes);
      for (const r of engine.rules) {
        out.set(r.code, {
          engineType: engine.engine_type,
          engineName: engine.name,
          engineVersion: engine.version,
          domain: engine.domain,
          code: r.code,
          title: r.title,
          defaultSeverity: r.defaultSeverity,
          category: r.category,
          version: r.version,
          inputValidationRule: inputCodes.has(r.code),
        });
      }
    }
    return out;
  }

  private async latestSelfTests(codes?: string[]): Promise<Map<string, LatestSelfTest>> {
    const res = await this.db.query(
      `SELECT DISTINCT ON (rule_code) id, rule_code, status, rule_version, result_digest, positive_count, negative_count, created_at
         FROM rule_self_test_runs
        WHERE ($1::text[] IS NULL OR rule_code = ANY($1::text[]))
        ORDER BY rule_code, created_at DESC, id DESC`,
      [codes ?? null],
      { bypassRls: true }
    );
    return new Map((res.rows ?? []).map((r: any) => [r.rule_code, toLatest(r)!]));
  }

  private view(rule: CatalogRule, gov: GovernanceRow | undefined, coverage: RuleCoverage | undefined, latest: LatestSelfTest | null) {
    const status = asStatus(gov?.status);
    const covered = Boolean(coverage?.covered);
    const blocker: PublishBlocker | null = publishBlocker({
      status,
      currentVersion: rule.version,
      covered,
      reviewer: gov?.reviewer ?? null,
      latest,
    });
    return {
      ruleCode: rule.code,
      engineType: rule.engineType,
      engineName: rule.engineName,
      domain: rule.domain,
      title: rule.title,
      defaultSeverity: rule.defaultSeverity,
      category: rule.category,
      version: rule.version,
      inputValidationRule: rule.inputValidationRule,
      status,
      author: gov?.author ?? null,
      reviewer: gov?.reviewer ?? null,
      notes: gov?.notes ?? null,
      publishedVersion: gov?.published_version ?? null,
      publishedAt: gov?.published_at ?? null,
      drifted: status === 'PUBLISHED' && Boolean(gov?.published_version) && gov?.published_version !== rule.version,
      coverage: {
        covered,
        gap: coverage?.gap ?? 'NO_FIXTURES',
        positiveCases: coverage?.positiveCases.length ?? 0,
        negativeCases: coverage?.negativeCases.length ?? 0,
      },
      latestSelfTest: latest,
      selfTestCurrent: Boolean(latest && latest.ruleVersion === rule.version),
      publishBlocker: blocker,
      allowedTransitions: RULE_TRANSITIONS[status],
      updatedAt: gov?.updated_at ?? null,
    };
  }

  async list(filter: { engine?: string; status?: RuleStatus } = {}) {
    const [catalog, coverage, govRes, latest] = await Promise.all([
      this.rules.engineCatalog(),
      this.rules.coverage(),
      this.db.query(`SELECT * FROM rule_governance`, [], { bypassRls: true }),
      this.latestSelfTests(),
    ]);
    const flat = this.flattenCatalog(catalog);
    const govByCode = new Map<string, GovernanceRow>((govRes.rows ?? []).map((r: any) => [r.rule_code, r]));
    const covByCode = new Map(coverage.rules.map((c) => [c.ruleCode, c]));

    const all = [...flat.values()]
      .sort((a, b) => a.engineType.localeCompare(b.engineType) || a.code.localeCompare(b.code))
      .map((r) => this.view(r, govByCode.get(r.code), covByCode.get(r.code), latest.get(r.code) ?? null));

    const items = all.filter((r) => (!filter.engine || r.engineType === filter.engine) && (!filter.status || r.status === filter.status));
    const count = (pred: (r: (typeof all)[number]) => boolean) => all.filter(pred).length;
    return {
      manifestVersion: coverage.manifestVersion,
      goldenCases: coverage.totalCases,
      summary: {
        rules: all.length,
        engines: catalog.length,
        covered: count((r) => r.coverage.covered),
        coverageGaps: count((r) => !r.coverage.covered),
        published: count((r) => r.status === 'PUBLISHED'),
        inReview: count((r) => r.status === 'IN_REVIEW'),
        deprecated: count((r) => r.status === 'DEPRECATED'),
        drifted: count((r) => r.drifted),
        selfTestsPassed: count((r) => r.selfTestCurrent && r.latestSelfTest?.status === 'PASSED'),
        selfTestsFailing: count((r) => r.selfTestCurrent && r.latestSelfTest?.status !== 'PASSED'),
      },
      engines: catalog
        .map((e) => ({ engineType: e.engine_type, name: e.name, version: e.version, domain: e.domain, rules: e.rules.length }))
        .sort((a, b) => a.engineType.localeCompare(b.engineType)),
      items,
    };
  }

  private async resolveRule(code: string) {
    const [catalog, coverage] = await Promise.all([this.rules.engineCatalog(), this.rules.coverage()]);
    const rule = this.flattenCatalog(catalog).get(code);
    if (!rule) throw new NotFoundException({ message: `Rule '${code}' is not declared by any engine.`, code: 'RULE_NOT_FOUND' });
    return { rule, coverage: coverage.rules.find((c) => c.ruleCode === code) };
  }

  private async governanceRow(code: string): Promise<GovernanceRow | undefined> {
    const res = await this.db.query(`SELECT * FROM rule_governance WHERE rule_code = $1`, [code], { bypassRls: true });
    return res.rows?.[0];
  }

  async detail(code: string) {
    const { rule, coverage } = await this.resolveRule(code);
    const [gov, latest, events, runs] = await Promise.all([
      this.governanceRow(code),
      this.latestSelfTests([code]),
      this.db.query(
        `SELECT id, event_type, from_status, to_status, rule_version, self_test_id, actor_email, note, details, created_at
           FROM rule_governance_events WHERE rule_code = $1 ORDER BY created_at DESC, id DESC LIMIT 100`,
        [code],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT id, status, rule_version, engine_version, manifest_version, positive_count, negative_count, result_digest,
                cases, duration_ms, created_at
           FROM rule_self_test_runs WHERE rule_code = $1 ORDER BY created_at DESC, id DESC LIMIT 20`,
        [code],
        { bypassRls: true }
      ),
    ]);
    return {
      ...this.view(rule, gov, coverage, latest.get(code) ?? null),
      positiveCaseIds: coverage?.positiveCases ?? [],
      negativeCaseIds: coverage?.negativeCases ?? [],
      history: (events.rows ?? []).map((e: any) => ({
        id: e.id,
        eventType: e.event_type,
        fromStatus: e.from_status,
        toStatus: e.to_status,
        ruleVersion: e.rule_version,
        selfTestId: e.self_test_id,
        actorEmail: e.actor_email,
        note: e.note,
        details: e.details ?? {},
        createdAt: e.created_at,
      })),
      selfTests: (runs.rows ?? []).map((r: any) => ({
        id: r.id,
        status: r.status,
        ruleVersion: r.rule_version,
        engineVersion: r.engine_version,
        manifestVersion: r.manifest_version,
        positiveCount: Number(r.positive_count),
        negativeCount: Number(r.negative_count),
        resultDigest: r.result_digest,
        durationMs: r.duration_ms,
        cases: Array.isArray(r.cases) ? r.cases : [],
        createdAt: r.created_at,
      })),
    };
  }

  /** Runs the deterministic golden self-test and appends the verdict (history is append-only). */
  async runSelfTest(code: string, actor: Actor) {
    const { rule } = await this.resolveRule(code);
    const result = await this.rules.selfTest(code);
    if (result.engineType !== rule.engineType) {
      throw new ConflictException({ message: 'Self-test engine does not match the rule catalog.', code: 'SELF_TEST_MISMATCH' });
    }
    const res = await this.db.query(
      `WITH run AS (
         INSERT INTO rule_self_test_runs (rule_code, engine_type, rule_version, engine_version, manifest_version, status, passed,
                                          coverage_gap, positive_count, negative_count, result_digest, cases, duration_ms, run_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
         RETURNING id, created_at
       ), ev AS (
         INSERT INTO rule_governance_events (rule_code, engine_type, event_type, rule_version, self_test_id, actor_id, actor_email, details)
         SELECT $1, $2, 'SELF_TEST', $3, run.id, $14, $15, jsonb_build_object('status', $6::text, 'resultDigest', $11::text)
           FROM run
         RETURNING id
       )
       SELECT run.id, run.created_at FROM run`,
      [
        code,
        result.engineType,
        result.ruleVersion,
        result.engineVersion,
        result.manifestVersion,
        result.status,
        result.passed,
        result.coverageGap,
        result.positiveCount,
        result.negativeCount,
        result.resultDigest,
        JSON.stringify(result.cases),
        result.durationMs,
        actor.id,
        actor.email,
      ],
      { bypassRls: true }
    );
    this.logger.log(`Rule self-test ${code}@${result.ruleVersion}: ${result.status} (digest ${result.resultDigest.slice(0, 12)})`);
    return { id: res.rows[0].id, createdAt: res.rows[0].created_at, ...result };
  }

  async update(code: string, input: UpdateRuleGovernanceInput, actor: Actor) {
    const { rule } = await this.resolveRule(code);
    const has = (k: keyof UpdateRuleGovernanceInput) => Object.prototype.hasOwnProperty.call(input, k);
    await this.db.query(
      `WITH up AS (
         INSERT INTO rule_governance (rule_code, engine_type, author, reviewer, notes, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (rule_code) DO UPDATE SET
           author = CASE WHEN $8 THEN EXCLUDED.author ELSE rule_governance.author END,
           reviewer = CASE WHEN $9 THEN EXCLUDED.reviewer ELSE rule_governance.reviewer END,
           notes = CASE WHEN $10 THEN EXCLUDED.notes ELSE rule_governance.notes END,
           updated_by = EXCLUDED.updated_by, updated_at = NOW()
         RETURNING rule_code
       )
       INSERT INTO rule_governance_events (rule_code, engine_type, event_type, rule_version, actor_id, actor_email, details)
       SELECT $1, $2, 'UPDATED', $11, $6, $7, $12::jsonb FROM up`,
      [
        code,
        rule.engineType,
        input.author ?? null,
        input.reviewer ?? null,
        input.notes ?? null,
        actor.id,
        actor.email,
        has('author'),
        has('reviewer'),
        has('notes'),
        rule.version,
        JSON.stringify({ fields: Object.keys(input).sort() }),
      ],
      { bypassRls: true }
    );
    return this.detail(code);
  }

  async transition(code: string, input: RuleTransitionInput, actor: Actor) {
    const { rule, coverage } = await this.resolveRule(code);
    const gov = await this.governanceRow(code);
    const from = asStatus(gov?.status);
    const to = input.to;
    if (!canTransitionRule(from, to)) {
      throw new BadRequestException({ message: `Rule transition ${from} -> ${to} is not allowed.`, code: 'RULE_TRANSITION_INVALID' });
    }

    let selfTestId: string | null = null;
    if (to === 'PUBLISHED') {
      const latest = (await this.latestSelfTests([code])).get(code) ?? null;
      const blocker = publishBlocker({
        status: from,
        currentVersion: rule.version,
        covered: Boolean(coverage?.covered),
        reviewer: gov?.reviewer ?? null,
        latest,
      });
      if (blocker) {
        await this.db.query(
          `INSERT INTO rule_governance_events (rule_code, engine_type, event_type, from_status, to_status, rule_version,
                                               self_test_id, actor_id, actor_email, note, details)
           VALUES ($1, $2, 'PUBLISH_BLOCKED', $3, 'PUBLISHED', $4, $5, $6, $7, $8, $9::jsonb)`,
          [code, rule.engineType, from, rule.version, latest?.id ?? null, actor.id, actor.email, input.note ?? null,
            JSON.stringify({ blocker, latestStatus: latest?.status ?? null, latestVersion: latest?.ruleVersion ?? null })],
          { bypassRls: true }
        );
        throw new ConflictException({
          message: `Publishing ${code} is blocked: ${blocker}. Publishing requires a passing self-test of the current rule version.`,
          code: `RULE_PUBLISH_BLOCKED_${blocker}`,
        });
      }
      selfTestId = latest!.id;
    }

    await this.db.query(
      `INSERT INTO rule_governance (rule_code, engine_type) VALUES ($1, $2) ON CONFLICT (rule_code) DO NOTHING`,
      [code, rule.engineType],
      { bypassRls: true }
    );
    // Optimistic concurrency: the UPDATE only applies while the status is still `from`.
    const res = await this.db.query(
      `WITH up AS (
         UPDATE rule_governance SET
           status = $4::text,
           published_version = CASE WHEN $4::text = 'PUBLISHED' THEN $5::text ELSE published_version END,
           published_at = CASE WHEN $4::text = 'PUBLISHED' THEN NOW() ELSE published_at END,
           published_by = CASE WHEN $4::text = 'PUBLISHED' THEN $7::uuid ELSE published_by END,
           published_self_test_id = CASE WHEN $4::text = 'PUBLISHED' THEN $6::uuid ELSE published_self_test_id END,
           deprecated_at = CASE WHEN $4::text = 'DEPRECATED' THEN NOW() WHEN $4::text = 'DRAFT' THEN NULL ELSE deprecated_at END,
           updated_by = $7::uuid, updated_at = NOW()
         WHERE rule_code = $1::text AND status = $3::text
           -- Publish gate, re-checked atomically: no newer self-test (e.g. a FAILED one) may have
           -- been recorded after the passing run the gate approved.
           AND ($4::text <> 'PUBLISHED' OR NOT EXISTS (
                 SELECT 1 FROM rule_self_test_runs r, rule_self_test_runs g
                  WHERE g.id = $6::uuid AND r.rule_code = $1::text AND (r.created_at, r.id) > (g.created_at, g.id)))
         RETURNING rule_code
       )
       INSERT INTO rule_governance_events (rule_code, engine_type, event_type, from_status, to_status, rule_version,
                                           self_test_id, actor_id, actor_email, note)
       SELECT $1::text, $2::text, 'TRANSITION', $3::text, $4::text, $5::text, $6::uuid, $7::uuid, $8::text, $9::text FROM up
       RETURNING id`,
      [code, rule.engineType, from, to, rule.version, selfTestId, actor.id, actor.email, input.note ?? null],
      { bypassRls: true }
    );
    if (!res.rows?.[0]) {
      throw new ConflictException({ message: 'The rule changed concurrently; reload and retry.', code: 'RULE_CONCURRENT_UPDATE' });
    }
    this.logger.log(`Rule ${code} ${from} -> ${to} by ${actor.email ?? actor.id ?? 'unknown'}`);
    return this.detail(code);
  }
}
