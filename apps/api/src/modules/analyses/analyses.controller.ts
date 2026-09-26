import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Headers,
  Req,
  Res,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AnalysisListQuerySchema } from '@erppreflight/schemas';
import { AnalysesService, AnalysisSseMessage } from './analyses.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VerifiedEmailGuard } from '../auth/guards/verified-email.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { EntitlementGuard, RequireEntitlement } from '../billing/guards/entitlement.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audited } from '../audit/audited.decorator';
import { Metered } from '../usage/metered.decorator';

/** Serialises one message as a text/event-stream frame. */
export function formatSse(msg: AnalysisSseMessage): string {
  const lines: string[] = [];
  if (msg.id !== undefined) lines.push(`id: ${msg.id}`);
  lines.push(`event: ${msg.type}`);
  lines.push(`data: ${JSON.stringify(msg.data)}`);
  return `${lines.join('\n')}\n\n`;
}

@Controller('analyses')
@UseGuards(JwtAuthGuard, TenancyGuard, EntitlementGuard)
export class AnalysesController {
  constructor(private readonly analysesService: AnalysesService) {}

  @Post()
  @UseGuards(VerifiedEmailGuard)
  @RequireEntitlement('RUN_ANALYSIS')
  @Audited({
    action: 'analysis.queued',
    targetType: 'ANALYSIS',
    targetId: ({ result }) => result?.analysisId,
    payload: ({ body, result }) => ({
      projectId: typeof body?.projectId === 'string' ? body.projectId : null,
      engineTypes: result?.engineTypes ?? [],
      targetRelease: result?.targetRelease ?? null,
      fileCount: Array.isArray(body?.fileIds) ? body.fileIds.length : 0,
      assignmentMode: body?.assignmentMode === 'AUTO' ? 'AUTO' : 'CROSS',
      routingId: typeof body?.routingId === 'string' ? body.routingId : null,
      apiBaselineId: typeof body?.apiBaselineId === 'string' ? body.apiBaselineId : null,
    }),
  })
  @Metered({
    metric: 'ANALYSIS_RUN',
    resourceType: 'ANALYSIS',
    resourceId: ({ result }) => result?.analysisId,
    metadata: ({ result }) => ({ engineTypes: result?.engineTypes ?? [], source: 'api' }),
  })
  async trigger(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() body: unknown
  ) {
    return this.analysesService.triggerAnalysis(tenantId, userId, body);
  }

  @Get()
  async findAll(
    @CurrentTenant() tenantId: string,
    @Query('projectId') projectId?: string,
    @Query('kind') kind?: string
  ) {
    const parsed = AnalysisListQuerySchema.safeParse({ projectId: projectId || undefined, kind: kind || undefined });
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_QUERY', message: parsed.error.issues.map((i) => i.message).join('; ') });
    }
    return this.analysesService.findAll(tenantId, parsed.data.projectId, parsed.data.kind);
  }

  @Get(':id')
  async findById(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string
  ) {
    return this.analysesService.findById(tenantId, id);
  }

  /** Stage progress snapshot — poll fallback for the SSE stream (Part 03 §3.8). */
  @Get(':id/progress')
  async getProgress(
    @CurrentTenant() tenantId: string,
    @Param('id', new ParseUUIDPipe()) id: string
  ) {
    return this.analysesService.getProgress(tenantId, id);
  }

  /**
   * Server-sent progress events. Authenticated with the regular bearer JWT and the
   * tenant header (the web client streams it with fetch, not EventSource, so no
   * token ever appears in a URL). Honours Last-Event-ID for resumption. The tenant
   * check runs before any byte is written, so a foreign or unknown analysis is a
   * plain 404 (not an open stream).
   */
  @Get(':id/events')
  async streamEvents(
    @CurrentTenant() tenantId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    const stream = await this.analysesService.streamProgress(tenantId, id, lastEventId);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'private, no-cache, no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write('retry: 3000\n\n');
    const subscription = stream.subscribe({
      next: (msg) => {
        res.write(formatSse(msg));
      },
      error: () => {
        res.write(formatSse({ type: 'error', data: { message: 'progress stream failed' } }));
        res.end();
      },
      complete: () => res.end(),
    });
    req.on('close', () => subscription.unsubscribe());
  }

  /** Orchestration plan + correlation summary (Full Project Preflight drill-down). */
  @Get(':id/orchestration')
  async getOrchestration(
    @CurrentTenant() tenantId: string,
    @Param('id', new ParseUUIDPipe()) id: string
  ) {
    return this.analysesService.getOrchestration(tenantId, id);
  }

  @Get(':id/findings')
  async getFindingsForAnalysis(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string
  ) {
    return this.analysesService.getFindingsForAnalysis(tenantId, id);
  }
}
