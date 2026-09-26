import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AssignFindingInput,
  AttachArtifactInput,
  BulkFindingActionInput,
  FINDING_COMMENT_ROLES,
  FINDING_STATUS_TRANSITIONS,
  FINDING_WRITE_ROLES,
  FindingStatus,
  TransitionFindingStatusInput,
  isTransitionAllowed,
  rolesForStatus,
} from '@erppreflight/schemas';
import { DatabaseService } from '../../database/database.service';
import { OutboxService } from '../../outbox/outbox.service';
import { AUTO_RESOLVABLE_STATUSES, lifecycleBaseKey, lifecycleKey, objectStateHash } from './lifecycle-keys';
import { insertHistory, LIFECYCLE_COLUMNS, Queryable } from './lifecycle.sql';

/** Authenticated caller as resolved by JwtAuthGuard + TenancyGuard. */
export interface LifecycleActor {
  id: string;
  /** Membership role in the current organization (request.tenantRole). */
  role: string | null | undefined;
  systemRole?: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function iso(v: unknown): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function dateOnly(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    // DATE columns arrive as local-midnight Date objects from node-postgres.
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}

export function mapLifecycleRow(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status as FindingStatus,
    statusReason: row.status_reason ?? null,
    statusChangedBy: row.status_changed_by ?? null,
    statusChangedAt: iso(row.status_changed_at),
    suppression: row.suppression_mode
      ? {
          mode: row.suppression_mode,
          until: iso(row.suppressed_until),
          release: row.suppressed_release ?? null,
          objectHash: row.suppressed_object_hash ?? null,
        }
      : null,
    assigneeId: row.assignee_id ?? null,
    assignee: row.assignee_email
      ? { id: row.assignee_id, email: row.assignee_email, fullName: row.assignee_name ?? null }
      : null,
    dueDate: dateOnly(row.due_date),
    firstDetectedAt: iso(row.first_detected_at),
    firstAnalysisId: row.first_analysis_id ?? null,
    lastDetectedAt: iso(row.last_detected_at),
    lastEvaluatedAt: iso(row.last_evaluated_at),
    lastAnalysisId: row.last_analysis_id ?? null,
    latestFindingId: row.latest_finding_id ?? null,
    lastTargetRelease: row.last_target_release ?? null,
    detectionCount: Number(row.detection_count ?? 0),
    revision: Number(row.revision ?? 1),
    allowedTransitions: FINDING_STATUS_TRANSITIONS[row.status as FindingStatus] ?? [],
  };
}

