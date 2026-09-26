import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthTokenPayload } from '@erppreflight/auth';
import { DatabaseService } from '../../database/database.service';

import type { Request } from 'express';

export const cookieExtractor = (req: Request | any): string | null => {
  if (!req) return null;
  if (req.cookies && req.cookies['erppreflight_session']) {
    return req.cookies['erppreflight_session'];
  }
  const cookieHeader = req.headers?.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)erppreflight_session=([^;]+)/);
    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return null;
      }
    }
  }
  return null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly db: DatabaseService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        cookieExtractor,
      ]),
      ignoreExpiration: false,
      // Validated in config/env.validation.ts (required in production, no fallback here)
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Accepts only access tokens whose user is ACTIVE, whose token_version matches the
   * current users.token_version (bumped by password change/reset, 2FA changes,
   * logout-all and account deletion) and whose jti was not revoked by logout.
   */
  async validate(payload: AuthTokenPayload) {
    if (!payload.sub || !payload.organizationId || payload.typ) {
      throw new UnauthorizedException('Invalid token payload');
    }
    const res = await this.db.query(
      `SELECT u.status, u.token_version, u.email_verified_at, u.totp_enabled_at,
              EXISTS (SELECT 1 FROM revoked_sessions r WHERE r.jti::text = $2) AS revoked
       FROM users u
       WHERE u.id = $1`,
      [payload.sub, payload.jti || ''],
      { bypassRls: true }
    );
    const row = res.rows[0];
    if (!row || row.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }
    if (Number(row.token_version ?? 0) !== Number(payload.tv ?? 0) || row.revoked) {
      throw new UnauthorizedException('Session has been revoked; please sign in again');
    }
    return {
      id: payload.sub,
      // Alias used by several controllers (req.user.userId)
      userId: payload.sub,
      email: payload.email,
      organizationId: payload.organizationId,
      role: payload.role,
      systemRole: payload.systemRole || 'USER',
      emailVerified: !!row.email_verified_at,
      mfaEnabled: !!row.totp_enabled_at,
      jti: payload.jti,
      exp: payload.exp,
    };
  }
}
