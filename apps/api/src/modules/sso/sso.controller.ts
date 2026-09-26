import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { DenyApiKeyAuth } from '../api-keys/api-key-scopes';
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from '../auth/auth.controller';
import { SSO_STATE_COOKIE, SsoService } from './sso.service';
import { ScimError, ScimService, SCIM_ERROR } from './scim.service';
import { ZodBody } from '../../common/openapi/zod-openapi';
import { AddDomainSchema, UpsertIdpSchema } from './sso.service';

function requestOrigin(req: any): string {
  return `${req.protocol}://${req.get?.('host') ?? req.headers?.host}`;
}

function readCookie(req: any, name: string): string | undefined {
  const header = String(req.headers?.cookie || '');
  const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

/** Enterprise SSO administration (organization owners / security admins). */
@ApiTags('Enterprise Identity: SSO & SCIM administration')
@ApiBearerAuth()
@DenyApiKeyAuth()
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
@Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
@Controller('sso/admin')
export class SsoAdminController {
  constructor(
    private readonly sso: SsoService,
    private readonly scim: ScimService
  ) {}

  @Get('config')
  getConfig(@CurrentTenant() orgId: string) {
    return this.sso.getConfig(orgId);
  }

  @Put('config')
  @ZodBody(UpsertIdpSchema)
  @ApiOperation({ summary: 'Configure the OIDC identity provider (discovery is fetched and validated)' })
  upsert(@CurrentTenant() orgId: string, @Req() req: any, @Body() body: unknown) {
    return this.sso.upsertConfig(orgId, req.user.id, body);
  }

  @Get('domains')
  domains(@CurrentTenant() orgId: string) {
    return this.sso.listDomains(orgId);
  }

  @Post('domains')
  @ZodBody(AddDomainSchema)
  @ApiOperation({ summary: 'Add an e-mail domain; returns the DNS TXT record proving ownership' })
  addDomain(@CurrentTenant() orgId: string, @Req() req: any, @Body() body: unknown) {
    return this.sso.addDomain(orgId, req.user.id, body);
  }

  @Post('domains/:id/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Look up the DNS TXT challenge record and mark the domain VERIFIED' })
  verify(@CurrentTenant() orgId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.sso.verifyDomain(orgId, req.user.id, id);
  }

  @Delete('domains/:id')
  removeDomain(@CurrentTenant() orgId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.sso.removeDomain(orgId, req.user.id, id);
  }

  @Get('scim-tokens')
  scimTokens(@CurrentTenant() orgId: string) {
    return this.scim.listTokens(orgId);
  }

  @Post('scim-tokens')
  @ApiOperation({ summary: 'Create a SCIM bearer token (returned once)' })
  createScimToken(@CurrentTenant() orgId: string, @Req() req: any, @Body() body: any) {
    const name = String(body?.name || 'SCIM provisioning').trim() || 'SCIM provisioning';
    return this.scim.createToken(orgId, req.user.id, name);
  }

  @Delete('scim-tokens/:id')
  revokeScimToken(@CurrentTenant() orgId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.scim.revokeToken(orgId, req.user.id, id);
  }

  @Get('scim-groups')
  scimGroups(@CurrentTenant() orgId: string) {
    return this.scim.listGroupsAdmin(orgId);
  }

  @Patch('scim-groups/:id')
  @ApiOperation({ summary: 'Map a provisioned group to an organization role (null removes the mapping)' })
  mapGroup(@CurrentTenant() orgId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: any) {
    return this.scim.mapGroupRole(orgId, req.user.id, id, body?.role ?? null);
  }
}

/** Public SSO login endpoints (no session yet). */
@ApiTags('Enterprise Identity: SSO login')
@Controller('sso')
export class SsoLoginController {
  private readonly logger = new Logger(SsoLoginController.name);

  constructor(private readonly sso: SsoService) {}

  @Get('discover')
  @ApiOperation({ summary: 'Is SSO available for this e-mail address (verified domain + active IdP)?' })
  discover(@Query('email') email: string) {
    return this.sso.discoverForEmail(email);
  }