@Injectable()
export class FindingLifecycleService {
  private readonly logger = new Logger(FindingLifecycleService.name);

  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly outbox?: OutboxService
  ) {}

  // ------------------------------------------------------------------ access

  static assertRole(actor: LifecycleActor, allowed: readonly string[], what: string): void {
    if (actor.systemRole === 'SUPER_ADMIN') return;
    if (actor.role && allowed.includes(actor.role)) return;
    throw new ForbiddenException({
      code: 'FINDING_ROLE_REQUIRED',
      message: `${what} requires one of the roles: ${allowed.join(', ')}`,
    });
  }

  /**
   * Returns the finding's lifecycle row locked FOR UPDATE, creating it lazily for
   * findings persisted outside the analysis pipeline (imports, demo data, pre-017 rows).
   */
  async ensureLifecycle(client: Queryable, tenantId: string, findingId: string): Promise<{ finding: any; lifecycle: any }> {
    const fRes = await client.query(
      `SELECT f.id, f.project_id, f.analysis_id, f.engine, f.rule_id, f.affected_objects, f.lifecycle_id,
              f.source_file_name, f.target_release, f.created_at, f.object_state_hash, f.engine_version,
              a.target_release AS analysis_target_release,
              (SELECT e.artifact_path FROM evidence e WHERE e.finding_id = f.id ORDER BY e.created_at, e.id LIMIT 1) AS first_artifact,
              COALESCE((SELECT json_agg(json_build_object('sha256', e.sha256, 'snippet', e.snippet))
                          FROM evidence e WHERE e.finding_id = f.id), '[]'::json) AS evidence
         FROM findings f
         LEFT JOIN analyses a ON a.id = f.analysis_id
        WHERE f.organization_id = $1 AND f.id = $2`,
      [tenantId, findingId]
    );
    const finding = fRes.rows[0];
    if (!finding) throw new NotFoundException(`Finding with ID '${findingId}' not found.`);

    if (finding.lifecycle_id) {
      const lc = await client.query(
        `SELECT ${LIFECYCLE_COLUMNS} FROM finding_lifecycles WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [finding.lifecycle_id, tenantId]
      );
      if (lc.rows[0]) return { finding, lifecycle: lc.rows[0] };
    }

    const artifactName = finding.source_file_name ?? finding.first_artifact ?? null;
    const key = lifecycleKey(lifecycleBaseKey(finding.engine, finding.rule_id, finding.affected_objects, artifactName), 0);
    // The object-state hash is only comparable when the evidence came from the current
    // analysis pipeline (it records engine_version). Evidence of pre-017 findings (v0
    // upgrade data), demo rows and imports uses other snippet / hash formats, so their
    // baseline stays unknown and the next analysis establishes it; otherwise every
    // decision on such a finding would lapse as "the affected object changed".
    const objHash =
      finding.object_state_hash ??
      (finding.engine_version
        ? objectStateHash({ evidence: finding.evidence, affectedObjects: finding.affected_objects })
        : null);
    const release = finding.target_release ?? finding.analysis_target_release ?? null;
    const inserted = await client.query(
      `INSERT INTO finding_lifecycles (
         organization_id, project_id, lifecycle_key, engine, rule_id, artifact_name, status,
         first_detected_at, first_analysis_id, last_detected_at, last_evaluated_at, last_analysis_id,
         latest_finding_id, last_object_hash, last_target_release, detection_count
       ) VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7, $8, $7, $7, $8, $9, $10, $11, 1)
       ON CONFLICT (organization_id, project_id, lifecycle_key) DO NOTHING
       RETURNING id`,
      [tenantId, finding.project_id, key, finding.engine, finding.rule_id, artifactName, iso(finding.created_at),
        finding.analysis_id, finding.id, objHash, release]
    );
    const lcRes = await client.query(
      `SELECT ${LIFECYCLE_COLUMNS} FROM finding_lifecycles
        WHERE organization_id = $1 AND project_id = $2 AND lifecycle_key = $3 FOR UPDATE`,
      [tenantId, finding.project_id, key]
    );
    const lifecycle = lcRes.rows[0];
    if (inserted.rows.length > 0) {
      await insertHistory(client, {
        organizationId: tenantId,
        projectId: finding.project_id,
        lifecycleId: lifecycle.id,
        findingId: finding.id,
        analysisId: finding.analysis_id,
        event: 'DETECTED',
        fromStatus: null,
        toStatus: 'OPEN',
        reason: 'Lifecycle initialised from an existing finding.',
        actorKind: 'SYSTEM',
      });
    }
    await client.query(
      `UPDATE findings SET lifecycle_id = $1, object_state_hash = COALESCE(object_state_hash, $2) WHERE id = $3`,
      [lifecycle.id, objHash, finding.id]
    );
    finding.lifecycle_id = lifecycle.id;
    return { finding, lifecycle };
  }

  // ------------------------------------------------------------------ reads

  async getView(tenantId: string, findingId: string) {
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const { lifecycle } = await this.ensureLifecycle(client, tenantId, findingId);
      return this.loadView(client, tenantId, lifecycle.id);
    });
  }

  private async loadView(client: Queryable, tenantId: string, lifecycleId: string) {
    const [lc, history, comments, assignments, attachments, tests] = await Promise.all([
      client.query(
        `SELECT l.*, u.email AS assignee_email, u.full_name AS assignee_name
           FROM finding_lifecycles l LEFT JOIN users u ON u.id = l.assignee_id
          WHERE l.id = $1 AND l.organization_id = $2`,
        [lifecycleId, tenantId]
      ),
      client.query(
        `SELECT h.id, h.event, h.from_status, h.to_status, h.reason, h.actor_kind, h.actor_id, h.finding_id,
                h.analysis_id, h.metadata, h.created_at, u.email AS actor_email, u.full_name AS actor_name
           FROM finding_status_history h LEFT JOIN users u ON u.id = h.actor_id
          WHERE h.lifecycle_id = $1 AND h.organization_id = $2
          ORDER BY h.created_at ASC, h.id ASC`,
        [lifecycleId, tenantId]
      ),
      client.query(
        `SELECT c.id, c.body, c.author_id, c.created_at, c.edited_at, c.deleted_at, c.finding_id,
                u.email AS author_email, u.full_name AS author_name,
                (SELECT COUNT(*)::int FROM finding_comment_revisions r WHERE r.comment_id = c.id) AS revision_count
           FROM finding_comments c LEFT JOIN users u ON u.id = c.author_id
          WHERE c.lifecycle_id = $1 AND c.organization_id = $2
          ORDER BY c.created_at ASC, c.id ASC`,
        [lifecycleId, tenantId]
      ),
      client.query(
        `SELECT a.id, a.assignee_id, a.due_date, a.note, a.assigned_by, a.created_at,
                u.email AS assignee_email, u.full_name AS assignee_name, b.email AS assigned_by_email
           FROM finding_assignments a
           LEFT JOIN users u ON u.id = a.assignee_id
           LEFT JOIN users b ON b.id = a.assigned_by
          WHERE a.lifecycle_id = $1 AND a.organization_id = $2
          ORDER BY a.created_at ASC, a.id ASC`,
        [lifecycleId, tenantId]
      ),
      client.query(
        `SELECT t.id, t.file_id, t.file_name, t.checksum_sha256, t.note, t.attached_by, t.created_at,
                uf.quarantine_status, u.email AS attached_by_email
           FROM finding_attachments t
           LEFT JOIN uploaded_files uf ON uf.id = t.file_id
           LEFT JOIN users u ON u.id = t.attached_by
          WHERE t.lifecycle_id = $1 AND t.organization_id = $2 AND t.removed_at IS NULL
          ORDER BY t.created_at ASC`,
        [lifecycleId, tenantId]
      ),
      client.query(
        `SELECT id, title, test_type, expected_outcome, fixture_version, last_run_status, last_run_at, status, created_at
           FROM regression_test_cases
          WHERE lifecycle_id = $1 AND organization_id = $2
          ORDER BY created_at ASC`,
        [lifecycleId, tenantId]
      ),
    ]);
    return {
      lifecycle: mapLifecycleRow(lc.rows[0]),
      history: history.rows.map((h: any) => ({
        id: h.id,
        event: h.event,
        fromStatus: h.from_status,
        toStatus: h.to_status,
        reason: h.reason,
        actorKind: h.actor_kind,
        actor: h.actor_id ? { id: h.actor_id, email: h.actor_email ?? null, fullName: h.actor_name ?? null } : null,
        findingId: h.finding_id,
        analysisId: h.analysis_id,
        metadata: h.metadata ?? {},
        createdAt: iso(h.created_at),
      })),
      comments: comments.rows.map((c: any) => ({
        id: c.id,
        body: c.deleted_at ? null : c.body,
        deleted: Boolean(c.deleted_at),
        author: c.author_id ? { id: c.author_id, email: c.author_email ?? null, fullName: c.author_name ?? null } : null,
        createdAt: iso(c.created_at),
        editedAt: iso(c.edited_at),
        deletedAt: iso(c.deleted_at),
        revisionCount: Number(c.revision_count ?? 0),
      })),
      assignments: assignments.rows.map((a: any) => ({
        id: a.id,
        assignee: a.assignee_id ? { id: a.assignee_id, email: a.assignee_email ?? null, fullName: a.assignee_name ?? null } : null,
        dueDate: dateOnly(a.due_date),
        note: a.note,
        assignedByEmail: a.assigned_by_email ?? null,
        createdAt: iso(a.created_at),
      })),
      attachments: attachments.rows.map((t: any) => ({
        id: t.id,
        fileId: t.file_id,
        fileName: t.file_name,
        checksumSha256: t.checksum_sha256,
        quarantineStatus: t.quarantine_status ?? 'REMOVED',
        note: t.note,
        attachedByEmail: t.attached_by_email ?? null,
        createdAt: iso(t.created_at),
      })),
      regressionTests: tests.rows.map((t: any) => ({
        id: t.id,
        title: t.title,
        testType: t.test_type,
        expectedOutcome: t.expected_outcome,
        fixtureVersion: t.fixture_version,
        lastRunStatus: t.last_run_status,
        lastRunAt: iso(t.last_run_at),
        status: t.status,
        createdAt: iso(t.created_at),
      })),
    };
  }

  // ------------------------------------------------------------------ status

  async transition(tenantId: string, actor: LifecycleActor, findingId: string, dto: TransitionFindingStatusInput) {
    FindingLifecycleService.assertRole(actor, rolesForStatus(dto.status), `Changing a finding to ${dto.status}`);
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const { finding, lifecycle } = await this.ensureLifecycle(client, tenantId, findingId);
      await this.applyTransition(client, tenantId, actor, finding, lifecycle, dto);
      return this.loadView(client, tenantId, lifecycle.id);
    });
  }

  private async applyTransition(
    client: Queryable,
    tenantId: string,
    actor: LifecycleActor,
    finding: any,
    lc: any,
    dto: TransitionFindingStatusInput
  ): Promise<void> {
    if (dto.expectedRevision !== undefined && Number(lc.revision) !== dto.expectedRevision) {
      throw new ConflictException({
        code: 'LIFECYCLE_REVISION_CONFLICT',
        message: 'The finding was changed by someone else. Reload and try again.',
        currentRevision: Number(lc.revision),
      });
    }
    const from = lc.status as FindingStatus;
    if (!isTransitionAllowed(from, dto.status)) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: `A finding in status ${from} cannot move to ${dto.status}.`,
        allowed: FINDING_STATUS_TRANSITIONS[from] ?? [],
      });
    }

    let mode: string | null = null;
    let until: string | null = null;
    let release: string | null = null;
    let objHash: string | null = null;
    if (dto.status === 'SUPPRESSED' && dto.suppression) {
      mode = dto.suppression.mode;
      if (mode === 'UNTIL_DATE') {
        if (!dto.suppression.until || !ISO_DATE.test(dto.suppression.until)) {
          throw new BadRequestException('suppression.until must be a YYYY-MM-DD date');
        }
        until = `${dto.suppression.until}T23:59:59.999Z`;
        if (new Date(until).getTime() <= Date.now()) {
          throw new BadRequestException('suppression.until must be in the future');
        }
      } else if (mode === 'UNTIL_RELEASE') {
        release = dto.suppression.release ?? lc.last_target_release ?? finding.target_release ?? null;
        if (!release) throw new BadRequestException('suppression.release is required (no target release recorded)');
      } else if (mode === 'UNTIL_OBJECT_CHANGE') {
        objHash = lc.last_object_hash ?? finding.object_state_hash;
        if (!objHash) throw new BadRequestException('The object state of this finding is unknown; use another scope');
      }
    }

    await client.query(
      `UPDATE finding_lifecycles SET
         status = $2, status_reason = $3, status_changed_by = $4, status_changed_at = NOW(),
         suppression_mode = $5, suppressed_until = $6, suppressed_release = $7, suppressed_object_hash = $8,
         revision = revision + 1, updated_at = NOW()
       WHERE id = $1`,
      [lc.id, dto.status, dto.reason ?? null, actor.id, mode, until, release, objHash]
    );
    await insertHistory(client, {
      organizationId: tenantId,
      projectId: lc.project_id,
      lifecycleId: lc.id,
      findingId: finding.id,
      event: 'STATUS_CHANGED',
      fromStatus: from,
      toStatus: dto.status,
      reason: dto.reason ?? null,
      actorId: actor.id,
      actorKind: 'USER',
      metadata: mode ? { suppression: { mode, until, release, objectHash: objHash } } : {},
    });
    if (this.outbox) {
      await this.outbox
        .recordEvent(
          tenantId,
          'finding.status_changed',
          'FINDING',
          finding.id,
          { findingId: finding.id, projectId: lc.project_id, lifecycleId: lc.id, from, to: dto.status, changedBy: actor.id },
          client
        )
        .catch((err: any) => this.logger.warn(`finding.status_changed outbox event failed: ${err?.message ?? err}`));
    }
  }

  // ------------------------------------------------------------------ assignment

  private async assertMember(client: Queryable, tenantId: string, userId: string): Promise<void> {
    const res = await client.query(
      `SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
      [tenantId, userId]
    );
    if (res.rows.length === 0) {
      throw new BadRequestException({
        code: 'ASSIGNEE_NOT_MEMBER',
        message: 'The assignee must be a member of this organization.',
      });
    }
  }

  async assign(tenantId: string, actor: LifecycleActor, findingId: string, dto: AssignFindingInput) {
    FindingLifecycleService.assertRole(actor, FINDING_WRITE_ROLES, 'Assigning a finding');
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const { lifecycle } = await this.ensureLifecycle(client, tenantId, findingId);
      await this.applyAssignment(client, tenantId, actor, lifecycle, dto);
      return this.loadView(client, tenantId, lifecycle.id);
    });
  }

  private async applyAssignment(client: Queryable, tenantId: string, actor: LifecycleActor, lc: any, dto: AssignFindingInput) {
    if (dto.assigneeId) await this.assertMember(client, tenantId, dto.assigneeId);
    const dueDate = dto.dueDate === undefined ? dateOnly(lc.due_date) : dto.dueDate;
    await client.query(
      `UPDATE finding_lifecycles SET assignee_id = $2, due_date = $3, revision = revision + 1, updated_at = NOW() WHERE id = $1`,
      [lc.id, dto.assigneeId, dueDate]
    );
    await client.query(
      `INSERT INTO finding_assignments (organization_id, project_id, lifecycle_id, assignee_id, due_date, note, assigned_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, lc.project_id, lc.id, dto.assigneeId, dueDate, dto.note ?? null, actor.id]
    );
    if (this.outbox && dto.assigneeId) {
      // Notification context (P7): the recipient's inbox / e-mail shows what was assigned,
      // by whom, and deep-links to the finding. Self-assignments notify nobody.
      const findingId = lc.latest_finding_id ?? null;
      const ctx = findingId
        ? await client.query(
            `SELECT f.id, f.rule_id, f.title, f.severity, f.engine, p.name AS project_name,
                    (SELECT full_name FROM users WHERE id = $3) AS assigned_by_name,
                    (SELECT email FROM users WHERE id = $3) AS assigned_by_email
               FROM findings f JOIN projects p ON p.id = f.project_id AND p.organization_id = f.organization_id
              WHERE f.id = $1 AND f.organization_id = $2`,
            [findingId, tenantId, actor.id]
          )
        : { rows: [] as any[] };
      const f = ctx.rows[0] ?? {};
      await this.outbox
        .recordEvent(
          tenantId,
          'finding.assigned',
          'FINDING',
          findingId ?? lc.id,
          {
            organizationId: tenantId,
            lifecycleId: lc.id,
            projectId: lc.project_id,
            findingId,
            assigneeId: dto.assigneeId,
            dueDate,
            assignedBy: actor.id,
            assignedByName: f.assigned_by_name || f.assigned_by_email || null,
            ruleId: f.rule_id ?? null,
            title: f.title ? String(f.title).slice(0, 300) : null,
            severity: f.severity ?? null,
            engine: f.engine ?? null,
            projectName: f.project_name ?? null,
            note: dto.note ? String(dto.note).slice(0, 500) : null,
          },
          client
        )
        .catch((err: any) => this.logger.warn(`finding.assigned outbox event failed: ${err?.message ?? err}`));
    }
  }

  // ------------------------------------------------------------------ comments

  async addComment(tenantId: string, actor: LifecycleActor, findingId: string, body: string) {
    FindingLifecycleService.assertRole(actor, FINDING_COMMENT_ROLES, 'Commenting on a finding');
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const { finding, lifecycle } = await this.ensureLifecycle(client, tenantId, findingId);
      const res = await client.query(
        `INSERT INTO finding_comments (organization_id, project_id, lifecycle_id, finding_id, author_id, body)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tenantId, lifecycle.project_id, lifecycle.id, finding.id, actor.id, body]
      );
      return { commentId: res.rows[0].id, ...(await this.loadView(client, tenantId, lifecycle.id)) };
    });
  }

  private async lockComment(client: Queryable, tenantId: string, lifecycleId: string, commentId: string) {
    const res = await client.query(
      `SELECT id, author_id, body, deleted_at FROM finding_comments
        WHERE id = $1 AND lifecycle_id = $2 AND organization_id = $3 FOR UPDATE`,
      [commentId, lifecycleId, tenantId]
    );
    const c = res.rows[0];
    if (!c) throw new NotFoundException('Comment not found');
    if (c.deleted_at) throw new ConflictException({ code: 'COMMENT_DELETED', message: 'The comment was deleted.' });
    return c;
  }

  async editComment(tenantId: string, actor: LifecycleActor, findingId: string, commentId: string, body: string) {
    FindingLifecycleService.assertRole(actor, FINDING_COMMENT_ROLES, 'Editing a comment');
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const { lifecycle } = await this.ensureLifecycle(client, tenantId, findingId);
      const c = await this.lockComment(client, tenantId, lifecycle.id, commentId);
      if (c.author_id !== actor.id) {
        throw new ForbiddenException({ code: 'NOT_COMMENT_AUTHOR', message: 'Only the author can edit a comment.' });
      }
      if (c.body === body) return this.loadView(client, tenantId, lifecycle.id);
      await client.query(
        `INSERT INTO finding_comment_revisions (organization_id, comment_id, body, change_kind, changed_by)
         VALUES ($1, $2, $3, 'EDIT', $4)`,
        [tenantId, c.id, c.body, actor.id]
      );
      await client.query(`UPDATE finding_comments SET body = $2, edited_at = NOW() WHERE id = $1`, [c.id, body]);
      return this.loadView(client, tenantId, lifecycle.id);
    });
  }

  async deleteComment(tenantId: string, actor: LifecycleActor, findingId: string, commentId: string) {
    FindingLifecycleService.assertRole(actor, FINDING_COMMENT_ROLES, 'Deleting a comment');
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const { lifecycle } = await this.ensureLifecycle(client, tenantId, findingId);
      const c = await this.lockComment(client, tenantId, lifecycle.id, commentId);
      const moderator = actor.systemRole === 'SUPER_ADMIN' || ['ORGANIZATION_OWNER', 'SECURITY_ADMIN'].includes(actor.role ?? '');
      if (c.author_id !== actor.id && !moderator) {
        throw new ForbiddenException({ code: 'NOT_COMMENT_AUTHOR', message: 'Only the author or an administrator can delete a comment.' });
      }
      await client.query(
        `INSERT INTO finding_comment_revisions (organization_id, comment_id, body, change_kind, changed_by)
         VALUES ($1, $2, $3, 'DELETE', $4)`,
        [tenantId, c.id, c.body, actor.id]
      );
      await client.query(
        `UPDATE finding_comments SET body = NULL, deleted_at = NOW(), deleted_by = $2 WHERE id = $1`,
        [c.id, actor.id]
      );
      return this.loadView(client, tenantId, lifecycle.id);
    });
  }

  // ------------------------------------------------------------------ attachments

  async attach(tenantId: string, actor: LifecycleActor, findingId: string, dto: AttachArtifactInput) {
    FindingLifecycleService.assertRole(actor, FINDING_WRITE_ROLES, 'Attaching an artifact');
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const { lifecycle } = await this.ensureLifecycle(client, tenantId, findingId);
      const file = await client.query(
        `SELECT id, file_name, checksum_sha256, quarantine_status FROM uploaded_files
          WHERE id = $1 AND organization_id = $2 AND project_id = $3`,
        [dto.fileId, tenantId, lifecycle.project_id]
      );
      const f = file.rows[0];
      if (!f) throw new NotFoundException({ code: 'ARTIFACT_NOT_FOUND', message: 'Artifact not found in this project.' });
      if (f.quarantine_status !== 'CLEAN') {
        throw new BadRequestException({
          code: 'ARTIFACT_NOT_CLEAN',
          message: `Only artifacts that passed the ingestion scan can be attached (status ${f.quarantine_status}).`,
        });
      }
      const dup = await client.query(
        `SELECT 1 FROM finding_attachments WHERE lifecycle_id = $1 AND file_id = $2 AND removed_at IS NULL`,
        [lifecycle.id, f.id]
      );
      if (dup.rows.length) throw new ConflictException({ code: 'ALREADY_ATTACHED', message: 'Artifact is already attached.' });
      const res = await client.query(
        `INSERT INTO finding_attachments (organization_id, project_id, lifecycle_id, file_id, file_name, checksum_sha256, note, attached_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [tenantId, lifecycle.project_id, lifecycle.id, f.id, f.file_name, f.checksum_sha256, dto.note ?? null, actor.id]
      );
      return { attachmentId: res.rows[0].id, ...(await this.loadView(client, tenantId, lifecycle.id)) };
    });
  }

  async detach(tenantId: string, actor: LifecycleActor, findingId: string, attachmentId: string) {
    FindingLifecycleService.assertRole(actor, FINDING_WRITE_ROLES, 'Removing an attachment');
    return this.db.withTenantTransaction(tenantId, async (client) => {
      const { lifecycle } = await this.ensureLifecycle(client, tenantId, findingId);
      const res = await client.query(
        `UPDATE finding_attachments SET removed_at = NOW(), removed_by = $3
          WHERE id = $1 AND lifecycle_id = $2 AND removed_at IS NULL RETURNING id`,
        [attachmentId, lifecycle.id, actor.id]
      );
      if (!res.rows.length) throw new NotFoundException('Attachment not found');
      return this.loadView(client, tenantId, lifecycle.id);
    });
  }

  // ------------------------------------------------------------------ bulk

  async bulk(tenantId: string, actor: LifecycleActor, dto: BulkFindingActionInput) {
    const ids = Array.from(new Set(dto.findingIds));
    if (dto.action === 'ACKNOWLEDGE') {
      FindingLifecycleService.assertRole(actor, rolesForStatus('ACKNOWLEDGED'), 'Acknowledging findings');
    } else {
      FindingLifecycleService.assertRole(actor, FINDING_WRITE_ROLES, 'Assigning findings');
      if (dto.assigneeId) {
        await this.db.withTenantTransaction(tenantId, (client) => this.assertMember(client, tenantId, dto.assigneeId as string));
      }
    }
    const results: Array<{ findingId: string; ok: boolean; status?: string; error?: string }> = [];
    for (const findingId of ids) {
      try {
        const status = await this.db.withTenantTransaction(tenantId, async (client) => {
          const { finding, lifecycle } = await this.ensureLifecycle(client, tenantId, findingId);
          if (dto.action === 'ACKNOWLEDGE') {
            if (lifecycle.status === 'ACKNOWLEDGED') return 'ACKNOWLEDGED';
            await this.applyTransition(client, tenantId, actor, finding, lifecycle, {
              status: 'ACKNOWLEDGED',
              reason: dto.reason || 'Bulk acknowledgement',
            });
            return 'ACKNOWLEDGED';
          }
          await this.applyAssignment(client, tenantId, actor, lifecycle, {
            assigneeId: dto.assigneeId ?? null,
            dueDate: dto.dueDate,
            note: dto.reason,
          });
          return lifecycle.status as string;
        });
        results.push({ findingId, ok: true, status });
      } catch (err: any) {
        const resp = err?.getResponse?.();
        results.push({
          findingId,
          ok: false,
          error: (resp && typeof resp === 'object' && (resp.message || resp.code)) || err?.message || 'failed',
        });
      }
    }
    return {
      action: dto.action,
      requested: ids.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  // ------------------------------------------------------------------ Test Lab hooks

  /** Records test generation on the lifecycle; OPEN/ACKNOWLEDGED move to REGRESSION_TEST_CREATED. */
  async markRegressionTestCreated(
    client: Queryable,
    tenantId: string,
    lifecycle: any,
    findingId: string,
    testCaseId: string,
    actorId: string
  ): Promise<void> {
    const from = lifecycle.status as FindingStatus;
    const moves = from === 'OPEN' || from === 'ACKNOWLEDGED';
    if (moves) {
      await client.query(
        `UPDATE finding_lifecycles SET status = 'REGRESSION_TEST_CREATED', status_reason = $2, status_changed_by = $3,
                status_changed_at = NOW(), revision = revision + 1, updated_at = NOW()
          WHERE id = $1`,
        [lifecycle.id, `Regression test ${testCaseId} generated.`, actorId]
      );
    }
    await insertHistory(client, {
      organizationId: tenantId,
      projectId: lifecycle.project_id,
      lifecycleId: lifecycle.id,
      findingId,
      event: 'REGRESSION_TEST_CREATED',
      fromStatus: from,
      toStatus: moves ? 'REGRESSION_TEST_CREATED' : from,
      reason: `Regression test ${testCaseId} generated from this finding.`,
      actorId,
      actorKind: 'USER',
      metadata: { testCaseId },
    });
  }

  /** A passing FINDING_ABSENT regression run proves the fix: resolve open lifecycles. */
  async markResolvedByTest(
    client: Queryable,
    tenantId: string,
    lifecycleId: string,
    run: { runId: string; testCaseId: string; triggeredBy: string | null; fixtureVersion: number }
  ): Promise<boolean> {
    const res = await client.query(
      `SELECT id, project_id, status, latest_finding_id FROM finding_lifecycles WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [lifecycleId, tenantId]
    );
    const lc = res.rows[0];
    if (!lc || !AUTO_RESOLVABLE_STATUSES.includes(lc.status)) return false;
    await client.query(
      `UPDATE finding_lifecycles SET status = 'RESOLVED', status_reason = $2, status_changed_by = $3,
              status_changed_at = NOW(), revision = revision + 1, updated_at = NOW()
        WHERE id = $1`,
      [lc.id, `Regression test ${run.testCaseId} passed (fixture v${run.fixtureVersion}).`, run.triggeredBy]
    );
    await insertHistory(client, {
      organizationId: tenantId,
      projectId: lc.project_id,
      lifecycleId: lc.id,
      findingId: lc.latest_finding_id,
      event: 'RESOLVED_BY_TEST',
      fromStatus: lc.status,
      toStatus: 'RESOLVED',
      reason: `Regression test passed: the finding is absent in fixture v${run.fixtureVersion}.`,
      actorId: run.triggeredBy,
      actorKind: run.triggeredBy ? 'USER' : 'SYSTEM',
      metadata: { testCaseId: run.testCaseId, runId: run.runId },
    });
    return true;
  }
}
