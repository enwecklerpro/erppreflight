import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { OrganizationsService } from './organizations.service';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import {
  CreateInvitationDto,
  DeleteOrganizationDto,
  OrganizationSecurityDto,
  TransferOwnershipDto,
  UpdateMemberRoleDto,
} from './dto/membership.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { VerifiedEmailGuard } from '../auth/guards/verified-email.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DenyApiKeyAuth } from '../api-keys/api-key-scopes';
import { requestMeta } from '../auth/auth.controller';
import { TwoFactorService } from '../auth/two-factor.service';
import { InvitationsService } from './invitations.service';
import { MembersService } from './members.service';
import { OrganizationLifecycleService } from './organization-lifecycle.service';

@Controller('organizations')
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly invitations: InvitationsService,
    private readonly members: MembersService,
    private readonly lifecycle: OrganizationLifecycleService,
    private readonly twoFactor: TwoFactorService
  ) {}

  @Get('current')
  async getCurrent(@CurrentTenant() tenantId: string) {
    return this.organizationsService.getCurrentOrganization(tenantId);
  }

  /** Organizations the caller belongs to (organization switcher). */
  @Get()
  async getUserOrganizations(@CurrentUser('id') userId: string) {
    return this.organizationsService.getUserOrganizations(userId);
  }

  @Patch('current')
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  async updateCurrent(@CurrentTenant() tenantId: string, @Body() dto: UpdateOrganizationDto) {
    return this.organizationsService.updateCurrentOrganization(tenantId, dto);
  }

  /** Organization-wide "require 2FA" policy. Enabling it requires 2FA on the caller's own account. */
  @Patch('current/security')
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  @DenyApiKeyAuth()
  async updateSecurityPolicy(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Body() dto: OrganizationSecurityDto,
    @Req() req: Request
  ) {
    return this.lifecycle.setSecurityPolicy(tenantId, user, dto.require2fa, requestMeta(req));
  }

  /** GDPR (spec 10 §10.19): ZIP export of the organization's data. */
  @Get('current/export')
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  @UseGuards(VerifiedEmailGuard)
  @DenyApiKeyAuth()
  async exportOrganization(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Req() req: Request
  ): Promise<StreamableFile> {
    const { buffer, fileName } = await this.lifecycle.exportOrganization(tenantId, userId, requestMeta(req));
    return new StreamableFile(buffer, {
      type: 'application/zip',
      disposition: `attachment; filename="${fileName}"`,
      length: buffer.length,
    });
  }

  /** Permanently deletes the organization and all its data (owners only, typed confirmation). */
  @Delete('current')
  @HttpCode(HttpStatus.OK)
  @Roles('ORGANIZATION_OWNER')
  @DenyApiKeyAuth()
  async deleteOrganization(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: DeleteOrganizationDto
  ) {
    const org = await this.organizationsService.getCurrentOrganization(tenantId);
    if (dto.confirmName.trim() !== String(org.name).trim()) {
      throw new BadRequestException('The confirmation does not match the organization name');
    }
    await this.twoFactor.confirmIdentity(userId, dto.password, { code: dto.code, recoveryCode: dto.recoveryCode });
    return this.lifecycle.deleteOrganization(tenantId, userId);
  }

  // ------------------------------------------------------------------ members

  @Get('members')
  async getMembers(@CurrentTenant() tenantId: string) {
    return this.members.list(tenantId);
  }

  @Patch('members/:memberId')
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  @DenyApiKeyAuth()
  async updateMemberRole(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Body() dto: UpdateMemberRoleDto,
    @Req() req: Request
  ) {
    return this.members.updateRole(tenantId, user, memberId, dto.role, requestMeta(req));
  }

  /** Owner hands ownership to another member (caller becomes SECURITY_ADMIN). */
  @Post('ownership-transfer')
  @HttpCode(HttpStatus.OK)
  @Roles('ORGANIZATION_OWNER')
  @DenyApiKeyAuth()
  async transferOwnership(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Body() dto: TransferOwnershipDto,
    @Req() req: Request
  ) {
    return this.members.transferOwnership(tenantId, user, dto.memberId, requestMeta(req));
  }

  /** The caller leaves the active organization. */
  @Post('members/leave')
  @HttpCode(HttpStatus.OK)
  @DenyApiKeyAuth()
  async leave(@CurrentTenant() tenantId: string, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.members.leave(tenantId, userId, requestMeta(req));
  }

  @Delete('members/:memberId')
  @HttpCode(HttpStatus.OK)
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  @DenyApiKeyAuth()
  async removeMember(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Req() req: Request
  ) {
    return this.members.remove(tenantId, user, memberId, requestMeta(req));
  }

  // ------------------------------------------------------------------ invitations

  @Get('invitations')
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  async listInvitations(@CurrentTenant() tenantId: string) {
    return this.invitations.list(tenantId);
  }

  @Post('invitations')
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  @UseGuards(VerifiedEmailGuard)
  @DenyApiKeyAuth()
  async createInvitation(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Body() dto: CreateInvitationDto,
    @Req() req: Request
  ) {
    return this.invitations.create(tenantId, user, dto.email, dto.role, requestMeta(req));
  }

  @Post('invitations/:invitationId/resend')
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  @UseGuards(VerifiedEmailGuard)
  @DenyApiKeyAuth()
  async resendInvitation(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @Req() req: Request
  ) {
    return this.invitations.resend(tenantId, user, invitationId, requestMeta(req));
  }

  @Delete('invitations/:invitationId')
  @HttpCode(HttpStatus.OK)
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  @DenyApiKeyAuth()
  async revokeInvitation(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @Req() req: Request
  ) {
    return this.invitations.revoke(tenantId, user, invitationId, requestMeta(req));
  }
}
