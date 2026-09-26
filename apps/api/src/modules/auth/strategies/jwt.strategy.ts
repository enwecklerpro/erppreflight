import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthTokenPayload } from '@erppreflight/auth';
import { DatabaseService } from '../../database/database.service';
import { SessionService } from '../session.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    private readonly db: DatabaseService,
    private readonly sessions: SessionService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        cookieExtractor,
      ]),
      ignoreExpiration: false,
      passReqToCallback: true,
      // Validated in config/env.validation.ts (required in production, no fallback here)
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Re-validates every request against the database (one indexed lookup):
   * - the user is ACTIVE (suspended / deleted accounts lose access immediately);
   * - token_version matches users.token_version (bumped by password change/reset,
   *   2FA changes, logout-all and account deletion);
   * - the session (jti) is active in user_sessions (not revoked, not expired);
   *   tokens issued before the session registry carry no jti and rely on token_version;
   * - the user is still a member of the organization the request acts in (the
   *   tenant verified by TenancyMiddleware, else the token's organization), so a
   *   removed member loses access at once. SUPER_ADMIN is exempt.
   * System role and organization role come from the database, never from stale claims.
   */
  async validate(req: any, payload: AuthTokenPayload) {
    if (!payload.sub || !payload.organizationId || payload.typ) {
      throw new UnauthorizedException('Invalid token payload');
    }
    if (payload.jti !== undefined && !UUID_RE.test(String(payload.jti))) {
      throw new UnauthorizedException('Invalid token payload');
    }
    const sessionId = payload.jti || null;
    const organizationId: string =
      typeof req?.tenantId === 'string' && UUID_RE.test(req.tenantId) ? req.tenantId : payload.organizationId;
    if (!UUID_RE.test(String(organizationId))) {
      throw new UnauthorizedException('Invalid token payload');
    }
    const res = await this.db.query(
      `SELECT u.status, u.system_role, u.token_version, u.email_verified_at, u.totp_enabled_at,
              s.id AS session_id, s.revoked_at, s.expires_at, s.last_seen_at,
              m.role AS member_role
       FROM users u
       LEFT JOIN user_sessions s ON s.id = $2::uuid AND s.user_id = u.id
       LEFT JOIN organization_members m ON m.user_id = u.id AND m.organization_id = $3::uuid
       WHERE u.id = $1`,
      [payload.sub, sessionId, organizationId],
      { bypassRls: true }
    );
    const row = res.rows[0];
    if (!row || row.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }
    if (Number(row.token_version ?? 0) !== Number(payload.tv ?? 0)) {
      throw new UnauthorizedException('Session has been revoked; please sign in again');
    }
    if (sessionId) {
      if (!row.session_id || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
        throw new UnauthorizedException('Session has been revoked; please sign in again');
      }
      this.sessions.touch(sessionId, row.last_seen_at);
    }
    const systemRole: string = row.system_role || 'USER';
    if (!row.member_role && systemRole !== 'SUPER_ADMIN') {
      throw new UnauthorizedException('Organization membership has been revoked; please sign in again');
    }
    return {
      id: payload.sub,
      // Alias used by several controllers (req.user.userId)
      userId: payload.sub,
      email: payload.email,
      organizationId,
      role: row.member_role || payload.role,
      systemRole,
      emailVerified: !!row.email_verified_at,
      mfaEnabled: !!row.totp_enabled_at,
      jti: payload.jti,
      exp: payload.exp,
    };
  }
}
