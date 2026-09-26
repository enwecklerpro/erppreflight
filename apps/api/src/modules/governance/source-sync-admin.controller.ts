import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../admin/guards/super-admin.guard';
import { DenyApiKeyAuth } from '../api-keys/api-key-scopes';
import { Audited } from '../audit/audited.decorator';
import { zodParse } from '../knowledge-graph/zod-parse';
import { SourceSyncAdminService } from './source-sync-admin.service';
import { AdapterIdSchema, SourceSettingsSchema } from './source-sync.types';

/** Source Sync Admin (spec 10.12): SUPER_ADMIN only; retries and settings changes are audited. */
@ApiTags('Admin Knowledge Sources')
@ApiBearerAuth()
@DenyApiKeyAuth()
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('admin/sources')
export class SourceSyncAdminController {
  constructor(private readonly sources: SourceSyncAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Knowledge source adapters: last sync, freshness, errors, item counts, changed records, alerts' })
  overview() {
    return this.sources.overview();
  }

  @Get(':adapterId/runs')
  @ApiOperation({ summary: 'Sync run history of one adapter' })
  runs(@Param('adapterId') adapterId: string) {
    return this.sources.runs(zodParse(AdapterIdSchema, adapterId));
  }

  @Put(':adapterId/settings')
  @ApiOperation({ summary: 'Critical flag, freshness threshold and alerting of one adapter' })
  @Audited({
    action: 'knowledge_source.settings_updated',
    targetType: 'KNOWLEDGE_SOURCE',
    targetId: ({ params }) => params.adapterId,
    payload: ({ body }) => ({
      critical: body?.critical ?? null,
      freshnessThresholdHours: body?.freshnessThresholdHours ?? null,
      alertsEnabled: body?.alertsEnabled ?? null,
    }),
  })
  settings(@Param('adapterId') adapterId: string, @Body() body: unknown, @Req() req: any) {
    return this.sources.updateSettings(zodParse(AdapterIdSchema, adapterId), zodParse(SourceSettingsSchema, body), req.user?.id ?? null);
  }

  @Post(':adapterId/retry')
  @HttpCode(202)
  @ApiOperation({ summary: 'Re-run a source adapter sync (knowledge-sync queue)' })
  @Audited({
    action: 'knowledge_source.sync_retried',
    targetType: 'KNOWLEDGE_SOURCE',
    targetId: ({ params }) => params.adapterId,
    payload: ({ result }) => ({ jobId: result?.jobId ?? null }),
  })
  retry(@Param('adapterId') adapterId: string, @Req() req: any) {
    return this.sources.retry(zodParse(AdapterIdSchema, adapterId), String(req.user?.email ?? req.user?.id ?? 'admin'));
  }

  @Post('freshness-check')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run the stale-source check now (also scheduled hourly)' })
  @Audited({
    action: 'knowledge_source.freshness_checked',
    targetType: 'KNOWLEDGE_SOURCE',
    payload: ({ result }) => ({ opened: result?.opened?.length ?? 0, resolved: result?.resolved?.length ?? 0 }),
  })
  check() {
    return this.sources.checkFreshness();
  }
}
