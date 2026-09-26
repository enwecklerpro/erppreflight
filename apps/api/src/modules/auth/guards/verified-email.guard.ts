import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ACCOUNT_ERROR_CODES } from '@erppreflight/schemas';

/**
 * Whether unverified accounts are restricted (EMAIL_VERIFICATION_REQUIRED, default true).
 */
export function isEmailVerificationRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = String(env.EMAIL_VERIFICATION_REQUIRED ?? '').trim().toLowerCase();
  return !(raw === 'false' || raw === '0' || raw === 'off');
}

/**
 * Gating policy for unverified e-mail addresses (spec 10 §10.2, 13.11):
 * an unverified user can sign in, browse, create projects and upload artifacts,
 * but cannot run analyses, export reports or mint API keys (which could otherwise
 * be used to bypass this guard). Apply AFTER JwtAuthGuard:
 *
 *   @UseGuards(JwtAuthGuard, TenancyGuard, VerifiedEmailGuard)
 *
 * API-key principals pass: keys can only be created by verified users.
 * `req.user.emailVerified` is set by JwtStrategy from the users row on every request.
 */
@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!isEmailVerificationRequired()) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      return true; // authentication guards decide
    }
    if (user.role === 'API_CLIENT' || user.systemRole === 'SUPER_ADMIN' || user.emailVerified === true) {
      return true;
    }
    throw new ForbiddenException({
      message: 'Verify your e-mail address to run analyses and export reports.',
      code: ACCOUNT_ERROR_CODES.EMAIL_NOT_VERIFIED,
    });
  }
}
