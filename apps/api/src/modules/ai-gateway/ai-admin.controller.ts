import { Body, Controller, Delete, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../admin/guards/super-admin.guard';
import { DenyApiKeyAuth } from '../api-keys/api-key-scopes';
import { Audited } from '../audit/audited.decorator';
import { zodParse } from '../knowledge-graph/zod-parse';
import { AiGovernanceService } from './ai-governance.service';
import { AiProviderControlSchema, AiTaskConfigSchema } from './ai-governance.types';

/**
 * AI Admin (spec 10.11): per-task model configuration, provider kill switches and the
 * monthly spend per task. SUPER_ADMIN only; every change is audited. The gateway reads
 * this configuration on every call, so changes apply to the next request on all instances.
 */
@ApiTags('Admin AI Governance')
@ApiBearerAuth()
@DenyApiKeyAuth()
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('admin/ai')
export class AiAdminController {
  constructor(private readonly governance: AiGovernanceService) {}

  @Get()
  @ApiOperation({ summary: 'AI tasks with effective configuration, current-month spend and provider controls' })
  overview() {
    return this.governance.overview();
  }

  @Put('tasks/:task')
  @ApiOperation({ summary: 'Configure one AI task (provider, models, fallback, max tokens, temperature, privacy mode, cost ceiling)' })
  @Audited({
    action: 'ai.task_config_updated',
    targetType: 'AI_TASK',
    targetId: ({ params }) => params.task,
    payload: ({ body }) => ({
      enabled: body?.enabled ?? null,
      provider: body?.provider ?? null,
      fallbackProvider: body?.fallbackProvider ?? null,
      privacyMode: body?.privacyMode ?? null,
      costCeilingEurMonthly: body?.costCeilingEurMonthly ?? null,
      maxTokens: body?.maxTokens ?? null,
    }),
    security: true,
  })
  upsertTask(@Param('task') task: string, @Body() body: unknown, @Req() req: any) {
    return this.governance.upsertTask(task, zodParse(AiTaskConfigSchema, body), req.user?.id ?? null);
  }

  @Delete('tasks/:task')
  @ApiOperation({ summary: 'Remove the task override (platform defaults apply again)' })
  @Audited({ action: 'ai.task_config_reset', targetType: 'AI_TASK', targetId: ({ params }) => params.task, security: true })
  resetTask(@Param('task') task: string) {
    return this.governance.resetTask(task);
  }

  @Put('providers/:provider')
  @ApiOperation({ summary: 'Global kill switch (and self-hosted endpoint) of one AI provider' })
  @Audited({
    action: ({ body }) => (body?.killSwitch ? 'ai.provider_kill_switch_activated' : 'ai.provider_kill_switch_released'),
    targetType: 'AI_PROVIDER',
    targetId: ({ params }) => params.provider,
    payload: ({ body }) => ({
      killSwitch: body?.killSwitch ?? null,
      reason: typeof body?.reason === 'string' ? body.reason.slice(0, 200) : null,
      endpointChanged: body?.endpointUrl !== undefined,
    }),
    security: true,
  })
  setProvider(@Param('provider') provider: string, @Body() body: unknown, @Req() req: any) {
    return this.governance.setProviderControl(provider, zodParse(AiProviderControlSchema, body), req.user?.id ?? null);
  }
}
