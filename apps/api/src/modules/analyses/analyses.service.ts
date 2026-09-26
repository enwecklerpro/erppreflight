import { Injectable, NotFoundException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { DatabaseService } from '../database/database.service';
import { JobsService } from '../jobs/jobs.service';
import { EVIDENCE_JSON_AGG_SQL, mapEvidenceList } from '../findings/evidence.mapper';
import { parseProgressState } from '../jobs/analysis-progress';

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'PARTIAL', 'CANCELLED']);

/** Server-sent event as consumed by NestJS @Sse (data is JSON-serialised by Nest). */
export interface AnalysisSseMessage {
  id?: string;
  type: string;
  data: unknown;
  retry?: number;
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toJson(v: unknown): any {
  if (typeof v !== 'string') return v ?? {};
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
}

@Injectable()
export class AnalysesService {
  /** SSE poll interval against analysis_progress_events (works across API replicas). */
  static SSE_POLL_MS = 1000;
  /** Hard cap for one SSE connection; the client reconnects with Last-Event-ID. */
  static SSE_MAX_DURATION_MS = 10 * 60 * 1000;

  constructor(
    private readonly db: DatabaseService,
    private readonly jobsService: JobsService
  ) {}

  /** Payload is runtime-validated (Zod, strict) by JobsService.triggerAnalysis. */
  async triggerAnalysis(tenantId: string, userId: string, body: unknown) {
    return this.jobsService.triggerAnalysis(tenantId, userId, body);
  }

  private mapRow(row: any) {
    const progress = parseProgressState(row.progress);
    return {
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      status: row.status,
      isBaseline: Boolean(row.is_baseline),
      engineTypes: row.engine_types || [],
      targetRelease: row.target_release,
      triggeredBy: row.triggered_by,
      findingsCount: row.findings_count || 0,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      kind: row.kind ?? 'STANDARD',
      currentStage: row.current_stage ?? null,
      // A cancelled run keeps the percentage it reached (it did not finish).
      progressPercent: TERMINAL_STATUSES.has(row.status) && row.status !== 'CANCELLED' ? 100 : progress.percent,
      problemStatement: row.problem_statement ?? null,
      routingId: row.routing_id ?? null,
      // Run lifecycle (migration 020): timing, cancellation, rerun link, error, knowledge snapshot.
      startedAt: row.started_at ?? null,
      cancelRequestedAt: row.cancel_requested_at ?? null,
      cancelledAt: row.cancelled_at ?? null,
      rerunOfAnalysisId: row.rerun_of_analysis_id ?? null,
      errorMessage: row.error_message ?? null,
      knowledgeSnapshotId: row.knowledge_snapshot_id ?? null,
    };
  }

  async findAll(tenantId: string, projectId?: string, kind?: string) {
    const conditions = ['organization_id = $1'];
    const params: unknown[] = [tenantId];
    if (projectId) {
      params.push(projectId);
      conditions.push(`project_id = $${params.length}`);
    }
    if (kind) {
      params.push(kind);
      conditions.push(`kind = $${params.length}`);
    }
    const where = conditions.join(' AND ');

    const res = await this.db.query(
      `SELECT a.*,
              (SELECT COUNT(*)::int FROM findings f WHERE f.analysis_id = a.id) AS findings_count
       FROM analyses a
       WHERE ${where}
       ORDER BY a.created_at DESC`,
      params
    );

    return res.rows.map((row) => this.mapRow(row));
  }

  private async getRow(tenantId: string, analysisId: string) {
    const res = await this.db.query(
      `SELECT a.*,
              (SELECT COUNT(*)::int FROM findings f WHERE f.analysis_id = a.id) AS findings_count
       FROM analyses a
       WHERE a.organization_id = $1 AND a.id = $2`,
      [tenantId, analysisId]
    );

    if (res.rows.length === 0) {
      throw new NotFoundException(`Analysis run '${analysisId}' not found.`);
    }
    return res.rows[0];
  }

  async findById(tenantId: string, analysisId: string) {
    return this.mapRow(await this.getRow(tenantId, analysisId));
  }

  /** Poll fallback for the progress stepper (Part 03 §3.8). */
  async getProgress(tenantId: string, analysisId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(analysisId)) {
      throw new NotFoundException(`Analysis run '${analysisId}' not found.`);
    }
    const res = await this.db.query(
      `SELECT id, status, kind, progress, current_stage FROM analyses WHERE organization_id = $1 AND id = $2`,
      [tenantId, analysisId],
      { tenantId }
    );
    if (!res.rows?.length) {
      throw new NotFoundException(`Analysis run '${analysisId}' not found.`);
    }
    const row = res.rows[0];
    const state = parseProgressState(row.progress);
    const terminal = TERMINAL_STATUSES.has(row.status);
    return {
      analysisId: row.id,
      status: row.status,
      kind: row.kind ?? 'STANDARD',
      currentStage: state.currentStage ?? row.current_stage ?? null,
      percent: terminal && row.status !== 'CANCELLED' ? 100 : state.percent,
      stages: state.stages,
      updatedAt: state.updatedAt,
      terminal,
    };
  }

