import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { DenyApiKeyAuth } from '../api-keys/api-key-scopes';
import { ConnectorsService } from './connectors.service';
import { WorkItemsService } from './work-items.service';
import { AgentDevicesService, CreateJobSchema, IssueEnrollmentTokenSchema, UpdateDeviceSchema } from './agent-devices.service';
import { CreateConnectorSchema, GitIngestSchema, ProjectLinkSchema, UpdateConnectorSchema } from './connectors.service';
import { CommentSchema, CreateWorkItemSchema, ResolveConflictSchema, UpdateWorkItemSchema } from './work-items.service';
import { ZodBody } from '../../common/openapi/zod-openapi';

const ADMIN_ROLES = ['ORGANIZATION_OWNER', 'SECURITY_ADMIN'] as const;
const OPERATOR_ROLES = ['ORGANIZATION_OWNER', 'SECURITY_ADMIN', 'LEAD_ARCHITECT'] as const;
const WORK_ITEM_ROLES = ['ORGANIZATION_OWNER', 'SECURITY_ADMIN', 'LEAD_ARCHITECT', 'MIGRATION_CONSULTANT'] as const;

/** Connector framework (Part 03 §3.11, Part 15.23/15.24, Part 18, C §35). */
@ApiTags('Integrations: Connectors')
@ApiBearerAuth()
@DenyApiKeyAuth()
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
@Controller('connectors')
export class ConnectorsController {
  constructor(
    private readonly connectors: ConnectorsService,
    private readonly workItems: WorkItemsService
  ) {}

  @Get('types')
  @ApiOperation({ summary: 'Connector registry: types, config/credential fields, least-privilege scopes, write action registry' })
  types() {
    return this.connectors.listTypes();
  }

  @Get()
  @ApiOperation({ summary: 'List connector instances of the tenant (secrets are never returned)' })
  list(@CurrentTenant() orgId: string) {
    return this.connectors.list(orgId);
  }

  @Post()
  @Roles(...ADMIN_ROLES)
  @ZodBody(CreateConnectorSchema)
  @ApiOperation({ summary: 'Create a connector instance (credentials are encrypted at rest with AES-256-GCM)' })
  create(@CurrentTenant() orgId: string, @Req() req: any, @Body() body: unknown) {
    return this.connectors.create(orgId, req.user.id, body);
  }

  // --- work items (declared before :id routes) ---------------------------
  @Get('work-items')
  @ApiOperation({ summary: 'List external work items linked to findings (filter by projectId / findingId)' })
  listWorkItems(@CurrentTenant() orgId: string, @Query('projectId') projectId?: string, @Query('findingId') findingId?: string) {
    return this.workItems.list(orgId, { projectId, findingId });
  }

  @Post('work-items')
  @ZodBody(CreateWorkItemSchema)
  @Roles(...WORK_ITEM_ROLES)
  @ApiOperation({ summary: 'Create a work item from a finding (dryRun previews the payload; confirm=true required to write)' })
  createWorkItem(@CurrentTenant() orgId: string, @Req() req: any, @Body() body: unknown) {
    return this.workItems.createForFinding(orgId, req.user.id, body);
  }

  @Post('work-items/sync')
  @Roles(...WORK_ITEM_ROLES)
  @ApiOperation({ summary: 'Pull-sync status of all work items (optionally for one project)' })
  syncAll(@CurrentTenant() orgId: string, @Req() req: any, @Query('projectId') projectId?: string) {
    return this.workItems.syncAll(orgId, req.user.id, projectId);
  }

  @Post('work-items/:workItemId/sync')
  @Roles(...WORK_ITEM_ROLES)
  syncOne(@CurrentTenant() orgId: string, @Req() req: any, @Param('workItemId', new ParseUUIDPipe()) id: string) {
    return this.workItems.sync(orgId, req.user.id, id);
  }