  @Get('login')
  @ApiOperation({ summary: 'Start OIDC authorization code + PKCE login (302 to the IdP)' })
  async login(
    @Req() req: any,
    @Res() res: Response,
    @Query('email') email?: string,
    @Query('organizationId') organizationId?: string,
    @Query('returnTo') returnTo?: string
  ) {
    try {
      const { authorizationUrl, state } = await this.sso.startLogin({ email, organizationId, returnTo }, requestOrigin(req));
      res.cookie(SSO_STATE_COOKIE, SsoService.stateCookieValue(state), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/v1/sso',
        maxAge: 10 * 60 * 1000,
      });
      res.redirect(302, authorizationUrl);
    } catch (err: any) {
      this.logger.warn(`SSO login start failed: ${err?.message}`);
      res.redirect(302, this.sso.webErrorUrl('SSO_NOT_AVAILABLE'));
    }
  }

  @Get('callback')
  @ApiOperation({ summary: 'OIDC redirect URI: validates the ID token and issues the ERP Preflight session' })
  async callback(@Req() req: any, @Res() res: Response, @Query() query: Record<string, string>) {
    try {
      const { session, returnTo } = await this.sso.completeLogin(query, readCookie(req, SSO_STATE_COOKIE), requestOrigin(req));
      res.clearCookie(SSO_STATE_COOKIE, { path: '/api/v1/sso' });
      res.cookie(SESSION_COOKIE_NAME, session.accessToken, SESSION_COOKIE_OPTIONS);
      res.redirect(302, this.sso.webCompletionUrl(session.accessToken, session.user.organizationId, returnTo));
    } catch (err: any) {
      this.logger.warn(`SSO callback failed: ${err?.message}`);
      res.clearCookie(SSO_STATE_COOKIE, { path: '/api/v1/sso' });
      res.redirect(302, this.sso.webErrorUrl('SSO_LOGIN_FAILED'));
    }
  }
}

/** SCIM responses must use the SCIM error schema and media type. */
@Catch()
export class ScimExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let body: any = { schemas: [SCIM_ERROR], status: '500', detail: 'Internal server error' };
    if (exception instanceof ScimError) {
      status = exception.getStatus();
      body = exception.getResponse();
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r: any = exception.getResponse();
      body = { schemas: [SCIM_ERROR], status: String(status), detail: Array.isArray(r?.message) ? r.message.join('; ') : r?.message || exception.message };
    }
    res.status(status).type('application/scim+json').send(JSON.stringify(body));
  }
}

/** SCIM 2.0 service provider (bearer token per organization). */
@ApiTags('Enterprise Identity: SCIM 2.0')
@UseFilters(ScimExceptionFilter)
@Controller('scim/v2')
export class ScimController {
  constructor(private readonly scim: ScimService) {}

  private async principal(req: any) {
    return this.scim.authenticate(req.headers?.authorization);
  }

  private send(res: Response, status: number, body: unknown) {
    res.status(status).type('application/scim+json').send(JSON.stringify(body));
  }

  @Get('ServiceProviderConfig')
  spc(@Res() res: Response) {
    this.send(res, 200, this.scim.serviceProviderConfig());
  }

  @Get('ResourceTypes')
  resourceTypes(@Res() res: Response) {
    this.send(res, 200, this.scim.resourceTypes());
  }

  @Get('Users')
  async listUsers(@Req() req: any, @Res() res: Response, @Query() q: any) {
    this.send(res, 200, await this.scim.listUsers(await this.principal(req), q));
  }

  @Post('Users')
  async createUser(@Req() req: any, @Res() res: Response, @Body() body: unknown) {
    this.send(res, 201, await this.scim.createUser(await this.principal(req), body));
  }

  @Get('Users/:id')
  async getUser(@Req() req: any, @Res() res: Response, @Param('id') id: string) {
    this.send(res, 200, await this.scim.getUser(await this.principal(req), id));
  }

  @Put('Users/:id')
  async replaceUser(@Req() req: any, @Res() res: Response, @Param('id') id: string, @Body() body: unknown) {
    this.send(res, 200, await this.scim.replaceUser(await this.principal(req), id, body));
  }

  @Patch('Users/:id')
  async patchUser(@Req() req: any, @Res() res: Response, @Param('id') id: string, @Body() body: unknown) {
    this.send(res, 200, await this.scim.patchUser(await this.principal(req), id, body));
  }

  @Delete('Users/:id')
  async deleteUser(@Req() req: any, @Res() res: Response, @Param('id') id: string) {
    await this.scim.deleteUser(await this.principal(req), id);
    res.status(204).end();
  }

  @Get('Groups')
  async listGroups(@Req() req: any, @Res() res: Response, @Query() q: any) {
    this.send(res, 200, await this.scim.listGroups(await this.principal(req), q));
  }

  @Post('Groups')
  async createGroup(@Req() req: any, @Res() res: Response, @Body() body: unknown) {
    this.send(res, 201, await this.scim.createGroup(await this.principal(req), body));
  }

  @Get('Groups/:id')
  async getGroup(@Req() req: any, @Res() res: Response, @Param('id') id: string) {
    this.send(res, 200, await this.scim.getGroup(await this.principal(req), id));
  }

  @Put('Groups/:id')
  async replaceGroup(@Req() req: any, @Res() res: Response, @Param('id') id: string, @Body() body: unknown) {
    this.send(res, 200, await this.scim.replaceGroup(await this.principal(req), id, body));
  }

  @Patch('Groups/:id')
  async patchGroup(@Req() req: any, @Res() res: Response, @Param('id') id: string, @Body() body: unknown) {
    this.send(res, 200, await this.scim.patchGroup(await this.principal(req), id, body));
  }

  @Delete('Groups/:id')
  async deleteGroup(@Req() req: any, @Res() res: Response, @Param('id') id: string) {
    await this.scim.deleteGroup(await this.principal(req), id);
    res.status(204).end();
  }
}
