import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { TokenDto } from './dto/auth.dto';
import { AuthRateLimit, AuthRateLimitGuard, RateLimitRule } from './guards/auth-rate-limit.guard';
import { Audited } from '../audit/audited.decorator';
import { isMfaChallenge } from './auth.service';
import { MagicLinkService } from './magic-link.service';
import { SessionCookieService } from './session-cookie';
import { requestMeta } from './auth.controller';

export const MAGIC_LINK_REQUEST_RATE_LIMIT: RateLimitRule = {
  name: 'magic-link-request',
  windowMs: 60 * 60 * 1000,
  maxPerIp: 20,
  maxPerIpAndEmail: 5,
};

export const MAGIC_LINK_VERIFY_RATE_LIMIT: RateLimitRule = {
  name: 'magic-link-verify',
  windowMs: 15 * 60 * 1000,
  maxPerIp: 30,
  maxPerIpAndEmail: 0,
};

export class MagicLinkRequestDto {
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(320)
  email: string;

  /** Optional same-site path to open after sign-in (validated server- and client-side). */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  next?: string;
}

const sessionFromResult = (result: any) => ({
  organizationId: result?.user?.organizationId,
  actorId: result?.user?.id,
});

/** Magic-link sign-in (spec 10.2). Tokens travel in request bodies, never in API URLs. */
@ApiTags('Authentication')
@Controller('auth/magic-link')
export class MagicLinkController {
  constructor(
    private readonly magicLinks: MagicLinkService,
    private readonly cookies: SessionCookieService
  ) {}

  /** Always 200 with the same body, whether or not the account exists. */
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit(MAGIC_LINK_REQUEST_RATE_LIMIT)
  @ApiOperation({ summary: 'E-mail a single-use sign-in link (15 min); identical response for unknown addresses' })
  async request(@Body() dto: MagicLinkRequestDto, @Req() req: Request) {
    return this.magicLinks.request(dto.email, requestMeta(req), dto.next);
  }

  /** Checks a link without consuming it (landing page shows the account first). */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit(MAGIC_LINK_VERIFY_RATE_LIMIT)
  @ApiOperation({ summary: 'Validate a sign-in link without consuming it' })
  async preview(@Body() dto: TokenDto) {
    return this.magicLinks.preview(dto.token);
  }

  /**
   * Consumes the link. Returns a session (HttpOnly cookie; browsers never get the
   * token in the body) or, with 2FA enabled, `{ mfaRequired, challengeToken }` for
   * POST /auth/login/2fa. 401 MAGIC_LINK_INVALID for unknown, used or expired links,
   * 403 SSO_REQUIRED for members of SSO-enforced organizations.
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit(MAGIC_LINK_VERIFY_RATE_LIMIT)
  @Audited({
    action: 'auth.login.succeeded',
    targetType: 'USER',
    targetId: ({ result }) => result?.user?.id,
    security: true,
    tenantFromResult: sessionFromResult,
    payload: ({ result }) => ({ email: result?.user?.email ?? null, method: 'MAGIC_LINK' }),
  })
  @ApiOperation({ summary: 'Sign in with a magic link (session cookie or 2FA challenge)' })
  async verify(@Body() dto: TokenDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.magicLinks.signIn(dto.token, requestMeta(req));
    if (isMfaChallenge(result)) {
      return result;
    }
    return this.cookies.present(req, res, result);
  }
}
