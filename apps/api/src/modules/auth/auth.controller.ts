import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
  Res,
  Req,
  ForbiddenException,
  Delete,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { AuthService, SessionResult, isMfaChallenge } from './auth.service';
import {
  ChangePasswordDto,
  DisableTwoFactorDto,
  ForgotPasswordDto,
  LoginDto,
  LoginSecondFactorDto,
  PasswordConfirmationDto,
  RegisterDto,
  ResetPasswordDto,
  SecondFactorDto,
  SwitchOrganizationDto,
  TokenDto,
  TotpCodeDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AuthRateLimit,
  AuthRateLimitGuard,
  FORGOT_PASSWORD_RATE_LIMIT,
  LOGIN_RATE_LIMIT,
  MFA_LOGIN_RATE_LIMIT,
  REGISTER_RATE_LIMIT,
  RESEND_VERIFICATION_RATE_LIMIT,
  RESET_PASSWORD_RATE_LIMIT,
  VERIFY_EMAIL_RATE_LIMIT,
} from './guards/auth-rate-limit.guard';
import { DenyApiKeyAuth } from '../api-keys/api-key-scopes';
import { EmailVerificationService } from './email-verification.service';
import { AccountSecurityService } from './account-security.service';
import { TwoFactorService } from './two-factor.service';
import { RequestMeta } from './security-audit.service';
import { cookieExtractor } from './strategies/jwt.strategy';
import { DatabaseService } from '../database/database.service';
import { SessionService } from './session.service';

export const SESSION_COOKIE_NAME = 'erppreflight_session';
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export function requestMeta(req: Request | undefined): RequestMeta {
  if (!req) return {};
  const ua = req.headers?.['user-agent'];
  return {
    ip: String(req.ip || req.socket?.remoteAddress || '') || null,
    userAgent: typeof ua === 'string' ? ua : null,
  };
}

