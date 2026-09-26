import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { DenyApiKeyAuth } from '../api-keys/api-key-scopes';
import { CreateGrantSchema, PartnersService } from './partners.service';
import { ZodBody } from '../../common/openapi/zod-openapi';

/** Partner mode (C §61): customer-granted, audited, expiring delegated access. */
@ApiTags('Partner Mode')
@ApiBearerAuth()
@DenyApiKeyAuth()
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
@Controller('partners')
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Get('grants')
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN', 'AUDITOR')
  @ApiOperation({ summary: 'Customer side: delegated access grants given by this organization' })
  given(@CurrentTenant() orgId: string) {
    return this.partners.listGiven(orgId);
  }

  @Post('grants')
  @ZodBody(CreateGrantSchema)
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  @ApiOperation({ summary: 'Grant a partner organization time-limited delegated access (audited)' })
  grant(@CurrentTenant() orgId: string, @Req() req: any, @Body() body: unknown) {
    return this.partners.grant(orgId, req.user.id, body);
  }

  @Post('grants/:id/revoke')
  @HttpCode(200)
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  revoke(@CurrentTenant() orgId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.partners.revoke(orgId, req.user.id, id);
  }

  @Get('clients')
  @ApiOperation({ summary: 'Partner side: customer organizations that granted this organization access' })
  clients(@CurrentTenant() orgId: string) {
    return this.partners.listClients(orgId);
  }
}
