import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { PromoteGeneratedTestRequestSchema } from '@erppreflight/schemas';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { Audited } from '../audit/audited.decorator';
import { zodParse } from '../knowledge-graph/zod-parse';
import { LifecycleActor } from '../findings/lifecycle/finding-lifecycle.service';
import { GeneratedTestsService } from './generated-tests.service';

const ListQuery = z
  .object({
    projectId: z.string().uuid().optional(),
    analysisId: z.string().uuid().optional(),
  })
  .strict();

function actorOf(req: any): LifecycleActor {
  return { id: req.user?.id, role: req.tenantRole ?? req.user?.role ?? null, systemRole: req.user?.systemRole ?? null };
}

/** Generated tests (analysis GENERATING_TESTS stage) and their promotion into the Test Lab. */
@Controller('lab/generated-tests')
@UseGuards(JwtAuthGuard, TenancyGuard)
export class GeneratedTestsController {
  constructor(private readonly generated: GeneratedTestsService) {}

  @Get()
  async list(@CurrentTenant() tenantId: string, @Query() query: unknown) {
    const q = zodParse(ListQuery, query);
    if (!q.projectId && !q.analysisId) {
      throw new BadRequestException({ code: 'INVALID_QUERY', message: 'projectId or analysisId is required' });
    }
    return this.generated.list(tenantId, q);
  }

  @Get(':id')
  async get(@CurrentTenant() tenantId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.generated.get(tenantId, id);
  }

  @Post(':id/promote')
  @HttpCode(200)
  @Audited({
    action: 'lab.generated_test_promoted',
    targetType: 'REGRESSION_TEST',
    targetId: ({ result }) => result?.regressionTestCaseId,
    payload: ({ params, result }) => ({ generatedTestId: params.id, created: result?.created ?? null }),
  })
  async promote(
    @CurrentTenant() tenantId: string,
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown
  ) {
    return this.generated.promote(tenantId, actorOf(req), id, zodParse(PromoteGeneratedTestRequestSchema, body ?? {}));
  }
}
