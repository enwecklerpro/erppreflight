import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { FindingStatus } from '@erppreflight/schemas';
import { DatabaseService } from '../../database/database.service';
import { FindingLifecycleService } from './finding-lifecycle.service';
import { insertHistory, Queryable } from './lifecycle.sql';

/**
 * Review statuses of the pre-lifecycle API (v0, main@7a76aea: PATCH /findings/:id/review
 * stored them in findings.technical_details.review) mapped onto lifecycle statuses.
 * Also used by the legacy PATCH /findings/:id/review endpoint.
 */
export const LEGACY_REVIEW_STATUS_MAP = {
  OPEN: 'OPEN',
  VERIFIED: 'ACKNOWLEDGED',
  ACCEPTED_RISK: 'ACCEPTED_RISK',
  SUPPRESSED_FALSE_POSITIVE: 'FALSE_POSITIVE',
} as const satisfies Record<string, FindingStatus>;

export type LegacyReviewStatus = keyof typeof LEGACY_REVIEW_STATUS_MAP;

export interface LegacyReviewRecord {
  status?: unknown;
  justification?: unknown;
  reviewedBy?: unknown;
  reviewedAt?: unknown;
  suppressScope?: unknown;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BATCH = 500;

/** Pure: the lifecycle status a legacy review record maps to (null = nothing to import). */
export function mapLegacyReview(review: LegacyReviewRecord | null | undefined): FindingStatus | null {
  if (!review || typeof review !== 'object') return null;
  const status = typeof review.status === 'string' ? review.status : '';
  if (!Object.prototype.hasOwnProperty.call(LEGACY_REVIEW_STATUS_MAP, status)) return null;
  const mapped = LEGACY_REVIEW_STATUS_MAP[status as LegacyReviewStatus];
  return mapped === 'OPEN' ? null : mapped;
}

function validDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * One-time upgrade step for data created before the finding lifecycle (migration 017):
 * findings reviewed through the v0 review API (accepted risk, false positive, verified)
 * get their lifecycle created with that decision, so the finding list, statistics and
 * the carry-over into later analyses show the decision instead of silently re-opening it.
 *
 * Runs at application bootstrap (after the migrations). Idempotent: it only visits
 * findings that still have no lifecycle, and it never overrides a lifecycle whose status
 * was already changed by anyone. The finding rows themselves are not modified beyond the
 * lifecycle link that FindingLifecycleService.ensureLifecycle always records.
 */
@Injectable()
export class LegacyReviewImportService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LegacyReviewImportService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly lifecycle: FindingLifecycleService
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.LEGACY_REVIEW_IMPORT === 'false') return;
    try {
      const { imported, linked } = await this.importAll();
      if (linked > 0) {
        this.logger.log(`Legacy finding reviews: ${imported} imported into lifecycles (${linked} findings linked)`);
      }
    } catch (err: any) {
      // Missing tables (migrations disabled) or DB unavailable must not stop the API;
      // the next start retries (the selection is idempotent).
      this.logger.warn(`Legacy finding review import skipped: ${err?.message ?? err}`);
    }
  }

  async importAll(): Promise<{ imported: number; linked: number }> {
    let imported = 0;
    let linked = 0;
    const failed = new Set<string>();
    for (;;) {
      const res = await this.db.query(
        `SELECT f.id, f.organization_id, f.technical_details -> 'review' AS review
           FROM findings f
          WHERE f.lifecycle_id IS NULL
            AND jsonb_typeof(f.technical_details -> 'review') = 'object'
            AND NOT (f.id = ANY($1::uuid[]))
          ORDER BY f.organization_id, f.created_at, f.id
          LIMIT ${BATCH}`,
        [[...failed]],
        { bypassRls: true }
      );
      const rows = res.rows ?? [];
      if (rows.length === 0) break;
      for (const row of rows) {
        try {
          const done = await this.db.withTenantTransaction(row.organization_id, (client) =>
            this.importOne(client, row.organization_id, row.id, row.review)
          );
          linked++;
          if (done) imported++;
        } catch (err: any) {
          failed.add(row.id);
          this.logger.warn(`Legacy review of finding ${row.id} not imported: ${err?.message ?? err}`);
        }
      }
      if (rows.length < BATCH) break;
    }
    return { imported, linked };
  }

  /** Links the finding to its lifecycle and applies the legacy decision. Returns true when a status was imported. */
  async importOne(client: Queryable, tenantId: string, findingId: string, review: LegacyReviewRecord | null): Promise<boolean> {
    const { finding, lifecycle } = await this.lifecycle.ensureLifecycle(client, tenantId, findingId);
    const target = mapLegacyReview(review);
    if (!target) return false;
    // Never override a decision taken after the upgrade (or by an earlier finding of the same lifecycle).
    if (lifecycle.status !== 'OPEN' || lifecycle.status_changed_at) return false;

    const reviewerRaw = typeof review?.reviewedBy === 'string' ? review.reviewedBy : null;
    let reviewer: string | null = null;
    if (reviewerRaw && UUID_RE.test(reviewerRaw)) {
      const u = await client.query('SELECT id FROM users WHERE id = $1', [reviewerRaw]);
      reviewer = u.rows[0]?.id ?? null;
    }
    const justification =
      typeof review?.justification === 'string' && review.justification.trim() ? review.justification.trim().slice(0, 2000) : null;
    const reviewedAt = validDate(review?.reviewedAt);
    const reason = justification ? `Imported from legacy review: ${justification}` : 'Imported from legacy review';

    const upd = await client.query(
      `UPDATE finding_lifecycles SET
         status = $2, status_reason = $3, status_changed_by = $4,
         status_changed_at = COALESCE($5::timestamptz, NOW()),
         revision = revision + 1, updated_at = NOW()
       WHERE id = $1 AND status = 'OPEN' AND status_changed_at IS NULL
       RETURNING id`,
      [lifecycle.id, target, reason, reviewer, reviewedAt]
    );
    if (upd.rows.length === 0) return false;
    await insertHistory(client, {
      organizationId: tenantId,
      projectId: lifecycle.project_id,
      lifecycleId: lifecycle.id,
      findingId: finding.id,
      event: 'STATUS_CHANGED',
      fromStatus: 'OPEN',
      toStatus: target,
      reason,
      actorId: reviewer,
      actorKind: reviewer ? 'USER' : 'SYSTEM',
      metadata: {
        source: 'legacy-review',
        legacyStatus: review?.status ?? null,
        reviewedAt,
        suppressScope: typeof review?.suppressScope === 'string' ? review.suppressScope : null,
      },
    });
    return true;
  }
}