  async listProgressEvents(tenantId: string, analysisId: string, afterId = 0) {
    const res = await this.db.query(
      `SELECT id, analysis_id, stage, status, detail, created_at
         FROM analysis_progress_events
        WHERE organization_id = $1 AND analysis_id = $2 AND id > $3
        ORDER BY id ASC
        LIMIT 200`,
      [tenantId, analysisId, afterId],
      { tenantId }
    );
    return (res.rows ?? []).map((r: any) => ({
      id: Number(r.id),
      analysisId: r.analysis_id,
      stage: r.stage,
      status: r.status,
      detail: toJson(r.detail),
      createdAt: toIso(r.created_at) ?? '',
    }));
  }

  /**
   * SSE stream of progress events (GET /analyses/:id/events). Tenant access is
   * checked before the stream opens; events are read from the tenant-scoped
   * analysis_progress_events table, so every API replica can serve any stream.
   * Emits `stage` events, a `snapshot` after each batch, and `end` at a terminal status.
   */
  async streamProgress(tenantId: string, analysisId: string, lastEventId?: string): Promise<Observable<AnalysisSseMessage>> {
    await this.getProgress(tenantId, analysisId); // 404 for foreign / unknown ids
    let cursor = Number.parseInt(lastEventId ?? '0', 10);
    if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;

    return new Observable<AnalysisSseMessage>((subscriber) => {
      let closed = false;
      let timer: NodeJS.Timeout | null = null;
      const started = Date.now();

      const tick = async () => {
        if (closed) return;
        try {
          const events = await this.listProgressEvents(tenantId, analysisId, cursor);
          for (const ev of events) {
            cursor = ev.id;
            subscriber.next({ id: String(ev.id), type: 'stage', data: ev, retry: 3000 });
          }
          const snapshot = await this.getProgress(tenantId, analysisId);
          if (events.length > 0 || cursor === 0) {
            subscriber.next({ id: String(cursor), type: 'snapshot', data: snapshot });
          }
          if (snapshot.terminal && events.length === 0) {
            subscriber.next({ id: String(cursor), type: 'end', data: { status: snapshot.status } });
            subscriber.complete();
            closed = true;
            return;
          }
          if (Date.now() - started > AnalysesService.SSE_MAX_DURATION_MS) {
            subscriber.next({ id: String(cursor), type: 'reconnect', data: { lastEventId: cursor } });
            subscriber.complete();
            closed = true;
            return;
          }
          if (events.length === 0) {
            subscriber.next({ id: String(cursor), type: 'heartbeat', data: { at: new Date().toISOString() } });
          }
        } catch (err: any) {
          subscriber.error(err);
          closed = true;
          return;
        }
        timer = setTimeout(tick, AnalysesService.SSE_POLL_MS);
      };
      void tick();
      return () => {
        closed = true;
        if (timer) clearTimeout(timer);
      };
    });
  }

  /** Orchestration plan + correlation summary of an analysis (Full Project Preflight drill-down). */
  async getOrchestration(tenantId: string, analysisId: string) {
    const row = await this.getRow(tenantId, analysisId);
    const orchestration = toJson(row.orchestration) ?? {};
    return {
      analysis: this.mapRow(row),
      plan: orchestration.plan ?? null,
      summary: orchestration.summary ?? null,
      calls: Array.isArray(orchestration.calls) ? orchestration.calls : [],
      /** API_CHANGE_GUARD: stored baseline the run compared against (id, name, version, sha256, selection). */
      apiBaseline: orchestration.apiBaseline ?? null,
    };
  }

  /** Latest Full Project Preflight of a project (404 when none has been run). */
  async latestFullPreflight(tenantId: string, projectId: string) {
    const res = await this.db.query(
      `SELECT id FROM analyses WHERE organization_id = $1 AND project_id = $2 AND kind = 'FULL_PREFLIGHT'
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId, projectId],
      { tenantId }
    );
    if (!res.rows?.length) {
      throw new NotFoundException({ code: 'NO_FULL_PREFLIGHT', message: 'No Full Project Preflight has been run for this project yet.' });
    }
    return this.getOrchestration(tenantId, res.rows[0].id);
  }

  async getFindingsForAnalysis(tenantId: string, analysisId: string) {
    // Verify analysis exists for tenant
    await this.findById(tenantId, analysisId);

    const res = await this.db.query(
      `SELECT f.*,
              ${EVIDENCE_JSON_AGG_SQL} AS evidence
       FROM findings f
       WHERE f.organization_id = $1 AND f.analysis_id = $2
       ORDER BY
         CASE f.severity
           WHEN 'BLOCKER' THEN 1
           WHEN 'CRITICAL' THEN 2
           WHEN 'MAJOR' THEN 3
           WHEN 'MEDIUM' THEN 4
           WHEN 'MINOR' THEN 5
           ELSE 6
         END,
         f.created_at DESC`,
      [tenantId, analysisId]
    );

    return res.rows.map((row) => ({
      id: row.id,
      jobId: row.analysis_id,
      analysisId: row.analysis_id,
      projectId: row.project_id,
      organizationId: row.organization_id,
      engineType: row.engine,
      ruleId: row.rule_id,
      severity: row.severity,
      category: row.category,
      title: row.title,
      description: row.description,
      confidence: row.confidence_class,
      confidenceScore: Number(row.confidence_score),
      remediation: row.remediation,
      affectedObjects: row.affected_objects || [],
      technicalDetails: row.technical_details || {},
      fingerprint: row.fingerprint,
      createdAt: row.created_at,
      evidence: mapEvidenceList(row.evidence),
    }));
  }
}
