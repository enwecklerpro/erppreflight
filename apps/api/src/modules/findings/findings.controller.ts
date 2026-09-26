import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  AssignFindingSchema,
  AttachArtifactSchema,
  BulkFindingActionSchema,
  FindingCommentBodySchema,
  SuppressionInputSchema,
  TransitionFindingStatusSchema,
  TransitionFindingStatusInput,
} from '@erppreflight/schemas';
import { z } from 'zod';
import { FindingsService, FindFindingsRequest } from './findings.service';
import { FindingLifecycleService, LifecycleActor } from './lifecycle/finding-lifecycle.service';
import { LEGACY_REVIEW_STATUS_MAP } from './lifecycle/legacy-review-import.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audited } from '../audit/audited.decorator';
import { zodParse } from '../knowledge-graph/zod-parse';

function actorOf(req: any): LifecycleActor {
  return { id: req.user?.id, role: req.tenantRole ?? req.user?.role ?? null, systemRole: req.user?.systemRole ?? null };
}

const ReasonOnlySchema = z.object({ reason: z.string().trim().max(2000).optional(), expectedRevision: z.number().int().positive().optional() }).strict();
const SuppressBodySchema = z
  .object({
    reason: z.string().trim().max(2000).optional(),
    suppression: SuppressionInputSchema,
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();

/** Legacy review contract (pre-lifecycle UI / API clients), mapped onto lifecycle transitions. */
const LegacyReviewSchema = z
  .object({
    status: z.enum(['OPEN', 'VERIFIED', 'ACCEPTED_RISK', 'SUPPRESSED_FALSE_POSITIVE']),
    justification: z.string().trim().max(2000).optional(),
    suppressScope: z.enum(['FINDING_ONLY', 'OBJECT_RULE', 'TENANT_OVERRIDE']).optional(),
  })
  .passthrough();
const LEGACY_STATUS_MAP = LEGACY_REVIEW_STATUS_MAP;

const statusAudit = (action: string) =>
  Audited({
    action,
    targetType: 'FINDING',
    targetId: ({ params }) => params.id,
    payload: ({ body, result }) => ({
      toStatus: result?.lifecycle?.status ?? body?.status ?? null,
      lifecycleId: result?.lifecycle?.id ?? null,
      reason: typeof body?.reason === 'string' ? body.reason.slice(0, 500) : null,
      suppression: body?.suppression ?? null,
    }),
  });

@Controller('findings')
@UseGuards(JwtAuthGuard, TenancyGuard)
export class FindingsController {
  constructor(
    private readonly findingsService: FindingsService,
    private readonly lifecycle: FindingLifecycleService
  ) {}

  @Get()
  async findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Query('projectId') projectId?: string,
    @Query('engine') engine?: string,
    @Query('severity') severity?: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('assignee') assignee?: string,
    @Query('due') due?: string,
    @Query('latest') latest?: string
  ) {
    const query: FindFindingsRequest = {
      projectId,
      engine,
      severity,
      category,
      search,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 25,
      status: status || undefined,
      assignee: assignee || undefined,
      due: due || undefined,
      latest: latest === 'true' || latest === '1',
      currentUserId: userId,
    };
    return this.findingsService.findAll(tenantId, query);
  }

  @Get('stats')
  async getStats(
    @CurrentTenant() tenantId: string,
    @Query('projectId') projectId?: string
  ) {
    return this.findingsService.getStats(tenantId, projectId);
  }

  @Post('bulk')
  @Audited({
    action: ({ body }) => `finding.bulk_${String(body?.action ?? 'action').toLowerCase()}`,
    targetType: 'FINDING',
    payload: ({ body, result }) => ({
      requested: result?.requested ?? null,
      succeeded: result?.succeeded ?? null,
      failed: result?.failed ?? null,
      assigneeId: body?.assigneeId ?? null,
      findingIds: Array.isArray(body?.findingIds) ? body.findingIds.slice(0, 200) : [],
    }),
  })
  async bulk(@CurrentTenant() tenantId: string, @Req() req: any, @Body() body: unknown) {
    return this.lifecycle.bulk(tenantId, actorOf(req), zodParse(BulkFindingActionSchema, body));
  }

  @Get(':id')
  async findById(
    @CurrentTenant() tenantId: string,
    @Param('id', new ParseUUIDPipe()) id: string
  ) {
    return this.findingsService.findById(tenantId, id);
  }

  @Get(':id/evidence')
  async evidence(@CurrentTenant() tenantId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.findingsService.getEvidence(tenantId, id);
  }

  @Get(':id/related')
  async related(@CurrentTenant() tenantId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.findingsService.getRelated(tenantId, id);
  }

  /** Lifecycle view: status, allowed transitions, history, comments, assignments, attachments, tests. */
  @Get(':id/lifecycle')
  async lifecycleView(@CurrentTenant() tenantId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.lifecycle.getView(tenantId, id);
  }

  @Post(':id/status')
  @statusAudit('finding.status_changed')
  async changeStatus(
    @CurrentTenant() tenantId: string,
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown
  ) {
    return this.lifecycle.transition(tenantId, actorOf(req), id, zodParse(TransitionFindingStatusSchema, body));
  }

  @Post(':id/accept-risk')
  @statusAudit('finding.risk_accepted')
  async acceptRisk(@CurrentTenant() tenantId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const b = zodParse(ReasonOnlySchema, body);
    return this.lifecycle.transition(tenantId, actorOf(req), id, this.checked({ status: 'ACCEPTED_RISK', ...b }));
  }

  @Post(':id/suppress')
  @statusAudit('finding.suppressed')
  async suppress(@CurrentTenant() tenantId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const b = zodParse(SuppressBodySchema, body);
    return this.lifecycle.transition(tenantId, actorOf(req), id, this.checked({ status: 'SUPPRESSED', ...b }));
  }

  @Post(':id/resolve')
  @statusAudit('finding.resolved')
  async resolve(@CurrentTenant() tenantId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const b = zodParse(ReasonOnlySchema, body);
    return this.lifecycle.transition(tenantId, actorOf(req), id, this.checked({ status: 'RESOLVED', ...b }));
  }

  @Post(':id/reopen')
  @statusAudit('finding.reopened')
  async reopen(@CurrentTenant() tenantId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const b = zodParse(ReasonOnlySchema, body);
    return this.lifecycle.transition(tenantId, actorOf(req), id, this.checked({ status: 'OPEN', ...b }));
  }

  @Post(':id/assign')
  @Audited({
    action: 'finding.assigned',
    targetType: 'FINDING',
    targetId: ({ params }) => params.id,
    payload: ({ body }) => ({ assigneeId: body?.assigneeId ?? null, dueDate: body?.dueDate ?? null }),
  })
  async assign(@CurrentTenant() tenantId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.lifecycle.assign(tenantId, actorOf(req), id, zodParse(AssignFindingSchema, body));
  }

  @Post(':id/comments')
  @Audited({
    action: 'finding.comment_added',
    targetType: 'FINDING',
    targetId: ({ params }) => params.id,
    payload: ({ result }) => ({ commentId: result?.commentId ?? null }),
  })
  async addComment(@CurrentTenant() tenantId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.lifecycle.addComment(tenantId, actorOf(req), id, zodParse(FindingCommentBodySchema, body).body);
  }

  @Patch(':id/comments/:commentId')
  @Audited({
    action: 'finding.comment_edited',
    targetType: 'FINDING',
    targetId: ({ params }) => params.id,
    payload: ({ params }) => ({ commentId: params.commentId }),
  })
  async editComment(
    @CurrentTenant() tenantId: string,
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('commentId', new ParseUUIDPipe()) commentId: string,
    @Body() body: unknown
  ) {
    return this.lifecycle.editComment(tenantId, actorOf(req), id, commentId, zodParse(FindingCommentBodySchema, body).body);
  }

  @Delete(':id/comments/:commentId')
  @Audited({
    action: 'finding.comment_deleted',
    targetType: 'FINDING',
    targetId: ({ params }) => params.id,
    payload: ({ params }) => ({ commentId: params.commentId }),
  })
  async deleteComment(
    @CurrentTenant() tenantId: string,
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('commentId', new ParseUUIDPipe()) commentId: string
  ) {
    return this.lifecycle.deleteComment(tenantId, actorOf(req), id, commentId);
  }

  @Post(':id/attachments')
  @Audited({
    action: 'finding.attachment_linked',
    targetType: 'FINDING',
    targetId: ({ params }) => params.id,
    payload: ({ body, result }) => ({ fileId: body?.fileId ?? null, attachmentId: result?.attachmentId ?? null }),
  })
  async attach(@CurrentTenant() tenantId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.lifecycle.attach(tenantId, actorOf(req), id, zodParse(AttachArtifactSchema, body));
  }

  @Delete(':id/attachments/:attachmentId')
  @Audited({
    action: 'finding.attachment_removed',
    targetType: 'FINDING',
    targetId: ({ params }) => params.id,
    payload: ({ params }) => ({ attachmentId: params.attachmentId }),
  })
  async detach(
    @CurrentTenant() tenantId: string,
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string
  ) {
    return this.lifecycle.detach(tenantId, actorOf(req), id, attachmentId);
  }

  @Post(':id/work-item')
  async createWorkItem(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: { connectorId?: string; system?: string; confirm?: boolean; dryRun?: boolean }
  ) {
    return this.findingsService.createWorkItem(tenantId, id, userId, body || {});
  }

  /**
   * @deprecated Use POST /findings/:id/status. Kept for existing API clients: maps the
   * legacy review statuses onto lifecycle transitions (history + audit, no in-place
   * mutation of the finding row). Scope cascades are no longer supported.
   */
  @Patch(':id/review')
  @statusAudit('finding.status_changed')
  async reviewFinding(
    @CurrentTenant() tenantId: string,
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown
  ) {
    const legacy = zodParse(LegacyReviewSchema, body);
    return this.lifecycle.transition(
      tenantId,
      actorOf(req),
      id,
      this.checked({ status: LEGACY_STATUS_MAP[legacy.status], reason: legacy.justification })
    );
  }

  private checked(input: unknown): TransitionFindingStatusInput {
    return zodParse(TransitionFindingStatusSchema, input);
  }
}
