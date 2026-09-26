import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../admin/guards/super-admin.guard';
import { DenyApiKeyAuth } from '../api-keys/api-key-scopes';
import { Audited } from '../audit/audited.decorator';
import { zodParse } from '../knowledge-graph/zod-parse';
import { RuleGovernanceService, type Actor } from './rule-governance.service';
import { RuleCodeSchema, RuleListQuerySchema, RuleTransitionSchema, UpdateRuleGovernanceSchema } from './rule-governance.types';

function actorOf(req: any): Actor {
  return { id: req.user?.id ?? null, email: req.user?.email ?? null };
}

/** Rule Admin (spec 10.10): SUPER_ADMIN only; every mutation is audited. */
@ApiTags('Admin Rule Governance')
@ApiBearerAuth()
@DenyApiKeyAuth()
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('admin/rules')
export class RuleGovernanceController {
  constructor(private readonly governance: RuleGovernanceService) {}

  @Get()
  @ApiOperation({ summary: 'Rule inventory of all engines with governance state, golden coverage and latest self-test' })
  list(@Query() query: unknown) {
    return this.governance.list(zodParse(RuleListQuerySchema, query));
  }

  @Get(':code')
  @ApiOperation({ summary: 'Rule detail: governance state, publish gate, self-test runs and history' })
  detail(@Param('code') code: string) {
    return this.governance.detail(zodParse(RuleCodeSchema, code));
  }

  @Post(':code/self-test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run the deterministic golden self-test of a rule and record the verdict' })
  @Audited({
    action: 'rule.self_test_run',
    targetType: 'RULE',
    targetId: ({ params }) => params.code,
    payload: ({ result }) => ({
      status: result?.status ?? null,
      ruleVersion: result?.ruleVersion ?? null,
      resultDigest: result?.resultDigest ?? null,
    }),
  })
  selfTest(@Param('code') code: string, @Req() req: any) {
    return this.governance.runSelfTest(zodParse(RuleCodeSchema, code), actorOf(req));
  }

  @Patch(':code')
  @ApiOperation({ summary: 'Set author, reviewer or notes of a rule' })
  @Audited({
    action: 'rule.governance_updated',
    targetType: 'RULE',
    targetId: ({ params }) => params.code,
    payload: ({ body }) => ({ fields: Object.keys(body ?? {}).sort() }),
  })
  update(@Param('code') code: string, @Body() body: unknown, @Req() req: any) {
    return this.governance.update(zodParse(RuleCodeSchema, code), zodParse(UpdateRuleGovernanceSchema, body), actorOf(req));
  }

  @Post(':code/transition')
  @HttpCode(200)
  @ApiOperation({ summary: 'DRAFT -> IN_REVIEW -> PUBLISHED -> DEPRECATED (publish requires a passing self-test)' })
  @Audited({
    action: ({ body }) => (body?.to === 'PUBLISHED' ? 'rule.published' : 'rule.status_changed'),
    targetType: 'RULE',
    targetId: ({ params }) => params.code,
    payload: ({ body, result }) => ({ to: body?.to ?? null, version: result?.version ?? null }),
    failureAction: 'rule.transition_rejected',
    security: true,
  })
  transition(@Param('code') code: string, @Body() body: unknown, @Req() req: any) {
    return this.governance.transition(zodParse(RuleCodeSchema, code), zodParse(RuleTransitionSchema, body), actorOf(req));
  }
}
