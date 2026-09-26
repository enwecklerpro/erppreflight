import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { RetentionSettings } from '@erppreflight/schemas';
import { DatabaseService } from '../database/database.service';
import { S3StorageService } from '../storage/s3-storage.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../billing/entitlements.service';

/** Safety net for "delete immediately after analysis" files that were never analysed. */
export const UNANALYSED_ZERO_RETENTION_GRACE_HOURS = 24;
const MAX_IDS_IN_AUDIT = 100;
const BATCH_SIZE = 500;

export interface PurgeSummary {
  organizationId: string;
  artifactsPurged: number;
  artifactBytes: number;
  reportsPurged: number;
  reportBytes: number;
  storageErrors: number;
}

export interface SweepSummary {
  startedAt: string;
  finishedAt: string;
  tenantsScanned: number;
  purges: PurgeSummary[];
  trialsExpired: number;
}

/**
 * File retention (spec 10.16) and trial expiry bookkeeping (13.8).
 *
 * Retention semantics per organization:
 *  - artifact_retention_days NULL → keep until the project is deleted;
 *  - 0 → delete right after the analysis that consumed the file finishes
 *    (AnalysisProcessor hook), plus a 24 h safety net for unanalysed uploads;
 *  - N → delete artifacts older than N days;
 *  - report_retention_days NULL → keep; N → delete reports older than N days.
 * Objects are deleted from MinIO/S3 first, then the rows; every purge is audited.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: S3StorageService,
    private readonly audit: AuditService,
    @Optional() private readonly entitlements?: EntitlementsService
  ) {}

  async getSettings(organizationId: string) {
    const res = await this.db.query(
      `SELECT artifact_retention_days, report_retention_days FROM organizations WHERE id = $1`,
      [organizationId],
      { bypassRls: true }
    );
    const row = res.rows?.[0] ?? {};
    const plan = this.entitlements ? await this.entitlements.getPlanState(organizationId) : null;
    return {
      artifactRetentionDays: row.artifact_retention_days ?? null,
      reportRetentionDays: row.report_retention_days ?? null,
      planMaximums: plan
        ? {
            tier: plan.effectiveTier,
            maxArtifactRetentionDays: plan.limits.retention.maxArtifactRetentionDays,
            maxReportRetentionDays: plan.limits.retention.maxReportRetentionDays,
          }
        : null,
    };
  }

  async updateSettings(organizationId: string, settings: RetentionSettings) {
    if (this.entitlements) {
      const plan = await this.entitlements.getPlanState(organizationId);
      const { maxArtifactRetentionDays, maxReportRetentionDays } = plan.limits.retention;
      if (settings.artifactRetentionDays !== null && settings.artifactRetentionDays > maxArtifactRetentionDays) {
        throw new BadRequestException(
          `Artifact retention of ${settings.artifactRetentionDays} days exceeds the ${plan.effectiveTier} plan maximum (${maxArtifactRetentionDays} days).`
        );
      }
      if (settings.reportRetentionDays !== null && settings.reportRetentionDays > maxReportRetentionDays) {
        throw new BadRequestException(
          `Report retention of ${settings.reportRetentionDays} days exceeds the ${plan.effectiveTier} plan maximum (${maxReportRetentionDays} days).`
        );
      }
    }
    await this.db.query(
      `UPDATE organizations SET artifact_retention_days = $2, report_retention_days = $3, updated_at = NOW() WHERE id = $1`,
      [organizationId, settings.artifactRetentionDays, settings.reportRetentionDays],
      { bypassRls: true }
    );
    return this.getSettings(organizationId);
  }

  private async deleteObject(bucket: string, key: string): Promise<boolean> {
    try {
      await this.storage.getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (err: any) {
      this.logger.error(`Retention: could not delete s3://${bucket}/${key}: ${err?.message ?? err}`);
      return false;
    }
  }

  /**
   * Deletes the given artifact rows' objects (clean + quarantine buckets), then the
   * rows whose objects were removed. Rows whose object deletion failed are kept so
   * the next sweep retries them.
   */
  private async purgeArtifactRows(
    organizationId: string,
    rows: Array<{ id: string; storage_path: string; file_size: string | number }>,
    reason: string
  ): Promise<Pick<PurgeSummary, 'artifactsPurged' | 'artifactBytes' | 'storageErrors'>> {
    const deleted: string[] = [];
    let bytes = 0;
    let storageErrors = 0;
    for (const row of rows) {
      const okClean = await this.deleteObject(this.storage.cleanBucket, row.storage_path);
      const okQuarantine = await this.deleteObject(this.storage.quarantineBucket, row.storage_path);
      if (okClean && okQuarantine) {
        deleted.push(row.id);
        bytes += Number(row.file_size) || 0;
      } else {
        storageErrors++;
      }
    }
    if (deleted.length > 0) {
      await this.db.query(
        `DELETE FROM uploaded_files WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
        [organizationId, deleted],
        { tenantId: organizationId }
      );
      await this.audit.recordSafe({
        organizationId,
        action: 'retention.artifacts.purged',
        resourceType: 'ARTIFACT',
        payload: {
          reason,
          count: deleted.length,
          bytes,
          storageErrors,
          fileIds: deleted.slice(0, MAX_IDS_IN_AUDIT),
          truncated: deleted.length > MAX_IDS_IN_AUDIT,
        },
      });
    }
    return { artifactsPurged: deleted.length, artifactBytes: bytes, storageErrors };
  }

  private async purgeReportRows(
    organizationId: string,
    rows: Array<{ id: string; s3_key: string; file_size: string | number }>,
    reason: string
  ): Promise<Pick<PurgeSummary, 'reportsPurged' | 'reportBytes' | 'storageErrors'>> {
    const deleted: string[] = [];
    let bytes = 0;
    let storageErrors = 0;
    for (const row of rows) {
      if (await this.deleteObject(this.storage.reportsBucket, row.s3_key)) {
        deleted.push(row.id);
        bytes += Number(row.file_size) || 0;
      } else {
        storageErrors++;
      }
    }
    if (deleted.length > 0) {
      await this.db.query(
        `DELETE FROM reports WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
        [organizationId, deleted],
        { tenantId: organizationId }
      );
      await this.audit.recordSafe({
        organizationId,
        action: 'retention.reports.purged',
        resourceType: 'REPORT',
        payload: {
          reason,
          count: deleted.length,
          bytes,
          storageErrors,
          reportIds: deleted.slice(0, MAX_IDS_IN_AUDIT),
          truncated: deleted.length > MAX_IDS_IN_AUDIT,
        },
      });
    }
    return { reportsPurged: deleted.length, reportBytes: bytes, storageErrors };
  }

  /** Applies the tenant's retention policy now. */
  async purgeTenant(organizationId: string, now: Date = new Date()): Promise<PurgeSummary> {
    const settingsRes = await this.db.query(
      `SELECT artifact_retention_days, report_retention_days FROM organizations WHERE id = $1`,
      [organizationId],
      { bypassRls: true }
    );
    const s = settingsRes.rows?.[0];
    const summary: PurgeSummary = {
      organizationId,
      artifactsPurged: 0,
      artifactBytes: 0,
      reportsPurged: 0,
      reportBytes: 0,
      storageErrors: 0,
    };
    if (!s) return summary;

    if (s.artifact_retention_days !== null && s.artifact_retention_days !== undefined) {
      const days = Number(s.artifact_retention_days);
      const cutoffMs = days === 0 ? UNANALYSED_ZERO_RETENTION_GRACE_HOURS * 3_600_000 : days * 86_400_000;
      const cutoff = new Date(now.getTime() - cutoffMs).toISOString();
      // Never delete inputs of analyses that are still queued or running.
      const files = await this.db.query(
        `SELECT f.id, f.storage_path, f.file_size
           FROM uploaded_files f
          WHERE f.organization_id = $1 AND f.created_at < $2
            AND NOT EXISTS (
              SELECT 1 FROM analyses a
               WHERE a.organization_id = f.organization_id AND a.project_id = f.project_id
                 AND a.status IN ('QUEUED', 'RUNNING'))
          ORDER BY f.created_at ASC
          LIMIT ${BATCH_SIZE}`,
        [organizationId, cutoff],
        { tenantId: organizationId }
      );
      const r = await this.purgeArtifactRows(
        organizationId,
        files.rows ?? [],
        days === 0 ? `unanalysed upload older than ${UNANALYSED_ZERO_RETENTION_GRACE_HOURS}h (policy: delete after analysis)` : `older than ${days} day(s)`
      );
      summary.artifactsPurged += r.artifactsPurged;
      summary.artifactBytes += r.artifactBytes;
      summary.storageErrors += r.storageErrors;
    }

    if (s.report_retention_days !== null && s.report_retention_days !== undefined) {
      const days = Number(s.report_retention_days);
      const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
      const reports = await this.db.query(
        `SELECT id, s3_key, file_size FROM reports
          WHERE organization_id = $1 AND created_at < $2
          ORDER BY created_at ASC LIMIT ${BATCH_SIZE}`,
        [organizationId, cutoff],
        { tenantId: organizationId }
      );
      const r = await this.purgeReportRows(organizationId, reports.rows ?? [], `older than ${days} day(s)`);
      summary.reportsPurged += r.reportsPurged;
      summary.reportBytes += r.reportBytes;
      summary.storageErrors += r.storageErrors;
    }
    return summary;
  }

  /**
   * "Delete immediately after analysis" (policy 0): called by the analysis
   * processor when a run finishes. No-op for other policies.
   */
  async purgeAfterAnalysis(organizationId: string, fileIds: string[], analysisId: string): Promise<number> {
    if (fileIds.length === 0) return 0;
    const policy = await this.db.query(
      `SELECT artifact_retention_days FROM organizations WHERE id = $1`,
      [organizationId],
      { bypassRls: true }
    );
    if (policy.rows?.[0]?.artifact_retention_days !== 0) return 0;
    const files = await this.db.query(
      `SELECT id, storage_path, file_size FROM uploaded_files
        WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
      [organizationId, fileIds],
      { tenantId: organizationId }
    );
    const r = await this.purgeArtifactRows(organizationId, files.rows ?? [], `deleted after analysis ${analysisId}`);
    return r.artifactsPurged;
  }

  /** Marks expired trials and audits the downgrade (enforcement itself is computed live). */
  async expireTrials(now: Date = new Date()): Promise<number> {
    const res = await this.db.query(
      `UPDATE organizations SET trial_expired_at = $1
        WHERE trial_ends_at IS NOT NULL AND trial_ends_at <= $1 AND trial_expired_at IS NULL
        RETURNING id, plan_tier, trial_tier, subscription_status`,
      [now.toISOString()],
      { bypassRls: true }
    );
    for (const row of res.rows ?? []) {
      const paid = ['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(row.subscription_status);
      await this.audit.recordSafe({
        organizationId: row.id,
        action: 'billing.trial.expired',
        resourceType: 'SUBSCRIPTION',
        resourceId: row.id,
        payload: {
          trialTier: row.trial_tier,
          effectiveTierAfter: row.plan_tier,
          downgraded: !paid && row.trial_tier !== row.plan_tier,
        },
      });
    }
    return res.rows?.length ?? 0;
  }

  /** Full governance sweep over every tenant (scheduled job). */
  async sweep(now: Date = new Date()): Promise<SweepSummary> {
    const startedAt = new Date().toISOString();
    const trialsExpired = await this.expireTrials(now);
    const orgs = await this.db.query(
      `SELECT id FROM organizations
        WHERE artifact_retention_days IS NOT NULL OR report_retention_days IS NOT NULL
        ORDER BY id`,
      [],
      { bypassRls: true }
    );
    const purges: PurgeSummary[] = [];
    for (const org of orgs.rows ?? []) {
      try {
        const summary = await this.purgeTenant(org.id, now);
        if (summary.artifactsPurged || summary.reportsPurged || summary.storageErrors) purges.push(summary);
      } catch (err: any) {
        this.logger.error(`Retention sweep failed for org ${org.id}: ${err?.message ?? err}`);
      }
    }
    const result = {
      startedAt,
      finishedAt: new Date().toISOString(),
      tenantsScanned: orgs.rows?.length ?? 0,
      purges,
      trialsExpired,
    };
    this.logger.log(
      `Governance sweep: ${result.tenantsScanned} tenants with retention policy, ${purges.length} purged, ${trialsExpired} trials expired`
    );
    return result;
  }
}
