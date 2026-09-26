import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ANALYSIS_CONTROL_ROLES, CancelAnalysisRequestSchema, RerunAnalysisRequestSchema, type Role } from '@erppreflight/schemas';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VerifiedEmailGuard } from '../auth/guards/verified-email.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { EntitlementGuard, RequireEntitlement } from '../billing/guards/entitlement.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audited } from '../audit/audited.decorator';
import { Metered } from '../usage/metered.decorator';
import { zodParse } from '../knowledge-graph/zod-parse';
import { AnalysisLifecycleService, type LifecycleCaller } from './analysis-lifecycle.service';

/** API keys may also cancel / re-run (they can create analyses); VIEWER and AUDITOR may not. */
const CONTROL_ROLES = [...ANALYSIS_CONTROL_ROLES, 'API_CLIENT'] as unknown as Role[];

function callerOf(req: any): LifecycleCaller {
  return { id: req.user?.id, role: req.tenantRole ?? req.user?.role ?? null, systemRole: req.user?.systemRole ?? null };
}

/**
 * Analysis run lifecycle (section C §15/§16): detail view, cancel and rerun.
 * Route guards: JWT + tenant membership (foreign runs are 404), role (cancel/rerun not for
 * VIEWER/AUDITOR), verified e-mail + RUN_ANALYSIS plan limit for reruns, audit hash chain.
 */
@Controller('analyses')
@UseGuards(JwtAuthGuard, TenancyGuard, EntitlementGuard)
export class AnalysisLifecycleController {
  constructor(private readonly lifecycle: AnalysisLifecycleService) {}

  /** Everything the analysis detail page shows (inputs, snapshot, timing, calls, lineage, lab results). */
  @Get(':id/detail')
  async detail(@CurrentTenant() tenantId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.lifecycle.detail(tenantId, callerOf(req), id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles(...CONTROL_ROLES)
  @Audited({
    action: 'analysis.cancel_requested',
    targetType: 'ANALYSIS',
    targetId: ({ params }) => params.id,
    payload: ({ body, result }) => ({
      outcome: result?.outcome ?? null,
      status: result?.status ?? null,
      reasonGiven: typeof body?.reason === 'string' && body.reason.trim().length > 0,
    }),
  })
  async cancel(
    @CurrentTenant() tenantId: string,
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown
  ) {
    return this.lifecycle.cancel(tenantId, callerOf(req), id, zodParse(CancelAnalysisRequestSchema, body ?? {}));
  }

  @Post(':id/rerun')
  @HttpCode(202)
  @UseGuards(RolesGuard, VerifiedEmailGuard)
  @Roles(...CONTROL_ROLES)
  @RequireEntitlement('RUN_ANALYSIS')
  @Audited({
    action: 'analysis.rerun_queued',
    targetType: 'ANALYSIS',
    targetId: ({ result }) => result?.analysisId,
    payload: ({ params, result }) => ({
      rerunOf: params.id,
      kind: result?.kind ?? null,
      engineTypes: result?.engineTypes ?? [],
      knowledgeSnapshotId: result?.knowledgeSnapshotId ?? null,
      previousKnowledgeSnapshotId: result?.previousKnowledgeSnapshotId ?? null,
    }),
  })
  @Metered({
    metric: 'ANALYSIS_RUN',
    resourceType: 'ANALYSIS',
    resourceId: ({ result }) => result?.analysisId,
    // Test Lab reruns meter engine executions per test (like any lab run), not an analysis run.
    quantity: ({ result }) => (typeof result?.kind === 'string' && result.kind.startsWith('LAB_') ? 0 : 1),
    metadata: ({ result }) => ({ engineTypes: result?.engineTypes ?? [], source: 'rerun', rerunOf: result?.rerunOfAnalysisId ?? null }),
  })
  async rerun(
    @CurrentTenant() tenantId: string,
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown
  ) {
    zodParse(RerunAnalysisRequestSchema, body ?? {});
    return this.lifecycle.rerun(tenantId, callerOf(req), id);
  }
}
