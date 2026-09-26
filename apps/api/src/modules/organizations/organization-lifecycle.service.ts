import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ZipArchive } from 'archiver';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { S3StorageService } from '../storage/s3-storage.service';
import { SecurityAuditService, RequestMeta } from '../auth/security-audit.service';
import { BILLING_ACCOUNT_HOOK, BillingAccountHook } from './billing-account.hook';
import { withGlobalTransaction } from '../auth/global-transaction';

/** Rows exported per table; larger tables are flagged as truncated in the manifest. */
export const ORG_EXPORT_ROW_LIMIT = 100_000;

export interface OrganizationDeletionResult {
  organizationId: string;
  organizationName: string;
  storageObjectsDeleted: number;
  billing: { status: string; detail?: string };
}

/**
 * Organization-level GDPR operations (spec 10 §10.19): full data export (ZIP of JSON
 * files) and permanent deletion (storage objects first, then the organization row —
 * every tenant table references organizations ON DELETE CASCADE).
 */
@Injectable()
export class OrganizationLifecycleService {
  private readonly logger = new Logger(OrganizationLifecycleService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: S3StorageService,
    private readonly securityAudit: SecurityAuditService,
    @Inject(BILLING_ACCOUNT_HOOK) private readonly billing: BillingAccountHook
  ) {}

