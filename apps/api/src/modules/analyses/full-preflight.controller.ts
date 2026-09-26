import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { FullPreflightRequestSchema } from '@erppreflight/schemas';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VerifiedEmailGuard } from '../auth/guards/verified-email.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { EntitlementGuard, RequireEntitlement } from '../billing/guards/entitlement.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audited } from '../audit/audited.decorator';
import { Metered } from '../usage/metered.decorator';
import { JobsService } from '../jobs/jobs.service';
import { AnalysesService } from './analyses.service';

/** Full Project Preflight (Part 01 §1.6, Part 05 §5.6). */
@Controller('projects/:id/full-preflight')
@UseGuards(JwtAuthGuard, TenancyGuard, EntitlementGuard)
export class FullPreflightController {
  constructor(
    private readonly jobs: JobsService,
    private readonly analyses: AnalysesService
  ) {}

  @Post()
  @HttpCode(202)
  @UseGuards(VerifiedEmailGuard)
  @RequireEntitlement('RUN_ANALYSIS')
  @Audited({
    action: 'analysis.full_preflight_queued',
    targetType: 'ANALYSIS',
    targetId: ({ result }) => result?.analysisId,
    payload: ({ params, result }) => ({
      projectId: params.id,
      engineTypes: result?.engineTypes ?? [],
      targetRelease: result?.targetRelease ?? null,
      assignments: result?.plan?.assignments?.length ?? 0,
      stages: result?.plan?.stages?.length ?? 0,
    }),
  })
  @Metered({
    metric: 'ANALYSIS_RUN',
    resourceType: 'ANALYSIS',
    resourceId: ({ result }) => result?.analysisId,
    metadata: ({ result }) => ({ engineTypes: result?.engineTypes ?? [], source: 'full_preflight' }),
  })
  async start(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe()) projectId: string,
    @Body() body: unknown
  ) {
    const parsed = FullPreflightRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_FULL_PREFLIGHT_REQUEST',
        message: 'Invalid full preflight request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return this.jobs.startFullPreflight(tenantId, userId, projectId, parsed.data);
  }

  @Get('latest')
  async latest(@CurrentTenant() tenantId: string, @Param('id', new ParseUUIDPipe()) projectId: string) {
    return this.analyses.latestFullPreflight(tenantId, projectId);
  }
}