  @Patch('work-items/:workItemId')
  @ZodBody(UpdateWorkItemSchema)
  @Roles(...WORK_ITEM_ROLES)
  @ApiOperation({ summary: 'Explicitly push title/body/priority (refused with CONFLICT when the remote changed)' })
  updateWorkItem(@CurrentTenant() orgId: string, @Req() req: any, @Param('workItemId', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.workItems.update(orgId, req.user.id, id, body);
  }

  @Post('work-items/:workItemId/resolve-conflict')
  @ZodBody(ResolveConflictSchema)
  @Roles(...WORK_ITEM_ROLES)
  resolveConflict(@CurrentTenant() orgId: string, @Req() req: any, @Param('workItemId', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.workItems.resolveConflict(orgId, req.user.id, id, body);
  }

  @Post('work-items/:workItemId/comments')
  @ZodBody(CommentSchema)
  @Roles(...WORK_ITEM_ROLES)
  comment(@CurrentTenant() orgId: string, @Req() req: any, @Param('workItemId', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.workItems.comment(orgId, req.user.id, id, body);
  }

  // --- instance routes ------------------------------------------------------
  @Get(':id')
  get(@CurrentTenant() orgId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.connectors.get(orgId, id);
  }

  @Patch(':id')
  @Roles(...ADMIN_ROLES)
  @ZodBody(UpdateConnectorSchema)
  @ApiOperation({ summary: 'Update config / rotate credentials / change access mode (returns the permission diff)' })
  update(@CurrentTenant() orgId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.connectors.update(orgId, req.user.id, id, body);
  }

  @Delete(':id')
  @Roles(...ADMIN_ROLES)
  remove(@CurrentTenant() orgId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.connectors.remove(orgId, req.user.id, id);
  }

  @Post(':id/test')
  @HttpCode(200)
  @Roles(...OPERATOR_ROLES)
  @ApiOperation({ summary: 'Test connection + capability handshake; updates health and circuit breaker' })
  test(@CurrentTenant() orgId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.connectors.testConnection(orgId, req.user.id, id);
  }

  @Get(':id/sync-log')
  syncLog(@CurrentTenant() orgId: string, @Param('id', new ParseUUIDPipe()) id: string, @Query('limit') limit?: string) {
    return this.connectors.syncLog(orgId, id, limit ? Number(limit) : 50);
  }

  @Post(':id/metadata')
  @Roles(...OPERATOR_ROLES)
  @ApiOperation({ summary: 'Fetch + normalize OData $metadata / OpenAPI document as an API Change Guard baseline' })
  fetchMetadata(@CurrentTenant() orgId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.connectors.fetchMetadata(orgId, req.user.id, id);
  }

  @Get(':id/metadata')
  listSnapshots(@CurrentTenant() orgId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.connectors.listSnapshots(orgId, id);
  }

  @Get(':id/metadata/:snapshotId')
  getSnapshot(
    @CurrentTenant() orgId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('snapshotId', new ParseUUIDPipe()) snapshotId: string
  ) {
    return this.connectors.getSnapshot(orgId, id, snapshotId);
  }

  @Post(':id/git/snapshot')
  @Roles(...OPERATOR_ROLES)
  @ApiOperation({ summary: 'Shallow read-only clone of the configured branch; records the file tree snapshot' })
  gitSnapshot(@CurrentTenant() orgId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.connectors.gitSnapshot(orgId, req.user.id, id);
  }

  @Post(':id/git/ingest')
  @ZodBody(GitIngestSchema)
  @Roles(...OPERATOR_ROLES)
  @ApiOperation({ summary: 'Ingest the ABAP sources of the branch into a project (full ingestion pipeline)' })
  gitIngest(@CurrentTenant() orgId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.connectors.gitIngest(orgId, req.user.id, id, body);
  }

  @Get(':id/cloud-alm/projects')
  @Roles(...OPERATOR_ROLES)
  cloudAlmProjects(@CurrentTenant() orgId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.connectors.cloudAlmProjects(orgId, req.user.id, id);
  }

  @Get(':id/project-links')
  projectLinks(@CurrentTenant() orgId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.connectors.listProjectLinks(orgId, id);
  }

  @Post(':id/project-links')
  @ZodBody(ProjectLinkSchema)
  @Roles(...OPERATOR_ROLES)
  upsertProjectLink(@CurrentTenant() orgId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.connectors.upsertProjectLink(orgId, req.user.id, id, body);
  }
}

/** Local agent device management — admin side (Part 18.7). */
@ApiTags('Integrations: Local Agents')
@ApiBearerAuth()
@DenyApiKeyAuth()
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
@Controller('agents')
export class AgentAdminController {
  constructor(private readonly devices: AgentDevicesService) {}

  @Post('enrollment-tokens')
  @ZodBody(IssueEnrollmentTokenSchema)
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Issue a single-use, short-lived device enrollment token' })
  issueToken(@CurrentTenant() orgId: string, @Req() req: any, @Body() body: unknown) {
    return this.devices.issueEnrollmentToken(orgId, req.user.id, body);
  }

  @Get('devices')
  listDevices(@CurrentTenant() orgId: string) {
    return this.devices.listDevices(orgId);
  }

  @Patch('devices/:id')
  @ZodBody(UpdateDeviceSchema)
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Update device name, update channel or data egress policy (redaction cannot be disabled)' })
  updateDevice(@CurrentTenant() orgId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.devices.updateDevice(orgId, req.user.id, id, body);
  }

  @Post('devices/:id/revoke')
  @HttpCode(200)
  @Roles(...ADMIN_ROLES)
  revoke(@CurrentTenant() orgId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.devices.revokeDevice(orgId, req.user.id, id);
  }

  @Post('devices/:id/jobs')
  @ZodBody(CreateJobSchema)
  @Roles(...OPERATOR_ROLES)
  @ApiOperation({ summary: 'Queue a signed job (SCAN_DIRECTORY / PROBE_URL) for the device' })
  createJob(@CurrentTenant() orgId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.devices.createJob(orgId, req.user.id, id, body);
  }

  @Get('devices/:id/jobs')
  listJobs(@CurrentTenant() orgId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.devices.listJobs(orgId, id);
  }

  @Get('signing-key')
  @ApiOperation({ summary: 'Public Ed25519 key that signs agent jobs and update manifests' })
  signingKey() {
    const k = this.devices.signingKey();
    return { keyId: k.keyId, publicKeyPem: k.publicKeyPem, algorithm: 'Ed25519' };
  }
}