  async setSecurityPolicy(
    organizationId: string,
    actor: { id: string; mfaEnabled?: boolean },
    require2fa: boolean,
    meta: RequestMeta = {}
  ) {
    if (require2fa && !actor.mfaEnabled) {
      throw new ConflictException(
        'Enable two-factor authentication on your own account before requiring it for the organization.'
      );
    }
    const res = await this.db.query(
      `UPDATE organizations SET require_2fa = $1, updated_at = NOW() WHERE id = $2 RETURNING require_2fa`,
      [require2fa, organizationId],
      { bypassRls: true }
    );
    if (res.rows.length === 0) throw new NotFoundException('Organization not found');
    const missing = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM organization_members m JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1 AND u.totp_enabled_at IS NULL`,
      [organizationId],
      { tenantId: organizationId }
    );
    await this.securityAudit.recordForOrganization(
      organizationId,
      actor.id,
      'ORGANIZATION_SECURITY_POLICY_CHANGED',
      'ORGANIZATION',
      organizationId,
      { require2fa },
      meta
    );
    return { require2fa: res.rows[0].require_2fa, membersWithout2fa: Number(missing.rows[0]?.n ?? 0) };
  }

  /** Builds a ZIP archive with the organization's data (metadata; no artifact bytes). */
  async exportOrganization(organizationId: string, actorId: string, meta: RequestMeta = {}) {
    const org = await this.db.query(
      `SELECT id, name, slug, plan_tier, status, data_policy, require_2fa, created_at, updated_at
       FROM organizations WHERE id = $1`,
      [organizationId],
      { bypassRls: true }
    );
    if (org.rows.length === 0) throw new NotFoundException('Organization not found');

    const limit = ORG_EXPORT_ROW_LIMIT + 1;
    const tables: Record<string, { sql: string }> = {
      members: {
        sql: `SELECT m.id, m.role, m.created_at AS joined_at, u.id AS user_id, u.email, u.full_name
              FROM organization_members m JOIN users u ON u.id = m.user_id
              WHERE m.organization_id = $1 ORDER BY m.created_at LIMIT ${limit}`,
      },
      invitations: {
        sql: `SELECT id, email, role, invited_by, expires_at, accepted_at, accepted_by, revoked_at, created_at
              FROM organization_invitations WHERE organization_id = $1 ORDER BY created_at LIMIT ${limit}`,
      },
      projects: {
        sql: `SELECT id, name, slug, description, target_release, created_by, baseline_analysis_id, created_at, updated_at
              FROM projects WHERE organization_id = $1 ORDER BY created_at LIMIT ${limit}`,
      },
      files: {
        sql: `SELECT id, project_id, file_name, file_size, mime_type, checksum_sha256, quarantine_status,
                     redaction_status, uploaded_by, created_at
              FROM uploaded_files WHERE organization_id = $1 ORDER BY created_at LIMIT ${limit}`,
      },
      analyses: {
        sql: `SELECT id, project_id, status, engine_types, target_release, is_baseline, triggered_by, created_at, completed_at
              FROM analyses WHERE organization_id = $1 ORDER BY created_at LIMIT ${limit}`,
      },
      findings: {
        sql: `SELECT f.id, f.project_id, f.analysis_id, f.engine, f.rule_id, f.severity, f.category, f.title,
                     f.confidence_class, f.confidence_score, f.fingerprint, f.created_at,
                     (SELECT COUNT(*)::int FROM evidence e WHERE e.finding_id = f.id) AS evidence_count
              FROM findings f WHERE f.organization_id = $1 ORDER BY f.created_at, f.id LIMIT ${limit}`,
      },
      reports: {
        sql: `SELECT id, project_id, analysis_id, format, file_name, file_size, checksum_sha256, created_by, created_at
              FROM reports WHERE organization_id = $1 ORDER BY created_at LIMIT ${limit}`,
      },
      audit_events: {
        sql: `SELECT id, sequence_num, actor_id, actor_type, action, target_type, target_id, payload,
                     prev_hash, current_hash, created_at
              FROM audit_events WHERE organization_id = $1 ORDER BY sequence_num LIMIT ${limit}`,
      },
    };

    const data: Record<string, unknown[]> = {};
    const manifestTables: Record<string, { rows: number; truncated: boolean; sha256: string }> = {};
    await this.db.withTenantTransaction(organizationId, async (client) => {
      for (const [name, def] of Object.entries(tables)) {
        const res = await client.query(def.sql, [organizationId]);
        const truncated = res.rows.length > ORG_EXPORT_ROW_LIMIT;
        const rows = truncated ? res.rows.slice(0, ORG_EXPORT_ROW_LIMIT) : res.rows;
        data[name] = rows;
        manifestTables[name] = { rows: rows.length, truncated, sha256: '' };
      }
    });

    const files: Array<{ name: string; content: string }> = [
      { name: 'organization.json', content: JSON.stringify(org.rows[0], null, 2) },
      ...Object.entries(data).map(([name, rows]) => ({ name: `${name}.json`, content: JSON.stringify(rows, null, 2) })),
    ];
    for (const file of files) {
      const key = file.name.replace(/\.json$/, '');
      if (manifestTables[key]) {
        manifestTables[key].sha256 = createHash('sha256').update(file.content).digest('hex');
      }
    }
    const manifest = {
      format: 'erppreflight.organization-export/v1',
      organizationId,
      organizationName: org.rows[0].name,
      exportedAt: new Date().toISOString(),
      exportedBy: actorId,
      scope:
        'Organization record, members, invitations, projects, file metadata, analyses, findings metadata, ' +
        'report metadata and the audit ledger. Uploaded artifact contents and generated report files are not ' +
        'included; download them from the workspace.',
      tables: manifestTables,
    };

    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    await new Promise<void>((resolve, reject) => {
      archive.on('end', () => resolve());
      archive.on('error', (err: Error) => reject(err));
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
      for (const file of files) archive.append(file.content, { name: file.name });
      archive.finalize();
    });

    await this.securityAudit.recordForOrganization(
      organizationId,
      actorId,
      'ORGANIZATION_DATA_EXPORTED',
      'ORGANIZATION',
      organizationId,
      { tables: Object.fromEntries(Object.entries(manifestTables).map(([k, v]) => [k, v.rows])) },
      meta
    );

    const slug = String(org.rows[0].slug || 'organization').replace(/[^a-z0-9-]/gi, '-');
    return {
      buffer: Buffer.concat(chunks),
      fileName: `erppreflight-org-export-${slug}-${new Date().toISOString().slice(0, 10)}.zip`,
    };
  }

  /**
   * Permanently deletes an organization: billing hook, all storage objects under
   * tenants/{id}/, then the organization row (cascades to every tenant table).
   * Storage failures abort the deletion so no unreachable customer data remains.
   */
  async deleteOrganization(organizationId: string, actorId: string): Promise<OrganizationDeletionResult> {
    const org = await this.db.query('SELECT id, name, slug FROM organizations WHERE id = $1', [organizationId], {
      bypassRls: true,
    });
    if (org.rows.length === 0) throw new NotFoundException('Organization not found');
    if (org.rows[0].slug === 'erppreflight-global') {
      throw new BadRequestException('The platform organization cannot be deleted');
    }

    const billing = await this.billing.onOrganizationDeletion(organizationId);

    let storageObjectsDeleted = 0;
    try {
      storageObjectsDeleted = await this.storage.deleteTenantObjects(organizationId);
    } catch (err: any) {
      this.logger.error(`Organization ${organizationId} deletion aborted: storage cleanup failed: ${err.message}`);
      throw new ServiceUnavailableException(
        'Stored files could not be deleted; the organization was not deleted. Please try again later.'
      );
    }

    await withGlobalTransaction(this.db, async (client) => {
      // Declares this transaction as the GDPR erasure of exactly this organization, the
      // only case in which the append-only audit guard lets its ledger rows cascade away
      // (migration 011). Transaction-local: it cannot leak to other requests.
      await client.query("SELECT set_config('app.erasure_organization_id', $1, true)", [organizationId]);
      await client.query('DELETE FROM organizations WHERE id = $1', [organizationId]);
    });
    this.logger.warn(
      `ORGANIZATION_DELETED org=${organizationId} actor=${actorId} storageObjects=${storageObjectsDeleted} billing=${billing.status}`
    );
    return {
      organizationId,
      organizationName: org.rows[0].name,
      storageObjectsDeleted,
      billing,
    };
  }
}
