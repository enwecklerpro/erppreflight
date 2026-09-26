import { Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import {
  AUTO_RESOLVABLE_STATUSES,
  evaluateCarryOver,
  lifecycleBaseKey,
  lifecycleKey,
  objectStateHash,
} from './lifecycle-keys';
import { insertHistory, LIFECYCLE_COLUMNS, Queryable } from './lifecycle.sql';

export interface LifecycleRunContext {
  analysisId: string;
  organizationId: string;
  projectId: string;
  targetRelease: string;
  /** Knowledge snapshot in force when the run started (latest PUBLISHED), if any. */
  knowledgeSnapshotId: string | null;
  evaluatedAt: Date;
  ordinals: Map<string, number>;
  /** `${engine}\u001f${artifactName}` pairs whose engine call COMPLETED (not partial / failed). */
  evaluatedPairs: Set<string>;
  detectedLifecycleIds: Set<string>;
}

export interface AttachFindingParams {
  findingId: string;
  engine: string;
  finding: Record<string, any>;
  artifactName: string | null;
  sourceFileId: string | null;
  /** Engine version reported by the analysis service for this very call. */
  engineVersion: string | null;
  /** rule code -> rule version reported by the analysis service for this call. */
  ruleVersions: Record<string, string>;
  /** Snapshot actually passed to a knowledge-aware engine for this call. */
  knowledgeSnapshotId: string | null;
}

const PAIR_SEP = '\u001f';

/**
 * Maintains finding lifecycles while an analysis persists its findings
 * (Part 01 §1.7, Part 04 §4.10/§4.11):
 *  - records engine version, rule version, knowledge snapshot, target release,
 *    source artifact and object-state hash on every persisted finding;
 *  - links each finding to the project's lifecycle for its identity key, creating
 *    it on first detection (first_detected) and updating last_detected / last_evaluated;
 *  - carries status over (accepted risk, false positive, suppression) unless the
 *    suppression expired / the release changed / the object changed, in which case
 *    the lifecycle is re-opened with a SYSTEM history entry; resolved findings that
 *    re-appear are re-opened as regressions;
 *  - after the run, lifecycles of (engine, artifact) pairs that completed without
 *    re-detecting them are auto-resolved (OPEN/ACKNOWLEDGED/REGRESSION_TEST_CREATED only).
 */
export class FindingLifecycleReconciler {
  constructor(
    private readonly db: DatabaseService,
    private readonly logger: Logger
  ) {}

  async beginRun(input: {
    analysisId: string;
    organizationId: string;
    projectId: string;
    targetRelease: string;
    evaluatedAt?: Date;
  }): Promise<LifecycleRunContext> {
    let knowledgeSnapshotId: string | null = null;
    try {
      const res = await this.db.query(
        `SELECT id FROM knowledge_snapshots WHERE status = 'PUBLISHED' ORDER BY seq DESC LIMIT 1`,
        [],
        { tenantId: input.organizationId }
      );
      knowledgeSnapshotId = res.rows?.[0]?.id ?? null;
    } catch (err: any) {
      this.logger.warn(`Could not resolve knowledge snapshot for analysis ${input.analysisId}: ${err?.message ?? err}`);
    }
    return {
      ...input,
      knowledgeSnapshotId,
      evaluatedAt: input.evaluatedAt ?? new Date(),
      ordinals: new Map(),
      evaluatedPairs: new Set(),
      detectedLifecycleIds: new Set(),
    };
  }

  markEvaluated(ctx: LifecycleRunContext, engine: string, artifactName: string | null): void {
    ctx.evaluatedPairs.add(`${engine}${PAIR_SEP}${artifactName ?? ''}`);
  }

  /** Runs inside the persisting tenant transaction, right after the finding + evidence insert. */
  async attach(client: Queryable, ctx: LifecycleRunContext, p: AttachFindingParams): Promise<string> {
    const f = p.finding;
    const baseKey = lifecycleBaseKey(p.engine, String(f.ruleId), f.affectedObjects, p.artifactName);
    const ordinal = ctx.ordinals.get(baseKey) ?? 0;
    ctx.ordinals.set(baseKey, ordinal + 1);
    const key = lifecycleKey(baseKey, ordinal);
    const objHash = objectStateHash(f);
    const engineVersion = p.engineVersion;
    const ruleVersion = p.ruleVersions[String(f.ruleId)] ?? null;
    const td = (f.technicalDetails ?? {}) as Record<string, unknown>;
    const aiModel =
      td.is_ai_generated || td.ai_generated || td.isAiGenerated
        ? String(td.aiModelVersion ?? td.ai_model_version ?? td.aiModel ?? td.model ?? '') || null
        : null;

    await client.query(
      `INSERT INTO finding_lifecycles (
         organization_id, project_id, lifecycle_key, engine, rule_id, artifact_name, status,
         first_detected_at, first_analysis_id, last_detected_at, last_evaluated_at, last_analysis_id,
         latest_finding_id, last_object_hash, last_target_release, detection_count
       ) VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7, $8, $7, $7, $8, $9, $10, $11, 0)
       ON CONFLICT (organization_id, project_id, lifecycle_key) DO NOTHING`,
      [
        ctx.organizationId,
        ctx.projectId,
        key,
        p.engine,
        f.ruleId,
        p.artifactName,
        ctx.evaluatedAt.toISOString(),
        ctx.analysisId,
        p.findingId,
        objHash,
        ctx.targetRelease,
      ]
    );
    const lcRes = await client.query(
      `SELECT ${LIFECYCLE_COLUMNS} FROM finding_lifecycles
        WHERE organization_id = $1 AND project_id = $2 AND lifecycle_key = $3 FOR UPDATE`,
      [ctx.organizationId, ctx.projectId, key]
    );
    const lc = lcRes.rows[0];
    const isNew = Number(lc.detection_count) === 0;
    const alreadyInRun = lc.last_analysis_id === ctx.analysisId && !isNew;

    let status: string = lc.status;
    let reopened = false;
    if (isNew) {
      await insertHistory(client, {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        lifecycleId: lc.id,
        findingId: p.findingId,
        analysisId: ctx.analysisId,
        event: 'DETECTED',
        fromStatus: null,
        toStatus: 'OPEN',
        reason: 'First detected by analysis.',
        actorKind: 'SYSTEM',
      });
    } else if (!alreadyInRun) {
      const decision = evaluateCarryOver(
        {
          status: lc.status,
          suppressionMode: lc.suppression_mode,
          suppressedUntil: lc.suppressed_until ? new Date(lc.suppressed_until) : null,
          suppressedRelease: lc.suppressed_release,
          suppressedObjectHash: lc.suppressed_object_hash,
          lastObjectHash: lc.last_object_hash,
          lastTargetRelease: lc.last_target_release,
        },
        { now: ctx.evaluatedAt, targetRelease: ctx.targetRelease, objectHash: objHash }
      );
      if (decision.action === 'REOPEN') {
        reopened = true;
        status = 'OPEN';
        await insertHistory(client, {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          lifecycleId: lc.id,
          findingId: p.findingId,
          analysisId: ctx.analysisId,
          event: decision.event,
          fromStatus: lc.status,
          toStatus: 'OPEN',
          reason: decision.reason,
          actorKind: 'SYSTEM',
          metadata: { suppressionMode: lc.suppression_mode, targetRelease: ctx.targetRelease },
        });
      } else if (lc.status !== 'OPEN') {
        await insertHistory(client, {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          lifecycleId: lc.id,
          findingId: p.findingId,
          analysisId: ctx.analysisId,
          event: 'CARRIED_OVER',
          fromStatus: lc.status,
          toStatus: lc.status,
          reason: 'Status carried over to the re-detected finding.',
          actorKind: 'SYSTEM',
          metadata: { suppressionMode: lc.suppression_mode },
        });
      }
    }

    await client.query(
      `UPDATE finding_lifecycles SET
         status = $2,
         status_reason = CASE WHEN $3 THEN $4 ELSE status_reason END,
         status_changed_by = CASE WHEN $3 THEN NULL ELSE status_changed_by END,
         status_changed_at = CASE WHEN $3 THEN $5::timestamptz ELSE status_changed_at END,
         suppression_mode = CASE WHEN $3 THEN NULL ELSE suppression_mode END,
         suppressed_until = CASE WHEN $3 THEN NULL ELSE suppressed_until END,
         suppressed_release = CASE WHEN $3 THEN NULL ELSE suppressed_release END,
         suppressed_object_hash = CASE WHEN $3 THEN NULL ELSE suppressed_object_hash END,
         last_detected_at = $5, last_evaluated_at = $5, last_analysis_id = $6,
         latest_finding_id = $7, last_object_hash = $8, last_target_release = $9,
         detection_count = detection_count + CASE WHEN $10 THEN 0 ELSE 1 END,
         revision = revision + CASE WHEN $3 THEN 1 ELSE 0 END,
         updated_at = NOW()
       WHERE id = $1`,
      [
        lc.id,
        status,
        reopened,
        reopened ? 'Re-opened automatically by analysis.' : null,
        ctx.evaluatedAt.toISOString(),
        ctx.analysisId,
        p.findingId,
        objHash,
        ctx.targetRelease,
        alreadyInRun,
      ]
    );

    await client.query(
      `UPDATE findings SET
         lifecycle_id = $2, engine_version = $3, rule_version = $4, knowledge_snapshot_id = $5,
         target_release = $6, source_file_id = $7, source_file_name = $8, object_state_hash = $9,
         ai_model_version = $10
       WHERE id = $1`,
      [
        p.findingId,
        lc.id,
        engineVersion,
        ruleVersion,
        p.knowledgeSnapshotId ?? ctx.knowledgeSnapshotId,
        ctx.targetRelease,
        p.sourceFileId,
        p.artifactName,
        objHash,
        aiModel,
      ]
    );
    ctx.detectedLifecycleIds.add(lc.id);
    return lc.id;
  }

  /**
   * After all engine calls: auto-resolve lifecycles of fully evaluated (engine, artifact)
   * pairs that were not re-detected, and stamp last_evaluated on every evaluated lifecycle.
   * Best effort: a failure here never fails the analysis.
   */
  async finishRun(ctx: LifecycleRunContext): Promise<{ resolved: number }> {
    if (ctx.evaluatedPairs.size === 0) return { resolved: 0 };
    let resolved = 0;
    try {
      await this.db.withTenantTransaction(ctx.organizationId, async (client) => {
        for (const pair of ctx.evaluatedPairs) {
          const [engine, artifactName] = pair.split(PAIR_SEP);
          const stale = await client.query(
            `SELECT id, status, latest_finding_id FROM finding_lifecycles
              WHERE organization_id = $1 AND project_id = $2 AND engine = $3
                AND COALESCE(artifact_name, '') = $4 AND NOT (id = ANY($5::uuid[]))
              FOR UPDATE`,
            [ctx.organizationId, ctx.projectId, engine, artifactName, [...ctx.detectedLifecycleIds]]
          );
          for (const row of stale.rows) {
            const autoResolve = AUTO_RESOLVABLE_STATUSES.includes(row.status);
            await client.query(
              `UPDATE finding_lifecycles SET
                 last_evaluated_at = $2,
                 status = CASE WHEN $3 THEN 'RESOLVED' ELSE status END,
                 status_reason = CASE WHEN $3 THEN $4 ELSE status_reason END,
                 status_changed_by = CASE WHEN $3 THEN NULL ELSE status_changed_by END,
                 status_changed_at = CASE WHEN $3 THEN $2::timestamptz ELSE status_changed_at END,
                 revision = revision + CASE WHEN $3 THEN 1 ELSE 0 END,
                 updated_at = NOW()
               WHERE id = $1`,
              [
                row.id,
                ctx.evaluatedAt.toISOString(),
                autoResolve,
                `Not reproduced by analysis ${ctx.analysisId}.`,
              ]
            );
            if (autoResolve) {
              resolved++;
              await insertHistory(client, {
                organizationId: ctx.organizationId,
                projectId: ctx.projectId,
                lifecycleId: row.id,
                findingId: row.latest_finding_id,
                analysisId: ctx.analysisId,
                event: 'AUTO_RESOLVED',
                fromStatus: row.status,
                toStatus: 'RESOLVED',
                reason: `Not reproduced: ${engine} evaluated '${artifactName}' without detecting it.`,
                actorKind: 'SYSTEM',
              });
            }
          }
        }
      });
    } catch (err: any) {
      this.logger.warn(`Lifecycle reconciliation after analysis ${ctx.analysisId} failed: ${err?.message ?? err}`);
    }
    return { resolved };
  }
}
