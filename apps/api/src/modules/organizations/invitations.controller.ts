import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthRateLimit, AuthRateLimitGuard, INVITATION_RATE_LIMIT } from '../auth/guards/auth-rate-limit.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DenyApiKeyAuth } from '../api-keys/api-key-scopes';
import { requestMeta } from '../auth/auth.controller';
import { SessionCookieService } from '../auth/session-cookie';
import { InvitationsService } from './invitations.service';
import { AcceptInvitationNewAccountDto, InvitationTokenDto } from './dto/membership.dto';

/**
 * Invitation acceptance (not tenant-scoped: the invitation token identifies the
 * organization). Tokens travel in request bodies, never in URLs of API calls.
 */
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly cookies: SessionCookieService
  ) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit(INVITATION_RATE_LIMIT)
  async preview(@Body() dto: InvitationTokenDto) {
    return this.invitations.preview(dto.token);
  }

  /** Signed-in user (whose e-mail matches the invitation) joins the organization. */
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard, JwtAuthGuard)
  @AuthRateLimit(INVITATION_RATE_LIMIT)
  @DenyApiKeyAuth()
  async accept(
    @Body() dto: InvitationTokenDto,
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request
  ) {
    // Session in the HttpOnly cookie; browsers never receive the access token in the body.
    return this.cookies.present(req, res, await this.invitations.acceptAsExistingUser(dto.token, userId, requestMeta(req)));
  }

  /** New user: creates an account for the invited address and joins the organization. */
  @Post('accept-new')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit(INVITATION_RATE_LIMIT)
  async acceptNew(
    @Body() dto: AcceptInvitationNewAccountDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request
  ) {
    return this.cookies.present(
      req,
      res,
      await this.invitations.acceptWithNewAccount(dto.token, dto.password, dto.fullName, requestMeta(req))
    );
  }
}
