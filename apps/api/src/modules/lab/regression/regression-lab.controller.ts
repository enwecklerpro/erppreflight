import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  BatchRunRegressionTestsSchema,
  GenerateRegressionTestSchema,
  RunRegressionTestSchema,
  ScheduleRegressionTestsSchema,
  UpdateRegressionFixtureSchema,
} from '@erppreflight/schemas';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../../tenancy/tenancy.guard';
import { CurrentTenant } from '../../../common/decorators/current-tenant.decorator';
import { Audited } from '../../audit/audited.decorator';
import { zodParse } from '../../knowledge-graph/zod-parse';
import { LifecycleActor } from '../../findings/lifecycle/finding-lifecycle.service';
import { RegressionLabService } from './regression-lab.service';

const ProjectQuery = z.object({ projectId: z.string().uuid() });

function actorOf(req: any): LifecycleActor {
  return { id: req.user?.id, role: req.tenantRole ?? req.user?.role ?? null, systemRole: req.user?.systemRole ?? null };
}

/** Regression Test Lab API (Part 05 §5.5, Section C §18). */
@Controller('lab')
@UseGuards(JwtAuthGuard, TenancyGuard)
export class RegressionLabController {
  constructor(private readonly lab: RegressionLabService) {}

  @Get('regression-tests')
  async list(@CurrentTenant() tenantId: string, @Query() query: unknown) {
    return this.lab.list(tenantId, zodParse(ProjectQuery, query).projectId);
  }

  @Post('regression-tests')
  @Audited({
    action: 'lab.regression_test_created',
    targetType: 'REGRESSION_TEST',
    targetId: ({ result }) => result?.id,
    payload: ({ body, result }) => ({
      findingId: body?.findingId ?? null,
      expectedOutcome: result?.expectedOutcome ?? null,
      engine: result?.engine ?? null,
      ruleId: result?.ruleId ?? null,
    }),
  })
  async generate(@CurrentTenant() tenantId: string, @Req() req: any, @Body() body: unknown) {
    return this.lab.generateFromFinding(tenantId, actorOf(req), zodParse(GenerateRegressionTestSchema, body));
  }

  @Post('regression-tests/batch-run')
  @Audited({
    action: 'lab.regression_batch_run',
    targetType: 'PROJECT',
    targetId: ({ body }) => body?.projectId,
    payload: ({ result }) => ({
      batchId: result?.batchId ?? null,
      total: result?.total ?? null,
      passed: result?.passed ?? null,
      failed: result?.failed ?? null,
      errored: result?.errored ?? null,
      analysisId: result?.analysisId ?? null,
    }),
  })
  async batchRun(@CurrentTenant() tenantId: string, @Req() req: any, @Body() body: unknown) {
    return this.lab.batchRun(tenantId, actorOf(req), zodParse(BatchRunRegressionTestsSchema, body));
  }

  @Get('regression-tests/:id')
  async get(@CurrentTenant() tenantId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.lab.get(tenantId, id);
  }

  @Post('regression-tests/:id/run')
  @Audited({
    action: 'lab.regression_test_run',
    targetType: 'REGRESSION_TEST',
    targetId: ({ params }) => params.id,
    payload: ({ result }) => ({
      runId: result?.id ?? null,
      status: result?.status ?? null,
      findingResolved: result?.findingResolved ?? false,
      analysisId: result?.analysisId ?? null,
    }),
  })
  async run(
    @CurrentTenant() tenantId: string,
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown
  ) {
    return this.lab.run(tenantId, actorOf(req), id, zodParse(RunRegressionTestSchema, body));
  }

  @Post('regression-tests/:id/fixture')
  @Audited({
    action: 'lab.regression_fixture_updated',
    targetType: 'REGRESSION_TEST',
    targetId: ({ params }) => params.id,
    payload: ({ body, result }) => ({ fileId: body?.fileId ?? null, fixtureVersion: result?.fixtureVersion ?? null }),
  })
  async updateFixture(
    @CurrentTenant() tenantId: string,
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown
  ) {
    return this.lab.updateFixture(tenantId, actorOf(req), id, zodParse(UpdateRegressionFixtureSchema, body));
  }

  @Post('regression-tests/:id/archive')
  @Audited({ action: 'lab.regression_test_archived', targetType: 'REGRESSION_TEST', targetId: ({ params }) => params.id })
  async archive(@CurrentTenant() tenantId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.lab.archive(tenantId, actorOf(req), id);
  }

  /** Machine-readable fixture export (erppreflight.regression-fixture/v1). */
  @Get('regression-tests/:id/fixture')
  async exportFixture(
    @CurrentTenant() tenantId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: any
  ) {
    const fixture = await this.lab.exportFixture(tenantId, id);
    const header = (name: string, value: string) =>
      typeof res?.header === 'function' ? res.header(name, value) : res?.setHeader?.(name, value);
    header('Content-Disposition', `attachment; filename="regression-fixture-${id}.json"`);
    return fixture;
  }

  @Get('regression-schedules')
  async listSchedules(@CurrentTenant() tenantId: string, @Query() query: unknown) {
    return this.lab.listSchedules(tenantId, zodParse(ProjectQuery, query).projectId);
  }

  @Post('regression-schedules')
  @Audited({
    action: 'lab.regression_schedule_created',
    targetType: 'PROJECT',
    targetId: ({ body }) => body?.projectId,
    payload: ({ result }) => ({ scheduleId: result?.id ?? null, cron: result?.cronExpression ?? null }),
  })
  async createSchedule(@CurrentTenant() tenantId: string, @Req() req: any, @Body() body: unknown) {
    return this.lab.createSchedule(tenantId, actorOf(req), zodParse(ScheduleRegressionTestsSchema, body));
  }

  @Delete('regression-schedules/:id')
  @Audited({ action: 'lab.regression_schedule_cancelled', targetType: 'REGRESSION_SCHEDULE', targetId: ({ params }) => params.id })
  async cancelSchedule(@CurrentTenant() tenantId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.lab.cancelSchedule(tenantId, actorOf(req), id);
  }
}