function setSessionCookie(res: Response | undefined, token: string): void {
  if (res && typeof res.cookie === 'function') {
    res.cookie(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
  }
}

function clearSessionCookie(res: Response | undefined): void {
  if (res && typeof res.clearCookie === 'function') {
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  }
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly verification: EmailVerificationService,
    private readonly accountSecurity: AccountSecurityService,
    private readonly twoFactor: TwoFactorService,
    private readonly jwt: JwtService,
    private readonly db: DatabaseService,
    private readonly sessions: SessionService
  ) {}

  private withCookie(res: Response | undefined, session: SessionResult): SessionResult {
    setSessionCookie(res, session.accessToken);
    return session;
  }

  @Post('register')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit(REGISTER_RATE_LIMIT)
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req?: Request
  ) {
    const result = await this.authService.register(dto, requestMeta(req));
    return this.withCookie(res, result);
  }

  /** Password step. With 2FA enabled the response is `{ mfaRequired, challengeToken }` and no session. */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit(LOGIN_RATE_LIMIT)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response, @Req() req?: Request) {
    const result = await this.authService.login(dto, requestMeta(req));
    if (isMfaChallenge(result)) {
      return result;
    }
    return this.withCookie(res, result);
  }

  /** Second login step: TOTP code or recovery code. */
  @Post('login/2fa')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit(MFA_LOGIN_RATE_LIMIT)
  async loginSecondFactor(
    @Body() dto: LoginSecondFactorDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request
  ) {
    const session = await this.twoFactor.completeLogin(
      dto.challengeToken,
      { code: dto.code, recoveryCode: dto.recoveryCode },
      requestMeta(req)
    );
    return this.withCookie(res, session);
  }

  /** Revokes the presented token's server-side session (if valid) and clears the session cookie. */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) res: Response, @Req() req?: Request) {
    const auth = req?.headers?.authorization;
    const token =
      (typeof auth === 'string' && /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim()) || cookieExtractor(req);
    if (token) {
      try {
        const payload: any = this.jwt.verify(token);
        if (payload?.jti && payload?.sub && !payload.typ) {
          await this.accountSecurity.revokeSession(payload.sub, payload.jti, 'LOGOUT');
        }
      } catch {
        // Invalid / expired token or session already revoked: nothing to revoke.
      }
    }
    clearSessionCookie(res);
    return { success: true, message: 'Logged out successfully' };
  }

  /** Signs out every session of the caller (token_version bump). */
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @DenyApiKeyAuth()
  async logoutAll(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request
  ) {
    const result = await this.accountSecurity.logoutAll(userId, requestMeta(req));
    clearSessionCookie(res);
    return result;
  }

  /** Active sessions of the caller (device management). */
  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @DenyApiKeyAuth()
  async listSessions(@CurrentUser() user: any) {
    return this.sessions.list(user.id, user.jti);
  }

  /** Signs out one session (device) of the caller. */
  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @DenyApiKeyAuth()
  async revokeSession(
    @CurrentUser('id') userId: string,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Req() req: Request
  ) {
    return this.accountSecurity.revokeSession(userId, sessionId, 'USER_REVOKED', requestMeta(req));
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: any) {
    if (!user?.id || user.role === 'API_CLIENT') {
      return { user };
    }
    const res = await this.db.query(
      `SELECT full_name, email_verified_at, totp_enabled_at, created_at FROM users WHERE id = $1`,
      [user.id],
      { bypassRls: true }
    );
    const row = res.rows[0] || {};
    return {
      user: {
        id: user.id,
        userId: user.id,
        email: user.email,
        fullName: row.full_name ?? null,
        organizationId: user.organizationId,
        role: user.role,
        systemRole: user.systemRole,
        emailVerified: !!row.email_verified_at,
        emailVerifiedAt: row.email_verified_at ?? null,
        mfaEnabled: !!row.totp_enabled_at,
        createdAt: row.created_at ?? null,
      },
    };
  }

  // ---------------------------------------------------------------- e-mail verification

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit(VERIFY_EMAIL_RATE_LIMIT)
  async verifyEmail(@Body() dto: TokenDto, @Req() req: Request) {
    return this.verification.verify(dto.token, requestMeta(req));
  }

  @Post('verify-email/resend')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard, JwtAuthGuard)
  @AuthRateLimit(RESEND_VERIFICATION_RATE_LIMIT)
  @DenyApiKeyAuth()
  async resendVerification(@CurrentUser('id') userId: string, @Req() req: Request) {
    return this.verification.resend(userId, requestMeta(req));
  }

  // ---------------------------------------------------------------- passwords

  /** Always 200 with the same body, whether or not the account exists. */
  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit(FORGOT_PASSWORD_RATE_LIMIT)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.accountSecurity.forgotPassword(dto.email, requestMeta(req));
  }

  @Post('password/reset/validate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit(RESET_PASSWORD_RATE_LIMIT)
  async validateResetToken(@Body() dto: TokenDto) {
    return this.accountSecurity.validateResetToken(dto.token);
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit(RESET_PASSWORD_RATE_LIMIT)
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.accountSecurity.resetPassword(dto.token, dto.newPassword, requestMeta(req));
  }

  /** Changes the password, revokes all other sessions and returns a new session. */
  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @DenyApiKeyAuth()
  async changePassword(
    @CurrentUser() user: any,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request
  ) {
    const session = await this.accountSecurity.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
      user.organizationId,
      requestMeta(req)
    );
    return this.withCookie(res, session);
  }

  // ---------------------------------------------------------------- two-factor authentication

  @Get('2fa')
  @UseGuards(JwtAuthGuard)
  @DenyApiKeyAuth()
  async twoFactorStatus(@CurrentUser('id') userId: string) {
    return this.twoFactor.status(userId);
  }

  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @DenyApiKeyAuth()
  async twoFactorSetup(@CurrentUser('id') userId: string, @Body() dto: PasswordConfirmationDto) {
    return this.twoFactor.beginSetup(userId, dto.password);
  }

  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @DenyApiKeyAuth()
  async twoFactorEnable(
    @CurrentUser() user: any,
    @Body() dto: TotpCodeDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request
  ) {
    const { recoveryCodes, session } = await this.twoFactor.enable(
      user.id,
      dto.code,
      user.organizationId,
      requestMeta(req)
    );
    setSessionCookie(res, session.accessToken);
    return { ...session, recoveryCodes };
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @DenyApiKeyAuth()
  async twoFactorDisable(
    @CurrentUser() user: any,
    @Body() dto: DisableTwoFactorDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request
  ) {
    const session = await this.twoFactor.disable(
      user.id,
      dto.password,
      { code: dto.code, recoveryCode: dto.recoveryCode },
      user.organizationId,
      requestMeta(req)
    );
    return this.withCookie(res, session);
  }

  @Post('2fa/recovery-codes')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @DenyApiKeyAuth()
  async regenerateRecoveryCodes(
    @CurrentUser('id') userId: string,
    @Body() dto: DisableTwoFactorDto,
    @Req() req: Request
  ) {
    return this.twoFactor.regenerateRecoveryCodes(
      userId,
      dto.password,
      { code: dto.code, recoveryCode: dto.recoveryCode } as SecondFactorDto,
      requestMeta(req)
    );
  }

  // ---------------------------------------------------------------- organizations

  /**
   * Issues a session whose home organization is `organizationId`. Membership is
   * verified here (403 otherwise); per-request tenant checks still apply.
   */
  @Post('switch-organization')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @DenyApiKeyAuth()
  async switchOrganization(
    @CurrentUser() user: any,
    @Body() dto: SwitchOrganizationDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request
  ) {
    const userId: string = user.id;
    const membership = await this.db.query(
      `SELECT 1 FROM organization_members m JOIN organizations o ON o.id = m.organization_id
       WHERE m.user_id = $1 AND m.organization_id = $2 AND o.status = 'ACTIVE'`,
      [userId, dto.organizationId],
      { bypassRls: true }
    );
    if (membership.rows.length === 0) {
      throw new ForbiddenException('Access denied: You are not an active member of this organization');
    }
    const session = await this.authService.createSession(userId, {
      preferredOrganizationId: dto.organizationId,
      meta: requestMeta(req),
    });
    // The new session replaces the calling one (no session pile-up when switching).
    if (user.jti) {
      await this.sessions.revoke(userId, user.jti, 'LOGOUT').catch(() => undefined);
    }
    return this.withCookie(res, session);
  }
}
